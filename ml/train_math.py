"""
Train handwritten math symbol classifier (digits + operators).

Uses real handwritten samples from datasets/math_external (digits and
most operators) plus a synthetic generator for symbols with no real
samples available (currently just '*').
Outputs:
  backend/models/math_model.pth
  backend/models/math_labels.json
  ml/math_metrics.json
  ml/math_confusion_matrix.png
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(line_buffering=True)

import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from sklearn.metrics import classification_report, confusion_matrix
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
from torchvision import transforms

ROOT = Path(__file__).resolve().parent.parent
MODEL_OUT = ROOT / "backend" / "models" / "math_model.pth"
LABELS_OUT = ROOT / "backend" / "models" / "math_labels.json"
METRICS_OUT = Path(__file__).resolve().parent / "math_metrics.json"
CM_OUT = Path(__file__).resolve().parent / "math_confusion_matrix.png"
CACHE_DIR = ROOT / "datasets" / "math"
SYNTH_DIR = CACHE_DIR / "synthetic"
EXTERNAL_DIR = ROOT / "datasets" / "math_external" / "Handwritten math symbols dataset"

DIGIT_SYMBOLS = [str(i) for i in range(10)]
OPERATOR_SYMBOLS = ["+", "-", "*", "/", "=", "(", ")"]
SYMBOLS = DIGIT_SYMBOLS + OPERATOR_SYMBOLS

# Symbols with no usable real samples in EXTERNAL_DIR fall back to the
# synthetic generator (currently just '*' - no multiplication-operator
# class exists in the external dataset, only the 'x' variable letter).
SYNTHETIC_SYMBOLS = ["*"]
SYMBOL_FOLDER: dict[str, str] = {"*": "mul"}

# Maps our symbol set to the external dataset's folder names. Digits and
# most operators share the same name; '/' is stored as "forward_slash".
EXTERNAL_FOLDER: dict[str, str] = {
    **{d: d for d in DIGIT_SYMBOLS},
    "+": "+",
    "-": "-",
    "(": "(",
    ")": ")",
    "=": "=",
    "/": "forward_slash",
}


def operator_dir(symbol: str) -> Path:
    return SYNTH_DIR / SYMBOL_FOLDER[symbol]


def ensure_synthetic_cache(samples_per_operator: int, synthetic_symbols: list[str]) -> None:
    SYNTH_DIR.mkdir(parents=True, exist_ok=True)
    for sym in synthetic_symbols:
        sym_dir = operator_dir(sym)
        sym_dir.mkdir(parents=True, exist_ok=True)
        existing = list(sym_dir.glob("*.png"))
        need = samples_per_operator - len(existing)
        if need <= 0:
            continue
        print(f"Generating {need} synthetic samples for '{sym}'...")
        for i in range(need):
            generate_synthetic_symbol(sym).save(sym_dir / f"{len(existing) + i:05d}.png")


class FolderDataset(Dataset):
    """Loads raw (un-transformed) grayscale symbol images from a folder.

    Returns (PIL.Image, label) pairs so callers can layer canvas-export
    augmentation before the final tensor transform.
    """

    def __init__(
        self,
        folder: Path,
        label: int,
        train: bool,
        thicken: bool = False,
        split: float = 0.85,
        max_total: int | None = None,
    ):
        paths = sorted(folder.glob("*.png")) + sorted(folder.glob("*.jpg"))
        if max_total is not None and len(paths) > max_total:
            paths = random.sample(paths, max_total)
            paths.sort()
        split_idx = int(len(paths) * split)
        self.paths = paths[:split_idx] if train else paths[split_idx:]
        self.label = label
        self.thicken = thicken

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, idx: int):
        path = self.paths[idx]
        img = None
        for attempt in range(5):
            try:
                img = Image.open(path).convert("L")
                break
            except (PermissionError, OSError):
                if attempt == 4:
                    break
                time.sleep(0.5 * (attempt + 1))
        if img is None:
            # File is likely an OneDrive online-only placeholder that never
            # synced down; skip it by substituting a neighboring sample
            # instead of crashing the whole run.
            return self.__getitem__((idx + 1) % len(self.paths))
        if self.thicken:
            img = img.filter(ImageFilter.MaxFilter(3))
        return img, self.label

    def labels(self) -> list[int]:
        return [self.label] * len(self.paths)


class TransformDataset(Dataset):
    """Applies a torchvision transform to the PIL images of a base dataset."""

    def __init__(self, base: Dataset, transform):
        self.base = base
        self.transform = transform

    def __len__(self) -> int:
        return len(self.base)

    def __getitem__(self, idx: int):
        img, label = self.base[idx]
        return self.transform(img), label

    def labels(self) -> list[int]:
        return self.base.labels()


class ConcatLabeledDataset(Dataset):
    def __init__(self, parts: list[Dataset]):
        self.parts = parts
        self.offsets = []
        off = 0
        for part in parts:
            self.offsets.append(off)
            off += len(part)
        self.total = off

    def __len__(self) -> int:
        return self.total

    def __getitem__(self, idx: int):
        for part, off in zip(self.parts, self.offsets):
            if idx < off + len(part):
                return part[idx - off]
        raise IndexError(idx)

    def labels(self) -> list[int]:
        out: list[int] = []
        for part in self.parts:
            out.extend(part.labels())
        return out


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


def _draw_symbol(draw: ImageDraw.ImageDraw, symbol: str, size: int, ink: int = 0) -> None:
    cx, cy = size // 2, size // 2
    stroke = max(3, size // 8)
    fill = ink
    if symbol in "+":
        draw.line([(cx - size // 4, cy), (cx + size // 4, cy)], fill=fill, width=stroke)
        draw.line([(cx, cy - size // 4), (cx, cy + size // 4)], fill=fill, width=stroke)
    elif symbol == "-":
        draw.line([(cx - size // 4, cy), (cx + size // 4, cy)], fill=fill, width=stroke)
    elif symbol == "*":
        d = size // 5
        draw.line([(cx - d, cy - d), (cx + d, cy + d)], fill=fill, width=stroke)
        draw.line([(cx - d, cy + d), (cx + d, cy - d)], fill=fill, width=stroke)
    elif symbol == "/":
        draw.line([(cx - size // 4, cy + size // 4), (cx + size // 4, cy - size // 4)], fill=fill, width=stroke)
    elif symbol == "=":
        off = size // 8
        draw.line([(cx - size // 4, cy - off), (cx + size // 4, cy - off)], fill=fill, width=stroke)
        draw.line([(cx - size // 4, cy + off), (cx + size // 4, cy + off)], fill=fill, width=stroke)
    elif symbol == "(":
        draw.arc([cx - size // 3, cy - size // 3, cx + size // 6, cy + size // 3], 90, 270, fill=fill, width=stroke)
    elif symbol == ")":
        draw.arc([cx - size // 6, cy - size // 3, cx + size // 3, cy + size // 3], 270, 90, fill=fill, width=stroke)
    elif symbol in {"x", "y"}:
        try:
            font = ImageFont.truetype("arial.ttf", size // 2)
        except OSError:
            font = ImageFont.load_default()
        draw.text((cx, cy), symbol, fill=fill, font=font, anchor="mm")
    else:
        try:
            font = ImageFont.truetype("arial.ttf", size // 2)
        except OSError:
            font = ImageFont.load_default()
        draw.text((cx, cy), symbol, fill=fill, font=font, anchor="mm")


def generate_synthetic_symbol(symbol: str, size: int = 64) -> Image.Image:
    """Canvas-like sample: thick strokes, varied scale, colored-pen gray levels."""
    canvas_size = random.randint(56, 128)
    img = Image.new("L", (canvas_size, canvas_size), color=255)
    pad = random.randint(6, 16)
    inner = canvas_size - pad * 2
    inner = max(24, int(inner * random.uniform(0.45, 0.95)))
    tmp = Image.new("L", (inner, inner), color=255)
    tdraw = ImageDraw.Draw(tmp)
    ink = random.randint(0, 90)
    _draw_symbol(tdraw, symbol, inner, ink=ink)
    stroke_passes = random.randint(1, 3)
    for _ in range(stroke_passes):
        tmp = tmp.filter(ImageFilter.MaxFilter(3))
    angle = random.uniform(-22, 22)
    tmp = tmp.rotate(angle, resample=Image.Resampling.BILINEAR, fillcolor=255)
    ox = random.randint(-4, 4)
    oy = random.randint(-4, 4)
    paste_x = (canvas_size - tmp.width) // 2 + ox
    paste_y = (canvas_size - tmp.height) // 2 + oy
    img.paste(tmp, (paste_x, paste_y))
    if random.random() < 0.2:
        noise = np.random.normal(0, 6, (canvas_size, canvas_size)).astype(np.int16)
        arr = np.clip(np.array(img, dtype=np.int16) + noise, 0, 255).astype(np.uint8)
        img = Image.fromarray(arr, mode="L")
    return img.resize((size, size), Image.Resampling.LANCZOS)


def simulate_canvas_export(gray_img: Image.Image) -> Image.Image:
    """On-the-fly augmentation mimicking tldraw pen exports at varied sizes.

    Kept mild relative to the original synthetic-only version: applied to
    crisp 45x45 real symbol photos now, so overly aggressive scale/pad
    ranges created a large train/test domain gap and unstable eval accuracy.
    """
    if gray_img.mode != "L":
        gray_img = gray_img.convert("L")
    scale = random.uniform(0.7, 1.6)
    side = max(12, int(max(gray_img.size) * scale))
    img = gray_img.resize((side, side), Image.Resampling.LANCZOS)
    if random.random() < 0.3:
        img = img.filter(ImageFilter.MaxFilter(3))
    pad_side = int(max(img.size) * random.uniform(1.0, 1.25))
    img = ImageOps.pad(img, (pad_side, pad_side), color=255, centering=(0.5, 0.5))
    arr = np.array(img, dtype=np.float32)
    ink = arr < 240
    if ink.any():
        arr[ink] = np.clip(arr[ink] * random.uniform(0.6, 1.0), 0, 235)
    return Image.fromarray(arr.astype(np.uint8), mode="L")


class CanvasAugmentedDataset(Dataset):
    """Wraps a dataset and applies canvas-export simulation before transforms."""

    def __init__(self, base: Dataset, train: bool):
        self.base = base
        self.train = train

    def __len__(self) -> int:
        return len(self.base)

    def __getitem__(self, idx: int):
        img, label = self.base[idx]
        if self.train and isinstance(img, Image.Image):
            img = simulate_canvas_export(img)
        return img, label

    def labels(self) -> list[int]:
        if hasattr(self.base, "labels"):
            return self.base.labels()
        return [self.base[i][1] for i in range(len(self.base))]


def build_datasets(
    symbols: list[str],
    external_dir: Path,
    samples_per_operator: int = 800,
    max_per_class: int = 3000,
):
    synthetic_symbols = [sym for sym in symbols if sym in SYNTHETIC_SYMBOLS]
    ensure_synthetic_cache(samples_per_operator, synthetic_symbols)
    train_tf = transforms.Compose(
        [
            transforms.Resize((64, 64)),
            transforms.RandomAffine(degrees=20, translate=(0.14, 0.14), scale=(0.85, 1.15), shear=10),
            transforms.ToTensor(),
            transforms.Normalize([0.5], [0.5]),
        ]
    )
    eval_tf = transforms.Compose(
        [
            transforms.Resize((64, 64)),
            transforms.ToTensor(),
            transforms.Normalize([0.5], [0.5]),
        ]
    )

    train_parts = []
    test_parts = []
    for label, sym in enumerate(symbols):
        if sym in synthetic_symbols:
            folder = operator_dir(sym)
            train_base = FolderDataset(folder, label, train=True, thicken=True)
            test_base = FolderDataset(folder, label, train=False, thicken=True)
        else:
            folder = external_dir / EXTERNAL_FOLDER[sym]
            train_base = FolderDataset(folder, label, train=True, split=0.9, max_total=max_per_class)
            test_base = FolderDataset(folder, label, train=False, split=0.9, max_total=max_per_class)

        train_parts.append(TransformDataset(CanvasAugmentedDataset(train_base, train=True), train_tf))
        test_parts.append(TransformDataset(test_base, eval_tf))

    train_ds = ConcatLabeledDataset(train_parts)
    test_ds = ConcatLabeledDataset(test_parts)
    return train_ds, test_ds


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
def evaluate(model, loader, device) -> tuple[list[int], list[int]]:
    model.eval()
    y_true, y_pred = [], []
    for images, labels in loader:
        images = images.to(device)
        preds = model(images).argmax(dim=1).cpu().tolist()
        y_true.extend(labels.tolist())
        y_pred.extend(preds)
    return y_true, y_pred


def plot_confusion(cm: np.ndarray, classes: list[str], out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(11, 9))
    im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax)
    ax.set(
        xticks=np.arange(len(classes)),
        yticks=np.arange(len(classes)),
        xticklabels=classes,
        yticklabels=classes,
        ylabel="True",
        xlabel="Predicted",
        title="Handwritten Math Symbol Confusion Matrix",
    )
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")
    thresh = cm.max() / 2.0 if cm.size else 0
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(
                j, i, format(cm[i, j], "d"),
                ha="center", va="center",
                color="white" if cm[i, j] > thresh else "black",
                fontsize=7,
            )
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def make_balanced_loader(dataset: Dataset, batch_size: int, shuffle: bool) -> DataLoader:
    if not shuffle:
        return DataLoader(dataset, batch_size=batch_size, shuffle=False, num_workers=0)
    label_list = dataset.labels() if hasattr(dataset, "labels") else [dataset[i][1] for i in range(len(dataset))]
    counts: dict[int, int] = {}
    for label in label_list:
        counts[int(label)] = counts.get(int(label), 0) + 1
    weights = [1.0 / counts[int(label)] for label in label_list]
    sampler = WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)
    return DataLoader(dataset, batch_size=batch_size, sampler=sampler, num_workers=0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--samples-per-operator", type=int, default=800)
    parser.add_argument("--max-per-class", type=int, default=3000)
    parser.add_argument("--digits-only", action="store_true")
    parser.add_argument("--data-dir", type=Path, default=EXTERNAL_DIR)
    args = parser.parse_args()

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)

    symbols = DIGIT_SYMBOLS if args.digits_only else SYMBOLS
    train_ds, test_ds = build_datasets(symbols, args.data_dir, args.samples_per_operator, args.max_per_class)
    print(f"Classes ({len(symbols)}): {symbols}")
    print(f"Data dir: {args.data_dir}")
    print(f"Train size: {len(train_ds)}  Test size: {len(test_ds)}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    train_loader = make_balanced_loader(train_ds, args.batch_size, shuffle=True)
    test_loader = make_balanced_loader(test_ds, args.batch_size, shuffle=False)

    model = MathSymbolCNN(len(symbols)).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    history = []
    best_acc = 0.0
    best_state = None
    for epoch in range(1, args.epochs + 1):
        tr_loss, tr_acc = run_epoch(model, train_loader, criterion, optimizer, device, train=True)
        te_loss, te_acc = run_epoch(model, test_loader, criterion, optimizer, device, train=False)
        history.append({"epoch": epoch, "train_loss": tr_loss, "train_acc": tr_acc, "test_loss": te_loss, "test_acc": te_acc})
        print(f"Epoch {epoch}/{args.epochs}  train={tr_acc:.3f}  test={te_acc:.3f}")
        if te_acc >= best_acc:
            best_acc = te_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}
            MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
            torch.save({"state_dict": best_state, "num_classes": len(symbols)}, MODEL_OUT)
            LABELS_OUT.write_text(json.dumps(symbols, indent=2), encoding="utf-8")
            METRICS_OUT.write_text(
                json.dumps({"symbols": symbols, "best_test_accuracy": best_acc, "history": history}, indent=2),
                encoding="utf-8",
            )

    if best_state:
        model.load_state_dict(best_state)

    y_true, y_pred = evaluate(model, test_loader, device)
    report = classification_report(y_true, y_pred, target_names=symbols, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_true, y_pred)

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "num_classes": len(symbols)}, MODEL_OUT)
    LABELS_OUT.write_text(json.dumps(symbols, indent=2), encoding="utf-8")

    metrics = {
        "symbols": symbols,
        "best_test_accuracy": best_acc,
        "classification_report": report,
        "history": history,
    }
    METRICS_OUT.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    plot_confusion(cm, symbols, CM_OUT)

    print(f"Best test accuracy: {best_acc:.4f}")
    print(f"Saved model -> {MODEL_OUT}")
    print(f"Saved labels -> {LABELS_OUT}")


if __name__ == "__main__":
    main()
