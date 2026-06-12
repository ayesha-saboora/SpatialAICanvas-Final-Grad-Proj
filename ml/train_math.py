"""
Train handwritten math symbol classifier (digits + operators).

Uses MNIST (0-9) plus synthetically generated operator/variable glyphs.
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
from io import BytesIO
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from sklearn.metrics import classification_report, confusion_matrix
from torch.utils.data import DataLoader, Dataset, Subset, WeightedRandomSampler
from torchvision import datasets, transforms

ROOT = Path(__file__).resolve().parent.parent
MODEL_OUT = ROOT / "backend" / "models" / "math_model.pth"
LABELS_OUT = ROOT / "backend" / "models" / "math_labels.json"
METRICS_OUT = Path(__file__).resolve().parent / "math_metrics.json"
CM_OUT = Path(__file__).resolve().parent / "math_confusion_matrix.png"
CACHE_DIR = ROOT / "datasets" / "math"
SYNTH_DIR = CACHE_DIR / "synthetic"

# Digits from MNIST; operators/variables from synthetic generator.
OPERATOR_SYMBOLS = ["+", "-", "*", "/", "=", "(", ")"]
DIGIT_SYMBOLS = [str(i) for i in range(10)]
SYMBOLS = DIGIT_SYMBOLS + OPERATOR_SYMBOLS

SYMBOL_FOLDER: dict[str, str] = {
    "+": "plus",
    "-": "minus",
    "*": "mul",
    "/": "div",
    "=": "eq",
    "(": "lparen",
    ")": "rparen",
}


def operator_dir(symbol: str) -> Path:
    return SYNTH_DIR / SYMBOL_FOLDER[symbol]


def ensure_synthetic_cache(samples_per_operator: int) -> None:
    SYNTH_DIR.mkdir(parents=True, exist_ok=True)
    for sym in OPERATOR_SYMBOLS:
        sym_dir = operator_dir(sym)
        sym_dir.mkdir(parents=True, exist_ok=True)
        existing = list(sym_dir.glob("*.png"))
        need = samples_per_operator - len(existing)
        if need <= 0:
            continue
        print(f"Generating {need} synthetic samples for '{sym}'...")
        for i in range(need):
            generate_synthetic_symbol(sym).save(sym_dir / f"{len(existing) + i:05d}.png")


class OperatorFolderDataset(Dataset):
    def __init__(self, symbol: str, label: int, transform, train: bool):
        folder = operator_dir(symbol)
        paths = sorted(folder.glob("*.png"))
        split = int(len(paths) * 0.85)
        self.paths = paths[:split] if train else paths[split:]
        self.label = label
        self.transform = transform

    def __len__(self) -> int:
        return len(self.paths)

    def __getitem__(self, idx: int):
        img = Image.open(self.paths[idx]).convert("L")
        img = img.filter(ImageFilter.MaxFilter(3))
        return self.transform(img), self.label


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
    """On-the-fly augmentation mimicking tldraw pen exports at any size."""
    if gray_img.mode != "L":
        gray_img = gray_img.convert("L")
    scale = random.uniform(0.35, 2.8)
    side = max(12, int(max(gray_img.size) * scale))
    img = gray_img.resize((side, side), Image.Resampling.LANCZOS)
    for _ in range(random.randint(0, 2)):
        img = img.filter(ImageFilter.MaxFilter(3))
    pad_side = int(max(img.size) * random.uniform(1.05, 1.8))
    img = ImageOps.pad(img, (pad_side, pad_side), color=255, centering=(0.5, 0.5))
    arr = np.array(img, dtype=np.float32)
    ink = arr < 240
    if ink.any():
        arr[ink] = np.clip(arr[ink] * random.uniform(0.25, 1.0), 0, 235)
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


class CombinedMathDataset(Dataset):
    def __init__(self, mnist_subset, synth_parts: list[OperatorFolderDataset]):
        self.mnist = mnist_subset
        self.synth_parts = synth_parts
        self.synth_len = sum(len(d) for d in synth_parts)
        self.synth_offsets = []
        off = 0
        for part in synth_parts:
            self.synth_offsets.append(off)
            off += len(part)

    def __len__(self) -> int:
        return len(self.mnist) + self.synth_len

    def __getitem__(self, idx: int):
        if idx < len(self.mnist):
            return self.mnist[idx]
        synth_idx = idx - len(self.mnist)
        for part, off in zip(self.synth_parts, self.synth_offsets):
            if synth_idx < off + len(part):
                return part[synth_idx - off]
        raise IndexError(idx)

    def labels(self) -> list[int]:
        out: list[int] = []
        if isinstance(self.mnist, Subset):
            base = self.mnist.dataset
            for idx in self.mnist.indices:
                out.append(int(base.targets[idx]))
        else:
            for idx in range(len(self.mnist)):
                out.append(int(self.mnist.dataset.targets[idx]))
        for part in self.synth_parts:
            out.extend([part.label] * len(part))
        return out


def subsample_mnist(dataset, max_per_class: int) -> Subset:
    targets = dataset.targets.tolist() if hasattr(dataset.targets, "tolist") else list(dataset.targets)
    indices: list[int] = []
    counts: dict[int, int] = {}
    for i, label in enumerate(targets):
        c = counts.get(int(label), 0)
        if c < max_per_class:
            indices.append(i)
            counts[int(label)] = c + 1
    return Subset(dataset, indices)


def build_datasets(samples_per_operator: int = 400, mnist_per_digit: int = 250):
    ensure_synthetic_cache(samples_per_operator)
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

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    mnist_train_full = datasets.MNIST(str(CACHE_DIR), train=True, download=True, transform=train_tf)
    mnist_test_full = datasets.MNIST(str(CACHE_DIR), train=False, download=True, transform=eval_tf)
    mnist_train = subsample_mnist(mnist_train_full, mnist_per_digit)
    mnist_test = subsample_mnist(mnist_test_full, max(80, mnist_per_digit // 4))

    synth_train_parts = []
    synth_test_parts = []
    for sym in OPERATOR_SYMBOLS:
        label = SYMBOLS.index(sym)
        synth_train_parts.append(OperatorFolderDataset(sym, label, train_tf, train=True))
        synth_test_parts.append(OperatorFolderDataset(sym, label, eval_tf, train=False))

    train_ds = CombinedMathDataset(mnist_train, synth_train_parts)
    test_ds = CombinedMathDataset(mnist_test, synth_test_parts)
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
    parser.add_argument("--mnist-per-digit", type=int, default=400)
    args = parser.parse_args()

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)

    train_ds, test_ds = build_datasets(args.samples_per_operator, args.mnist_per_digit)
    print(f"Classes ({len(SYMBOLS)}): {SYMBOLS}")
    print(f"Train size: {len(train_ds)}  Test size: {len(test_ds)}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    train_loader = make_balanced_loader(train_ds, args.batch_size, shuffle=True)
    test_loader = make_balanced_loader(test_ds, args.batch_size, shuffle=False)

    model = MathSymbolCNN(len(SYMBOLS)).to(device)
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

    if best_state:
        model.load_state_dict(best_state)

    y_true, y_pred = evaluate(model, test_loader, device)
    report = classification_report(y_true, y_pred, target_names=SYMBOLS, output_dict=True, zero_division=0)
    cm = confusion_matrix(y_true, y_pred)

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "num_classes": len(SYMBOLS)}, MODEL_OUT)
    LABELS_OUT.write_text(json.dumps(SYMBOLS, indent=2), encoding="utf-8")

    metrics = {
        "symbols": SYMBOLS,
        "best_test_accuracy": best_acc,
        "classification_report": report,
        "history": history,
    }
    METRICS_OUT.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    plot_confusion(cm, SYMBOLS, CM_OUT)

    print(f"Best test accuracy: {best_acc:.4f}")
    print(f"Saved model -> {MODEL_OUT}")
    print(f"Saved labels -> {LABELS_OUT}")


if __name__ == "__main__":
    main()
