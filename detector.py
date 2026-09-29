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

import io
import os
import threading
import time

import numpy as np
from PIL import Image, ImageOps

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

THUMB_SIDE = 400

_app = None  # modelo carregado uma vez só (demora ~2s e ocupa ~300MB)


def get_model():
    """Carrega o FaceAnalysis sob demanda (lazy) e reaproveita."""
    global _app
    if _app is None:
        from insightface.app import FaceAnalysis

        # Só precisamos de detecção + reconhecimento; o buffalo_l também traz
        # modelos de idade/gênero/landmarks 3D que só gastariam CPU.
        _app = FaceAnalysis(
            name="buffalo_l",
            # no Docker o modelo é baixado no build para /models (INSIGHTFACE_ROOT)
            root=os.environ.get("INSIGHTFACE_ROOT", "~/.insightface"),
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        # ctx_id=-1 => CPU
        _app.prepare(ctx_id=-1, det_thresh=DET_THRESH, det_size=DET_SIZE)
    return _app


def load_image(data: bytes) -> Image.Image:
    """Abre bytes como imagem RGB, aplicando a rotação EXIF.

    Celulares salvam a foto "deitada" e só marcam no EXIF que ela deve ser
    girada. O navegador respeita essa marca ao exibir; se nós não
    respeitarmos, as bounding boxes ficariam em coordenadas giradas e o
    retângulo apareceria no lugar errado na galeria.
    """
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def make_thumbnail(img: Image.Image) -> bytes:
    """JPEG pequeno para a galeria carregar rápido (não baixa 5MB por card)."""
    t = img.copy()
    t.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.LANCZOS)
    buf = io.BytesIO()
    t.save(buf, "JPEG", quality=82)
    return buf.getvalue()


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


def analyze(img: Image.Image):
    """Detecta todos os rostos e gera um embedding normalizado para cada um.

    Retorna (faces, timings_ms), onde cada face é:
      {"bbox": [x1,y1,x2,y2] em px da ORIGINAL, "det_score": float,
       "embedding": np.ndarray float32 (512,), norma 1}
    """
    with _model_lock:
        return _analyze(img)


# O worker de indexação e a busca podem chamar o modelo ao mesmo tempo.
# O onnxruntime aguenta, mas o código Python do InsightFace em volta mantém
# caches internos; um lock deixa tudo previsível (custo: uma busca pode
# esperar a foto que está sendo indexada terminar, <1s).
_model_lock = threading.Lock()


def _analyze(img: Image.Image):
    from insightface.app.common import Face

    app = get_model()
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
        faces.append({
            # volta para coordenadas da imagem original
            "bbox": [float(v * scale) for v in (x1, y1, x2, y2)],
            "det_score": float(score),
            "embedding": emb.astype(np.float32),
        })
    timings["embedding"] = (time.perf_counter() - t0) * 1000
    return faces, timings
