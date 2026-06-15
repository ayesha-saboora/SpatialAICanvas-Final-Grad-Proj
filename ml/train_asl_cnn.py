"""
Train ASL fingerspelling classifier with a custom CNN (trained from scratch).

Uses the same data pipeline as train_asl.py. Default dataset is the merged
Roboflow + webcam folder (datasets/asl_combined/).

Run from backend venv:
  cd backend
  .venv\\Scripts\\python.exe ..\\ml\\train_asl_cnn.py

Outputs:
  backend/models/asl_model.pth          (arch=asl_cnn)
  backend/models/class_labels.json
  ml/asl_cnn_metrics.json
  ml/asl_cnn_confusion_matrix.png
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from sklearn.metrics import classification_report, confusion_matrix
from torch.utils.data import DataLoader
from torchvision import transforms

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "ml"))
from asl_model import ARCH_ASL_CNN, AslLetterCNN  # noqa: E402

from train_asl import LetterDataset, build_samples, run_epoch  # noqa: E402

DEFAULT_DATA = ROOT / "datasets" / "asl_combined"
MODEL_OUT = ROOT / "backend" / "models" / "asl_model.pth"
LABELS_OUT = ROOT / "backend" / "models" / "class_labels.json"
METRICS_OUT = Path(__file__).resolve().parent / "asl_cnn_metrics.json"
CM_OUT = Path(__file__).resolve().parent / "asl_cnn_confusion_matrix.png"


def make_loaders(
    train_samples: list,
    val_samples: list,
    batch_size: int,
    num_workers: int,
    image_size: int,
) -> tuple[DataLoader, DataLoader]:
    train_tf = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.RandomHorizontalFlip(),
            transforms.RandomRotation(12),
            transforms.ColorJitter(0.2, 0.2, 0.15),
            transforms.ToTensor(),
            transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
        ]
    )
    eval_tf = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
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


@torch.no_grad()
def predict_all(
    model, samples, classes, device, image_size: int
) -> tuple[list[int], list[int]]:
    eval_tf = transforms.Compose(
        [
            transforms.Resize((image_size, image_size)),
            transforms.ToTensor(),
            transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
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
        title="ASL Custom CNN Confusion Matrix",
    )
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")
    thresh = cm.max() / 2.0 if cm.size else 0
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(
                j, i, format(cm[i, j], "d"),
                ha="center", va="center",
                color="white" if cm[i, j] > thresh else "black",
            )
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train custom ASL Letter CNN")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--image-size", type=int, default=128)
    parser.add_argument("--num-workers", type=int, default=0)
    args = parser.parse_args()

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)

    data_dir = args.data_dir.resolve()
    if not data_dir.is_dir():
        raise FileNotFoundError(f"Dataset not found: {data_dir}")

    train_samples, val_samples, test_samples, classes = build_samples(data_dir)
    print(f"Model: AslLetterCNN (from scratch)")
    print(f"Classes ({len(classes)}): {classes}")
    print(f"Train: {len(train_samples)}  Val: {len(val_samples)}  Test: {len(test_samples)}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}  Image size: {args.image_size}")

    train_loader, val_loader = make_loaders(
        train_samples, val_samples, args.batch_size, args.num_workers, args.image_size
    )
    model = AslLetterCNN(len(classes)).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    history = []
    best_acc = 0.0
    best_state = None

    for epoch in range(1, args.epochs + 1):
        tr_loss, tr_acc = run_epoch(model, train_loader, criterion, optimizer, device, train=True)
        va_loss, va_acc = run_epoch(model, val_loader, criterion, None, device, train=False)
        history.append(
            {
                "epoch": epoch,
                "train_loss": tr_loss,
                "train_acc": tr_acc,
                "val_loss": va_loss,
                "val_acc": va_acc,
            }
        )
        print(f"Epoch {epoch}/{args.epochs}  train_acc={tr_acc:.3f}  val_acc={va_acc:.3f}")
        if va_acc >= best_acc:
            best_acc = va_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    if best_state:
        model.load_state_dict(best_state)

    eval_samples = test_samples if test_samples else val_samples
    y_true, y_pred = predict_all(model, eval_samples, classes, device, args.image_size)
    label_ids = list(range(len(classes)))
    report = classification_report(
        y_true, y_pred, labels=label_ids, target_names=classes, output_dict=True, zero_division=0
    )
    cm = confusion_matrix(y_true, y_pred, labels=label_ids)

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "num_classes": len(classes),
            "arch": ARCH_ASL_CNN,
            "image_size": args.image_size,
        },
        MODEL_OUT,
    )
    LABELS_OUT.write_text(json.dumps(classes, indent=2), encoding="utf-8")

    metrics = {
        "model": "AslLetterCNN",
        "arch": ARCH_ASL_CNN,
        "image_size": args.image_size,
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

    print(f"\nBest val accuracy: {best_acc:.4f}")
    print(f"Eval accuracy: {report['accuracy']:.4f}")
    print(f"Saved model -> {MODEL_OUT}")
    print(f"Saved labels -> {LABELS_OUT}")
    print(f"Metrics -> {METRICS_OUT}")
    print(f"Confusion matrix -> {CM_OUT}")


if __name__ == "__main__":
    main()
