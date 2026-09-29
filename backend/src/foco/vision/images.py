"""Carregar e reduzir imagens (Pillow). Não depende do modelo."""

import io

from PIL import Image, ImageOps

THUMB_SIDE = 400


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


def make_thumbnail(img: Image.Image, side: int = THUMB_SIDE, quality: int = 82) -> bytes:
    """JPEG reduzido: miniatura (400px) para a galeria carregar rápido, ou
    tamanho médio (1600px) para capa e visualizador, sem baixar o original."""
    t = img.copy()
    t.thumbnail((side, side), Image.LANCZOS)
    buf = io.BytesIO()
    t.save(buf, "JPEG", quality=quality)
    return buf.getvalue()
