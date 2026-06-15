"""Prompt Intent Classifier inference.

Primary model: fine-tuned DistilBERT (backend/models/intent_distilbert/).

Set INTENT_MODEL env var to override:
  distilbert — DistilBERT (default; TF-IDF used only if weights are missing)
  tfidf      — TF-IDF + Logistic Regression baseline (report comparison only)

Falls back to the legacy keyword heuristic in main.py when no model loads.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import torch

MODEL_DIR = Path(__file__).resolve().parent / "models"
TFIDF_PATH = MODEL_DIR / "intent_model.joblib"
DISTILBERT_PATH = MODEL_DIR / "intent_distilbert"
LABELS_PATH = MODEL_DIR / "intent_labels.json"
INTENT_MODEL = os.getenv("INTENT_MODEL", "distilbert").strip().lower()

VISUAL_INTENT_MAP = {
    "DRAW_FLOWCHART": "flowchart",
    "GRAPH_FUNCTION": "graph",
    "DRAW_LABELED_DIAGRAM": "labeled_diagram",
    "flowchart": "flowchart",
    "graph": "graph",
    "labeled_diagram": "labeled_diagram",
}

_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
_backend_name: str | None = None
_backend_failed = False

# TF-IDF state
_tfidf_pipeline = None
_tfidf_labels: list[str] | None = None

# DistilBERT state
_distilbert_model = None
_distilbert_tokenizer = None
_distilbert_labels: list[str] | None = None


def visual_type_for_intent(intent: str | None) -> str | None:
    if not intent:
        return None
    return VISUAL_INTENT_MAP.get(intent)


def _distilbert_ready() -> bool:
    return (DISTILBERT_PATH / "config.json").is_file()


def _resolve_backend() -> str | None:
    if INTENT_MODEL == "tfidf":
        return "tfidf" if TFIDF_PATH.is_file() else None
    # Production demo: DistilBERT only (no silent TF-IDF fallback).
    if _distilbert_ready():
        return "distilbert"
    return None


def _load_tfidf():
    global _tfidf_pipeline, _tfidf_labels
    if _tfidf_pipeline is not None:
        return _tfidf_pipeline, _tfidf_labels
    import joblib

    _tfidf_pipeline = joblib.load(TFIDF_PATH)
    if LABELS_PATH.is_file():
        _tfidf_labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    else:
        _tfidf_labels = list(getattr(_tfidf_pipeline, "classes_", []))
    return _tfidf_pipeline, _tfidf_labels


def _load_distilbert():
    global _distilbert_model, _distilbert_tokenizer, _distilbert_labels
    if _distilbert_model is not None and _distilbert_tokenizer is not None:
        return _distilbert_model, _distilbert_tokenizer, _distilbert_labels

    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    _distilbert_tokenizer = AutoTokenizer.from_pretrained(str(DISTILBERT_PATH))
    _distilbert_model = AutoModelForSequenceClassification.from_pretrained(str(DISTILBERT_PATH))
    _distilbert_model.to(_device)
    _distilbert_model.eval()

    if LABELS_PATH.is_file():
        _distilbert_labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    else:
        id2label = getattr(_distilbert_model.config, "id2label", {})
        _distilbert_labels = [id2label[str(i)] for i in range(len(id2label))]
    return _distilbert_model, _distilbert_tokenizer, _distilbert_labels


def _ensure_backend() -> str | None:
    global _backend_name, _backend_failed
    if _backend_name is not None:
        return _backend_name
    if _backend_failed:
        return None
    try:
        name = _resolve_backend()
        if name is None:
            _backend_failed = True
            return None
        if name == "tfidf":
            _load_tfidf()
        else:
            _load_distilbert()
        _backend_name = name
        return name
    except Exception:
        _backend_failed = True
        return None


def is_available() -> bool:
    return _ensure_backend() is not None


def backend_name() -> str | None:
    return _ensure_backend()


def _predict_tfidf(text: str) -> tuple[str, float, dict[str, float]]:
    pipeline, classes = _load_tfidf()
    probs = pipeline.predict_proba([text])[0]
    class_list = list(pipeline.classes_)
    best_idx = int(probs.argmax())
    scores = {c: round(float(p), 4) for c, p in zip(class_list, probs)}
    return class_list[best_idx], float(probs[best_idx]), scores


def _id2label_map(model) -> dict[int, str]:
    raw = getattr(model.config, "id2label", {}) or {}
    out: dict[int, str] = {}
    for key, name in raw.items():
        out[int(key)] = name
    return out


def _predict_distilbert(text: str) -> tuple[str, float, dict[str, float]]:
    model, tokenizer, classes = _load_distilbert()
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=128)
    inputs = {k: v.to(_device) for k, v in inputs.items()}
    with torch.no_grad():
        logits = model(**inputs).logits[0]
        probs = torch.softmax(logits, dim=-1).cpu().tolist()

    id2label = _id2label_map(model)
    scores = {id2label[i]: round(float(p), 4) for i, p in enumerate(probs) if i in id2label}
    best_idx = int(max(range(len(probs)), key=lambda i: probs[i]))
    intent = id2label.get(best_idx, classes[best_idx] if best_idx < len(classes) else "?")
    return intent, float(probs[best_idx]), scores


def classify_intent(text: str) -> tuple[str | None, float]:
    text = (text or "").strip()
    if not text:
        return None, 0.0
    if _ensure_backend() is None:
        return None, 0.0
    try:
        if _backend_name == "distilbert":
            intent, conf, _ = _predict_distilbert(text)
        else:
            intent, conf, _ = _predict_tfidf(text)
        return intent, conf
    except Exception:
        return None, 0.0


def classify_detail(text: str) -> dict:
    text = (text or "").strip()
    backend = _ensure_backend()
    if backend is None:
        return {
            "available": False,
            "backend": None,
            "intent": None,
            "confidence": 0.0,
            "scores": {},
        }
    try:
        if backend == "distilbert":
            intent, conf, scores = _predict_distilbert(text)
        else:
            intent, conf, scores = _predict_tfidf(text)
        return {
            "available": True,
            "backend": backend,
            "intent": intent,
            "confidence": round(conf, 4),
            "scores": scores,
        }
    except Exception:
        return {
            "available": False,
            "backend": backend,
            "intent": None,
            "confidence": 0.0,
            "scores": {},
        }
