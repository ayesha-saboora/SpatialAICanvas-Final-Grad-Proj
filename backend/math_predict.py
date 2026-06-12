"""Handwritten math symbol inference."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageFilter, ImageOps
from torchvision import transforms

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "math_model.pth"
LABELS_PATH = MODEL_DIR / "math_labels.json"

_eval_transform = transforms.Compose(
    [
        transforms.Resize((64, 64)),
        transforms.Grayscale(num_output_channels=1),
        transforms.ToTensor(),
        transforms.Normalize([0.5], [0.5]),
    ]
)


class MathSymbolCNN(nn.Module):
    def __init__(self, num_classes: int) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),
            nn.Conv2d(64, 128, 3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.AdaptiveAvgPool2d(1),
        )
        self.classifier = nn.Linear(128, num_classes)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = torch.flatten(x, 1)
        return self.classifier(x)


_model: nn.Module | None = None
_labels: list[str] | None = None
_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _load_model() -> tuple[nn.Module, list[str]]:
    global _model, _labels
    if _model is not None and _labels is not None:
        return _model, _labels

    if not MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"Math model not found at {MODEL_PATH}. Run ml/train_math.py first."
        )
    if not LABELS_PATH.is_file():
        raise FileNotFoundError(f"Label file not found at {LABELS_PATH}.")

    checkpoint = torch.load(MODEL_PATH, map_location=_device, weights_only=False)
    labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    num_classes = int(checkpoint.get("num_classes", len(labels)))

    model = MathSymbolCNN(num_classes)
    model.load_state_dict(checkpoint["state_dict"])
    model.to(_device)
    model.eval()

    _model = model
    _labels = labels
    return model, labels


def _to_ink_grayscale(image: Image.Image) -> Image.Image:
    """Any pen color on white canvas -> grayscale ink."""
    rgb = image.convert("RGB")
    arr = np.array(rgb)
    return Image.fromarray(arr.min(axis=2).astype(np.uint8), mode="L")


def _preprocess_image(image: Image.Image, *, pad: int = 6, thicken: int = 2) -> Image.Image:
    """Crop to ink, square-pad, thicken — size-invariant."""
    gray = _to_ink_grayscale(image)
    ink = np.array(gray) < 245
    if ink.any():
        rows = np.where(ink.any(axis=1))[0]
        cols = np.where(ink.any(axis=0))[0]
        top = max(0, int(rows[0]) - pad)
        bottom = min(gray.height, int(rows[-1]) + pad + 1)
        left = max(0, int(cols[0]) - pad)
        right = min(gray.width, int(cols[-1]) + pad + 1)
        gray = gray.crop((left, top, right, bottom))
    side = max(gray.size)
    gray = ImageOps.pad(gray, (side, side), color=255, centering=(0.5, 0.5))
    for _ in range(thicken):
        gray = gray.filter(ImageFilter.MaxFilter(3))
    return gray


def _preprocess_variants(image: Image.Image) -> list[Image.Image]:
    """Multiple crops/thickenings for test-time augmentation."""
    return [
        _preprocess_image(image, pad=4, thicken=1),
        _preprocess_image(image, pad=6, thicken=2),
        _preprocess_image(image, pad=8, thicken=2),
        _preprocess_image(image, pad=10, thicken=3),
    ]


def predict_math_symbol(image_bytes: bytes) -> dict[str, float | str | list[dict[str, float | str]]]:
    """Classify a single handwritten math symbol image."""
    if not image_bytes:
        raise ValueError("Empty image")

    model, labels = _load_model()
    raw = Image.open(BytesIO(image_bytes))

    variants = _preprocess_variants(raw)
    probs_acc: torch.Tensor | None = None
    with torch.no_grad():
        for variant in variants:
            tensor = _eval_transform(variant).unsqueeze(0).to(_device)
            logits = model(tensor)
            probs = torch.softmax(logits, dim=1)[0]
            probs_acc = probs if probs_acc is None else probs_acc + probs

    assert probs_acc is not None
    probs = probs_acc / len(variants)
    idx = int(probs.argmax().item())
    confidence = float(probs[idx].item())
    top3 = torch.topk(probs, k=min(3, len(labels)))
    alternatives = [
        {"symbol": labels[int(i)], "confidence": round(float(p), 4)}
        for p, i in zip(top3.values.tolist(), top3.indices.tolist())
    ]

    symbol = labels[idx] if 0 <= idx < len(labels) else "?"
    # Model over-predicts ambiguous crops — prefer second choice if top is very uncertain.
    if confidence < 0.45 and len(top3.indices) > 1:
        alt_idx = int(top3.indices[1].item())
        alt_conf = float(probs[alt_idx].item())
        if alt_conf > confidence * 0.85:
            symbol = labels[alt_idx]
            confidence = alt_conf

    return {"symbol": symbol, "confidence": round(confidence, 4), "alternatives": alternatives}
