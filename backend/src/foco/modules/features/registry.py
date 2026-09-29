"""
registry.py — QUAIS flags existem e o padrão de cada uma.

O banco (tabela feature_flags) guarda só o que o admin mudou. Flag nova = uma
entrada aqui, sem migração. As flags são globais: valem para todos os
eventos e todos os visitantes, inclusive o próprio admin.
"""

FEATURES = {
    "calibration": {
        "label": "Calibração",
        "description": "Top 30 rostos mais parecidos + tempos de cada etapa, para ajustar o corte. "
        "Mostra rostos de outras pessoas abaixo do corte: deixe desligada em produção.",
        "default": False,
    },
}
