"""ASL fingerspelling inference for Sign Shortcuts and AAC."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

import torch
from PIL import Image
from torchvision import transforms

from asl_model import ARCH_CNN3, ARCH_MOBILENET, build_asl_model

MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_PATH = MODEL_DIR / "asl_model.pth"
LABELS_PATH = MODEL_DIR / "class_labels.json"

IMAGENET_NORM = transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
CNN_NORM = transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])

_model = None
_labels: list[str] | None = None
_arch: str | None = None
_image_size: int = 224
_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _eval_transform(image_size: int, arch: str):
    norm = CNN_NORM if arch == ARCH_CNN3 else IMAGENET_NORM
    return transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            norm,
        ]
    )


def _crop_variants(image: Image.Image) -> list[Image.Image]:
    """Slight zoom variants — averages softmax to stabilise live webcam crops."""
    w, h = image.size
    side = min(w, h)
    cx, cy = w // 2, h // 2
    variants: list[Image.Image] = []
    for scale in (0.88, 1.0, 1.12):
        s = max(16, int(side * scale))
        left = max(0, cx - s // 2)
        top = max(0, cy - s // 2)
        right = min(w, left + s)
        bottom = min(h, top + s)
        variants.append(image.crop((left, top, right, bottom)))
    return variants


def _load_model() -> tuple[torch.nn.Module, list[str], str, int]:
    global _model, _labels, _arch, _image_size
    if _model is not None and _labels is not None and _arch is not None:
        return _model, _labels, _arch, _image_size

    if not MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"ASL model not found at {MODEL_PATH}. Run ml/train_asl_custom3.py or ml/train_asl.py first."
        )
    if not LABELS_PATH.is_file():
        raise FileNotFoundError(f"Label file not found at {LABELS_PATH}.")

    checkpoint = torch.load(MODEL_PATH, map_location=_device, weights_only=False)
    labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    num_classes = int(checkpoint.get("num_classes", len(labels)))
    arch = str(checkpoint.get("arch", ARCH_MOBILENET))
    image_size = int(checkpoint.get("image_size", 224 if arch == ARCH_MOBILENET else 96))

    model = build_asl_model(arch, num_classes)
    model.load_state_dict(checkpoint["state_dict"])
    model.to(_device)
    model.eval()

    _model = model
    _labels = labels
    _arch = arch
    _image_size = image_size
    return model, labels, arch, image_size


def predict_sign(image_bytes: bytes) -> dict[str, float | str]:
    """Return predicted ASL letter and confidence in [0, 1]."""
    if not image_bytes:
        raise ValueError("Empty image")

    model, labels, arch, image_size = _load_model()
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    transform = _eval_transform(image_size, arch)
    variants = _crop_variants(image) if arch == ARCH_CNN3 else [image]

    probs_acc: torch.Tensor | None = None
    with torch.no_grad():
        for variant in variants:
            tensor = transform(variant).unsqueeze(0).to(_device)
            logits = model(tensor)
            probs = torch.softmax(logits, dim=1)[0]
            probs_acc = probs if probs_acc is None else probs_acc + probs

    assert probs_acc is not None
    probs = probs_acc / len(variants)
    idx = int(probs.argmax().item())
    confidence = float(probs[idx].item())

    letter = labels[idx] if 0 <= idx < len(labels) else "?"
    return {"letter": letter, "confidence": round(confidence, 4)}
