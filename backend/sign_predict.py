"""ASL fingerspelling inference for Sign Shortcuts and AAC."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

import torch
import torch.nn as nn
from PIL import Image
from torchvision import models, transforms

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "asl_model.pth"
LABELS_PATH = MODEL_DIR / "class_labels.json"

_eval_transform = transforms.Compose(
    [
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ]
)

_model: nn.Module | None = None
_labels: list[str] | None = None
_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _build_model(num_classes: int) -> nn.Module:
    model = models.mobilenet_v2(weights=None)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    return model


def _load_model() -> tuple[nn.Module, list[str]]:
    global _model, _labels
    if _model is not None and _labels is not None:
        return _model, _labels

    if not MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"ASL model not found at {MODEL_PATH}. Run ml/train_asl.py first."
        )
    if not LABELS_PATH.is_file():
        raise FileNotFoundError(f"Label file not found at {LABELS_PATH}.")

    checkpoint = torch.load(MODEL_PATH, map_location=_device, weights_only=False)
    labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    num_classes = int(checkpoint.get("num_classes", len(labels)))

    model = _build_model(num_classes)
    model.load_state_dict(checkpoint["state_dict"])
    model.to(_device)
    model.eval()

    _model = model
    _labels = labels
    return model, labels


def predict_sign(image_bytes: bytes) -> dict[str, float | str]:
    """Return predicted ASL letter and confidence in [0, 1]."""
    if not image_bytes:
        raise ValueError("Empty image")

    model, labels = _load_model()
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    tensor = _eval_transform(image).unsqueeze(0).to(_device)

    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)[0]
        idx = int(probs.argmax().item())
        confidence = float(probs[idx].item())

    letter = labels[idx] if 0 <= idx < len(labels) else "?"
    return {"letter": letter, "confidence": round(confidence, 4)}
