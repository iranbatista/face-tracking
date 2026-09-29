"""
detector.py — tudo que envolve "olhar para a imagem": carregar, redimensionar,
detectar rostos e gerar embeddings.

Pipeline de reconhecimento facial moderno (o que o InsightFace faz por baixo):

  1. DETECÇÃO (modelo SCRFD, arquivo det_10g.onnx)
     Encontra retângulos (bounding boxes) onde há rostos + 5 pontos-chave
     (olhos, nariz, cantos da boca). Não sabe QUEM é a pessoa, só ONDE há rosto.

  2. ALINHAMENTO
     Usando os 5 pontos, a imagem do rosto é rotacionada/escalada para um
     recorte padrão de 112x112 (olhos sempre na mesma posição). Isso remove
     variação de inclinação da cabeça antes do próximo passo.

  3. EMBEDDING (modelo ArcFace, arquivo w600k_r50.onnx)
     Uma rede neural transforma o recorte 112x112 em um vetor de 512 números.
     Esse vetor é o "embedding": uma coordenada num espaço onde rostos da
     MESMA pessoa ficam próximos e de pessoas diferentes ficam longe. A rede
     foi treinada (em milhões de rostos) exatamente para isso — ela não guarda
     a foto, só essa "impressão digital" numérica.

  4. NORMALIZAÇÃO L2
     Dividimos o vetor pelo seu comprimento, para ele ter norma 1. Assim o
     produto interno (a·b) entre dois vetores é exatamente o COSSENO do ângulo
     entre eles: 1.0 = idênticos, ~0 = sem relação. O ArcFace foi treinado
     com cosseno, então a informação de identidade está na DIREÇÃO do vetor,
     não no tamanho (o tamanho varia com iluminação/nitidez, e atrapalharia).
"""

import threading
import time
from functools import lru_cache
from typing import Protocol

import numpy as np
from PIL import Image

from foco.core.config import get_settings

# Lado maior máximo antes de detectar. Fotos de câmera têm 6000px+; rodar a
# detecção nisso em CPU é lento e não ajuda (o SCRFD redimensiona para
# DET_SIZE internamente de qualquer jeito). 1280 mantém rostos médios com
# resolução suficiente para um bom recorte 112x112.
MAX_SIDE = 1280

# Tamanho de entrada da rede de detecção. 640 é o padrão do buffalo_l.
# Aumentar (ex.: 960) acha rostos menores em fotos de multidão, porém mais lento.
DET_SIZE = (640, 640)

# Confiança mínima do detector para aceitar um rosto (0..1).
DET_THRESH = 0.5

# Rostos muito pequenos (em px, na imagem redimensionada) geram embeddings
# ruins: o recorte 112x112 vira um borrão ampliado e a rede "chuta". Esses
# embeddings ruins são uma fonte clássica de FALSOS POSITIVOS, então descartamos.
MIN_FACE_PX = 32


class Detector(Protocol):
    def load(self) -> None: ...

    def analyze(self, img: Image.Image) -> tuple[list[dict], dict[str, float]]:
        """(faces, timings_ms). Cada face: {"bbox": [x1,y1,x2,y2] em px da ORIGINAL,
        "det_score": float, "embedding": np.ndarray float32 (512,), norma 1}."""
        ...


def _resize_for_detection(img: Image.Image):
    """Reduz para MAX_SIDE e devolve (array BGR, fator de escala).

    scale = tamanho_original / tamanho_reduzido. Multiplicar uma bbox
    detectada na imagem reduzida por `scale` a leva de volta para as
    coordenadas da foto original.
    """
    w, h = img.size
    scale = max(w, h) / MAX_SIDE if max(w, h) > MAX_SIDE else 1.0
    if scale > 1.0:
        img = img.resize((round(w / scale), round(h / scale)), Image.LANCZOS)
    # InsightFace/OpenCV esperam BGR (ordem de canais invertida em relação ao RGB)
    bgr = np.asarray(img)[:, :, ::-1].copy()
    return bgr, scale


class InsightFaceDetector:
    """buffalo_l carregado uma vez por processo (demora ~2 s e ocupa ~300 MB)."""

    def __init__(self, root: str):
        self._root = root
        self._app = None
        # Duas selfies ao mesmo tempo na API: o onnxruntime aguenta, mas o
        # código Python do InsightFace em volta mantém caches internos. O
        # lock deixa tudo previsível (custo: uma espera de <1 s).
        self._lock = threading.Lock()

    def load(self) -> None:
        with self._lock:
            self._model()

    def _model(self):
        if self._app is None:
            from insightface.app import FaceAnalysis

            # Só detecção + reconhecimento: o buffalo_l também traz idade/gênero/
            # landmarks 3D, que só gastariam CPU.
            self._app = FaceAnalysis(
                name="buffalo_l",
                root=self._root,
                allowed_modules=["detection", "recognition"],
                providers=["CPUExecutionProvider"],
            )
            self._app.prepare(ctx_id=-1, det_thresh=DET_THRESH, det_size=DET_SIZE)  # -1 = CPU
        return self._app

    def analyze(self, img: Image.Image) -> tuple[list[dict], dict[str, float]]:
        with self._lock:
            return self._analyze(img)

    def _analyze(self, img: Image.Image):
        from insightface.app.common import Face

        app = self._model()
        timings = {}

        t0 = time.perf_counter()
        bgr, scale = _resize_for_detection(img)
        timings["resize"] = (time.perf_counter() - t0) * 1000

        # Etapa 1: detecção (bboxes + 5 landmarks por rosto)
        t0 = time.perf_counter()
        bboxes, kpss = app.det_model.detect(bgr, max_num=0, metric="default")
        timings["detection"] = (time.perf_counter() - t0) * 1000

        # Etapas 2-4: alinhamento + embedding + normalização, rosto a rosto
        t0 = time.perf_counter()
        rec = app.models["recognition"]
        faces = []
        for i in range(bboxes.shape[0]):
            x1, y1, x2, y2, score = bboxes[i]
            if min(x2 - x1, y2 - y1) < MIN_FACE_PX:
                continue
            face = Face(bbox=bboxes[i, :4], kps=kpss[i], det_score=score)
            emb = rec.get(bgr, face)  # alinha pelos landmarks e roda o ArcFace
            emb = emb / np.linalg.norm(emb)  # normalização L2 -> cosseno = produto interno
            faces.append(
                {
                    "bbox": [float(v * scale) for v in (x1, y1, x2, y2)],  # coordenadas da original
                    "det_score": float(score),
                    "embedding": emb.astype(np.float32),
                }
            )
        timings["embedding"] = (time.perf_counter() - t0) * 1000
        return faces, timings


@lru_cache
def get_detector() -> Detector:
    """Um detector por processo (API e worker têm cada um o seu)."""
    return InsightFaceDetector(get_settings().insightface_root)
