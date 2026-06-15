"""
Train ASL fingerspelling classifier (A-Z) with MobileNetV2 transfer learning.

For a custom CNN trained from scratch, use train_asl_custom3.py instead.

Expected dataset layout (any one works):
  .../train/A/, train/B/, ...           (+ optional valid/, test/)
  .../train/*.jpg + _annotations.coco.json   (Roboflow export — your download)
  .../A/, B/, ...                       (single folder of letter classes)

Outputs:
  backend/models/asl_model.pth
  backend/models/class_labels.json
  ml/training_metrics.json
  ml/confusion_matrix.png
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from sklearn.metrics import classification_report, confusion_matrix
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "American Sign Language Letters"
MODEL_OUT = ROOT / "backend" / "models" / "asl_model.pth"
LABELS_OUT = ROOT / "backend" / "models" / "class_labels.json"
METRICS_OUT = Path(__file__).resolve().parent / "training_metrics.json"
CM_OUT = Path(__file__).resolve().parent / "confusion_matrix.png"

IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
LETTERS = [chr(ord("A") + i) for i in range(26)]


class LetterDataset(Dataset):
    def __init__(self, samples: list[tuple[Path, int]], transform):
        self.samples = samples
        self.transform = transform

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, idx: int):
        path, label = self.samples[idx]
        img = Image.open(path).convert("RGB")
        return self.transform(img), label


def find_split_dir(data_dir: Path, split: str) -> Path | None:
    direct = data_dir / split
    if direct.is_dir():
        return direct
    return None


def collect_samples(class_dir: Path, label: str, label_to_idx: dict[str, int]) -> list[tuple[Path, int]]:
    if label not in label_to_idx:
        return []
    idx = label_to_idx[label]
    return [(p, idx) for p in class_dir.iterdir() if p.suffix.lower() in IMG_EXT and p.is_file()]


def load_from_coco_split(split_dir: Path) -> tuple[list[tuple[Path, int]], list[str]]:
    """Roboflow layout: images in split_dir + _annotations.coco.json."""
    anno_path = split_dir / "_annotations.coco.json"
    if not anno_path.is_file():
        return [], []

    data = json.loads(anno_path.read_text(encoding="utf-8"))
    id_to_name = {
        cat["id"]: cat["name"].upper()
        for cat in data.get("categories", [])
        if cat.get("name", "").upper() in LETTERS
    }
    image_id_to_file = {img["id"]: img["file_name"] for img in data.get("images", [])}

    # image_id -> letter (first annotation per image)
    image_id_to_letter: dict[int, str] = {}
    for ann in data.get("annotations", []):
        img_id = ann["image_id"]
        if img_id in image_id_to_letter:
            continue
        letter = id_to_name.get(ann.get("category_id", -1))
        if letter:
            image_id_to_letter[img_id] = letter

    classes = sorted(set(image_id_to_letter.values()), key=lambda x: LETTERS.index(x))
    label_to_idx = {c: i for i, c in enumerate(classes)}
    samples: list[tuple[Path, int]] = []

    for img_id, letter in image_id_to_letter.items():
        fname = image_id_to_file.get(img_id)
        if not fname:
            continue
        path = split_dir / fname
        if path.is_file():
            samples.append((path, label_to_idx[letter]))

    return samples, classes


def load_from_split(split_dir: Path, letters_only: bool = True) -> tuple[list[tuple[Path, int]], list[str]]:
    classes = sorted(
        d.name
        for d in split_dir.iterdir()
        if d.is_dir() and (not letters_only or (len(d.name) == 1 and d.name.isalpha()))
    )
    if letters_only:
        classes = [c.upper() for c in classes if c.upper() in LETTERS]
        classes = sorted(set(classes), key=lambda x: LETTERS.index(x))
    label_to_idx = {c: i for i, c in enumerate(classes)}
    samples: list[tuple[Path, int]] = []
    for cls in classes:
        samples.extend(collect_samples(split_dir / cls, cls, label_to_idx))
        # Some datasets use lowercase folder names
        if not (split_dir / cls).is_dir():
            samples.extend(collect_samples(split_dir / cls.lower(), cls, label_to_idx))
    return samples, classes


def build_samples(data_dir: Path) -> tuple[list, list, list, list[str]]:
    train_dir = find_split_dir(data_dir, "train")
    valid_dir = find_split_dir(data_dir, "valid") or find_split_dir(data_dir, "val")
    test_dir = find_split_dir(data_dir, "test")

    if train_dir:
        if (train_dir / "_annotations.coco.json").is_file():
            train_samples, classes = load_from_coco_split(train_dir)
            val_samples, _ = load_from_coco_split(valid_dir) if valid_dir else ([], classes)
            test_samples, _ = load_from_coco_split(test_dir) if test_dir else ([], classes)
        else:
            train_samples, classes = load_from_split(train_dir)
            val_samples, _ = load_from_split(valid_dir) if valid_dir else ([], classes)
            test_samples, _ = load_from_split(test_dir) if test_dir else ([], classes)
        if not train_samples:
            raise FileNotFoundError(f"No training images found under {train_dir}")
        if not val_samples and train_samples:
            random.shuffle(train_samples)
            cut = int(len(train_samples) * 0.85)
            val_samples = train_samples[cut:]
            train_samples = train_samples[:cut]
        return train_samples, val_samples, test_samples, classes

    # Flat layout: datasets/asl_alphabet/A/, B/, ...
    samples, classes = load_from_split(data_dir)
    if not samples:
        raise FileNotFoundError(
            f"No images found under {data_dir}. Expected train/valid/test or A-Z folders."
        )
    random.shuffle(samples)
    n = len(samples)
    t1, t2 = int(n * 0.7), int(n * 0.85)
    return samples[:t1], samples[t1:t2], samples[t2:], classes


def make_loaders(
    train_samples: list, val_samples: list, batch_size: int, num_workers: int
) -> tuple[DataLoader, DataLoader]:
    train_tf = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(0.15, 0.15, 0.1),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    eval_tf = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    train_loader = DataLoader(
        LetterDataset(train_samples, train_tf),
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
    )
    val_loader = DataLoader(
        LetterDataset(val_samples, eval_tf),
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
    )
    return train_loader, val_loader


def build_model(num_classes: int) -> nn.Module:
    model = models.mobilenet_v2(weights=models.MobileNet_V2_Weights.DEFAULT)
    model.classifier[1] = nn.Linear(model.classifier[1].in_features, num_classes)
    return model


def run_epoch(model, loader, criterion, optimizer, device, train: bool) -> tuple[float, float]:
    model.train(train)
    total_loss = 0.0
    correct = 0
    total = 0
    with torch.set_grad_enabled(train):
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            if train:
                optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs, labels)
            if train:
                loss.backward()
                optimizer.step()
            total_loss += loss.item() * images.size(0)
            preds = outputs.argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)
    return total_loss / max(total, 1), correct / max(total, 1)


@torch.no_grad()
def predict_all(model, samples, classes, device) -> tuple[list[int], list[int]]:
    eval_tf = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    model.eval()
    y_true, y_pred = [], []
    for path, label in samples:
        img = eval_tf(Image.open(path).convert("RGB")).unsqueeze(0).to(device)
        pred = model(img).argmax(dim=1).item()
        y_true.append(label)
        y_pred.append(pred)
    return y_true, y_pred


def plot_confusion(cm: np.ndarray, classes: list[str], out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 8))
    im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax)
    ax.set(
        xticks=np.arange(len(classes)),
        yticks=np.arange(len(classes)),
        xticklabels=classes,
        yticklabels=classes,
        ylabel="True",
        xlabel="Predicted",
        title="ASL Confusion Matrix",
    )
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")
    thresh = cm.max() / 2.0 if cm.size else 0
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(j, i, format(cm[i, j], "d"), ha="center", va="center", color="white" if cm[i, j] > thresh else "black")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--num-workers", type=int, default=0)
    args = parser.parse_args()

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)

    data_dir = args.data_dir.resolve()
    if not data_dir.is_dir():
        raise FileNotFoundError(f"Dataset not found: {data_dir}")

    train_samples, val_samples, test_samples, classes = build_samples(data_dir)
    print(f"Classes ({len(classes)}): {classes}")
    print(f"Train: {len(train_samples)}  Val: {len(val_samples)}  Test: {len(test_samples)}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    train_loader, val_loader = make_loaders(
        train_samples, val_samples, args.batch_size, args.num_workers
    )
    model = build_model(len(classes)).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    history = []
    best_acc = 0.0
    best_state = None

    for epoch in range(1, args.epochs + 1):
        tr_loss, tr_acc = run_epoch(model, train_loader, criterion, optimizer, device, train=True)
        va_loss, va_acc = run_epoch(model, val_loader, criterion, None, device, train=False)
        history.append(
            {"epoch": epoch, "train_loss": tr_loss, "train_acc": tr_acc, "val_loss": va_loss, "val_acc": va_acc}
        )
        print(f"Epoch {epoch}/{args.epochs}  train_acc={tr_acc:.3f}  val_acc={va_acc:.3f}")
        if va_acc >= best_acc:
            best_acc = va_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    if best_state:
        model.load_state_dict(best_state)

    eval_samples = test_samples if test_samples else val_samples
    y_true, y_pred = predict_all(model, eval_samples, classes, device)
    report = classification_report(y_true, y_pred, target_names=classes, output_dict=True)
    cm = confusion_matrix(y_true, y_pred)

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {"state_dict": model.state_dict(), "num_classes": len(classes), "arch": "mobilenet_v2", "image_size": 224},
        MODEL_OUT,
    )
    LABELS_OUT.write_text(json.dumps(classes, indent=2), encoding="utf-8")

    metrics = {
        "classes": classes,
        "train_size": len(train_samples),
        "val_size": len(val_samples),
        "test_size": len(test_samples),
        "best_val_accuracy": best_acc,
        "eval_accuracy": report["accuracy"],
        "history": history,
        "classification_report": report,
    }
    METRICS_OUT.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    plot_confusion(cm, classes, CM_OUT)

    print(f"\nSaved model -> {MODEL_OUT}")
    print(f"Saved labels -> {LABELS_OUT}")
    print(f"Eval accuracy: {report['accuracy']:.3f}")
    print(f"Confusion matrix -> {CM_OUT}")


if __name__ == "__main__":
    main()
