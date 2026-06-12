"""Prompt Intent Classifier inference.

Loads the trained TF-IDF + Logistic Regression pipeline that predicts what a
student's request wants: flowchart | graph | labeled_diagram | none.

This replaces the old keyword heuristic for choosing a diagram type. If the
model file is missing, classify_intent() returns (None, 0.0) so callers can
fall back to the legacy keyword logic.
"""

from __future__ import annotations

import json
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "intent_model.joblib"
LABELS_PATH = MODEL_DIR / "intent_labels.json"

# Map fine-grained intents to the canvas visuals StudyCanvas can generate.
VISUAL_INTENT_MAP = {
    "DRAW_FLOWCHART": "flowchart",
    "GRAPH_FUNCTION": "graph",
    "DRAW_LABELED_DIAGRAM": "labeled_diagram",
    # legacy lowercase labels (older models) still supported
    "flowchart": "flowchart",
    "graph": "graph",
    "labeled_diagram": "labeled_diagram",
}


def visual_type_for_intent(intent: str | None) -> str | None:
    """Return flowchart|graph|labeled_diagram for a predicted intent, else None."""
    if not intent:
        return None
    return VISUAL_INTENT_MAP.get(intent)

_pipeline = None
_labels: list[str] | None = None
_load_failed = False


def _load():
    global _pipeline, _labels, _load_failed
    if _pipeline is not None:
        return _pipeline
    if _load_failed:
        return None
    try:
        import joblib

        if not MODEL_PATH.is_file():
            _load_failed = True
            return None
        _pipeline = joblib.load(MODEL_PATH)
        if LABELS_PATH.is_file():
            _labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
        else:
            _labels = list(getattr(_pipeline, "classes_", []))
        return _pipeline
    except Exception:
        _load_failed = True
        return None


def is_available() -> bool:
    return _load() is not None


def classify_intent(text: str) -> tuple[str | None, float]:
    """Return (intent, confidence). (None, 0.0) when the model is unavailable."""
    text = (text or "").strip()
    if not text:
        return None, 0.0
    pipeline = _load()
    if pipeline is None:
        return None, 0.0
    try:
        probs = pipeline.predict_proba([text])[0]
        classes = list(pipeline.classes_)
        best_idx = int(probs.argmax())
        return classes[best_idx], float(probs[best_idx])
    except Exception:
        return None, 0.0


def classify_detail(text: str) -> dict:
    """Full breakdown for the API / UI badge."""
    text = (text or "").strip()
    pipeline = _load()
    if pipeline is None:
        return {"available": False, "intent": None, "confidence": 0.0, "scores": {}}
    probs = pipeline.predict_proba([text])[0]
    classes = list(pipeline.classes_)
    scores = {c: round(float(p), 4) for c, p in zip(classes, probs)}
    best_idx = int(probs.argmax())
    return {
        "available": True,
        "intent": classes[best_idx],
        "confidence": round(float(probs[best_idx]), 4),
        "scores": scores,
    }
