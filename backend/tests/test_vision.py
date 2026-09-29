import io

import pytest
from fakes import png
from PIL import Image

from foco.vision.images import load_image, make_thumbnail


def test_load_image_converte_para_rgb():
    buf = io.BytesIO()
    Image.new("L", (10, 10), 128).save(buf, "PNG")
    assert load_image(buf.getvalue()).mode == "RGB"


def test_load_image_bytes_invalidos():
    with pytest.raises(OSError):
        load_image(b"isto nao e imagem")


def test_make_thumbnail_limita_lado_maior():
    img = load_image(png(size=(1000, 500)))
    thumb = Image.open(io.BytesIO(make_thumbnail(img)))
    assert thumb.format == "JPEG"
    assert max(thumb.size) == 400


@pytest.mark.slow
def test_modelo_real_sem_rosto():
    from foco.vision.detector import InsightFaceDetector

    faces, timings = InsightFaceDetector("~/.insightface").analyze(load_image(png(size=(320, 240))))
    assert faces == []
    assert {"resize", "detection", "embedding"} <= timings.keys()
