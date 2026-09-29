"""Detector falso: nada de modelo de 280 MB nos testes.

A "identidade" vem da cor do pixel (0, 0) de uma PNG (sem perda, a cor não muda):
  vermelho r > 0 -> um rosto com embedding unit(r)
  verde    g > 0 -> um segundo rosto, menor, com embedding unit(g)
  azul     b == 255 -> analyze() levanta RuntimeError
"""

import io

from factories import unit
from PIL import Image


def png(r: int = 0, g: int = 0, b: int = 0, size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (r, g, b)).save(buf, "PNG")
    return buf.getvalue()


class FakeDetector:
    def __init__(self):
        self.calls = 0
        self.on_analyze = None  # callback opcional, roda no meio da análise

    def load(self) -> None:
        pass

    def analyze(self, img):
        self.calls += 1
        if self.on_analyze:
            self.on_analyze()
        r, g, b = img.getpixel((0, 0))
        if b == 255:
            raise RuntimeError("falha simulada")
        faces = []
        if r:
            faces.append({"bbox": [10.0, 10.0, 40.0, 40.0], "det_score": 0.9, "embedding": unit(r)})
        if g:
            faces.append({"bbox": [2.0, 2.0, 8.0, 8.0], "det_score": 0.8, "embedding": unit(g)})
        return faces, {"resize": 0.1, "detection": 1.0, "embedding": 2.0}
