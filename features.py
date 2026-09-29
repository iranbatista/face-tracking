"""
features.py — funcionalidades que o backoffice liga e desliga.

O código define QUAIS flags existem e o padrão de cada uma; o banco
(tabela settings, chave "feature.<nome>") guarda só o que o admin mudou.
Flag nova = uma entrada em FEATURES, sem migração.

As flags são globais: valem para todos os eventos e todos os visitantes,
inclusive o próprio admin.
"""

import store

FEATURES = {
    "calibration": {
        "label": "Calibração",
        "description": "Top 30 rostos mais parecidos + tempos de cada etapa, para ajustar o corte. "
                       "Mostra rostos de outras pessoas abaixo do corte: deixe desligada em produção.",
        "default": False,
    },
}


def is_enabled(key: str) -> bool:
    spec = FEATURES[key]  # KeyError de propósito: flag inexistente é bug
    value = store.get_setting(f"feature.{key}")
    return spec["default"] if value is None else value == "1"


def all_flags() -> dict[str, bool]:
    return {k: is_enabled(k) for k in FEATURES}


def describe() -> list[dict]:
    return [
        {"key": k, "label": f["label"], "description": f["description"], "enabled": is_enabled(k)}
        for k, f in FEATURES.items()
    ]


def set_enabled(key: str, enabled: bool):
    if key not in FEATURES:
        raise KeyError(key)
    store.set_setting(f"feature.{key}", "1" if enabled else "0")
