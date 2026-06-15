"""ASL fingerspelling inference for Sign Shortcuts and AAC."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path

import torch
from PIL import Image
from torchvision import transforms

from asl_model import ARCH_ASL_CNN, ARCH_MOBILENET, build_asl_model

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
    norm = CNN_NORM if arch == ARCH_ASL_CNN else IMAGENET_NORM
    return transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            norm,
        ]
    )


def _load_model() -> tuple[torch.nn.Module, list[str], str, int]:
    global _model, _labels, _arch, _image_size
    if _model is not None and _labels is not None and _arch is not None:
        return _model, _labels, _arch, _image_size

    if not MODEL_PATH.is_file():
        raise FileNotFoundError(
            f"ASL model not found at {MODEL_PATH}. Run ml/train_asl_cnn.py or ml/train_asl.py first."
        )
    if not LABELS_PATH.is_file():
        raise FileNotFoundError(f"Label file not found at {LABELS_PATH}.")

    checkpoint = torch.load(MODEL_PATH, map_location=_device, weights_only=False)
    labels = json.loads(LABELS_PATH.read_text(encoding="utf-8"))
    num_classes = int(checkpoint.get("num_classes", len(labels)))
    arch = str(checkpoint.get("arch", ARCH_MOBILENET))
    image_size = int(checkpoint.get("image_size", 224 if arch == ARCH_MOBILENET else 128))

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
    tensor = _eval_transform(image_size, arch)(image).unsqueeze(0).to(_device)

    with torch.no_grad():
        logits = model(tensor)
        probs = torch.softmax(logits, dim=1)[0]
        idx = int(probs.argmax().item())
        confidence = float(probs[idx].item())

    letter = labels[idx] if 0 <= idx < len(labels) else "?"
    return {"letter": letter, "confidence": round(confidence, 4)}
