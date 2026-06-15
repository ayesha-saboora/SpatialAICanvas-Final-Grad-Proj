"""
Train ASL fingerspelling classifier with a custom 3-conv-block CNN (AslCNN3).

Architecture (entirely from scratch — no pretrained weights):
  Block 1 — Conv(3→64, 3x3) + BatchNorm + ReLU + MaxPool(2) + Dropout2d(0.10)
  Block 2 — Conv(64→128, 3x3) + BatchNorm + ReLU + MaxPool(2) + Dropout2d(0.15)
  Block 3 — Conv(128→256, 3x3) + BatchNorm + ReLU + AdaptiveAvgPool(1)
  Head    — Dropout(0.40) + Linear(256 → 26)
  Output  — raw logits; softmax applied at inference via torch.softmax(logits, dim=1)

Dataset:
  Primary : datasets/asl_combined/  (merged Roboflow + webcam, train/valid/test splits)
  Fallback: American Sign Language Letters/  (Roboflow only)

Augmentation applied during training:
  RandomHorizontalFlip, RandomRotation(±15°), ColorJitter(brightness, contrast, saturation)

Outputs:
  backend/models/asl_model.pth          — replaces active model (arch=asl_cnn3)
  backend/models/class_labels.json
  ml/asl_cnn3_metrics.json              — full metrics + dataset breakdown
  ml/asl_cnn3_confusion_matrix.png      — 26×26 confusion matrix
  ml/asl_cnn3_comparison.json           — side-by-side vs MobileNet baseline

Run from repo root (inside backend venv):
  cd backend
  .venv\\Scripts\\python.exe ..\\ml\\train_asl_custom3.py [--epochs 25] [--data-dir ...]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
from PIL import Image
from sklearn.metrics import classification_report, confusion_matrix
from torch.optim.lr_scheduler import ReduceLROnPlateau
from torch.utils.data import DataLoader
from torchvision import transforms

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "ml"))

from asl_model import ARCH_CNN3, AslCNN3  # noqa: E402
from train_asl import LetterDataset, build_samples, run_epoch  # noqa: E402

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
DEFAULT_DATA = ROOT / "datasets" / "asl_combined"
FALLBACK_DATA = ROOT / "American Sign Language Letters"
MODEL_OUT = ROOT / "backend" / "models" / "asl_model.pth"
LABELS_OUT = ROOT / "backend" / "models" / "class_labels.json"
METRICS_OUT = Path(__file__).resolve().parent / "asl_cnn3_metrics.json"
CM_OUT = Path(__file__).resolve().parent / "asl_cnn3_confusion_matrix.png"
COMPARE_OUT = Path(__file__).resolve().parent / "asl_cnn3_comparison.json"

IMAGE_SIZE = 96


# ---------------------------------------------------------------------------
# Dataset breakdown helper
# ---------------------------------------------------------------------------

def dataset_breakdown(
    train_samples: list,
    val_samples: list,
    test_samples: list,
    classes: list[str],
) -> dict:
    """Count images per class per split and flag Roboflow vs webcam origin."""
    counts: dict[str, dict[str, int]] = {
        split: defaultdict(int)
        for split in ("train", "val", "test")
    }
    roboflow_total = webcam_total = 0

    for split_name, split in zip(("train", "val", "test"), (train_samples, val_samples, test_samples)):
        for path, label_idx in split:
            letter = classes[label_idx]
            counts[split_name][letter] += 1
            path_str = str(path).lower()
            if "our_webcam" in path_str or "webcam" in path_str:
                if split_name == "train":
                    webcam_total += 1
            else:
                if split_name == "train":
                    roboflow_total += 1

    per_class: list[dict] = []
    for letter in classes:
        per_class.append({
            "letter": letter,
            "train": counts["train"].get(letter, 0),
            "val": counts["val"].get(letter, 0),
            "test": counts["test"].get(letter, 0),
            "total": (
                counts["train"].get(letter, 0)
                + counts["val"].get(letter, 0)
                + counts["test"].get(letter, 0)
            ),
        })

    return {
        "roboflow_train_images": roboflow_total,
        "webcam_train_images": webcam_total,
        "total_train": len(train_samples),
        "total_val": len(val_samples),
        "total_test": len(test_samples),
        "grand_total": len(train_samples) + len(val_samples) + len(test_samples),
        "per_class": per_class,
    }


# ---------------------------------------------------------------------------
# Data loaders (augmentation matches the spec)
# ---------------------------------------------------------------------------

def make_loaders(
    train_samples: list,
    val_samples: list,
    batch_size: int,
    num_workers: int,
) -> tuple[DataLoader, DataLoader]:
    train_tf = transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.RandomHorizontalFlip(p=0.5),
        transforms.RandomRotation(degrees=15),
        transforms.ColorJitter(brightness=0.30, contrast=0.20, saturation=0.20),
        transforms.ToTensor(),
        transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
    ])
    eval_tf = transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
    ])
    train_loader = DataLoader(
        LetterDataset(train_samples, train_tf),
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=torch.cuda.is_available(),
    )
    val_loader = DataLoader(
        LetterDataset(val_samples, eval_tf),
        batch_size=batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=torch.cuda.is_available(),
    )
    return train_loader, val_loader


# ---------------------------------------------------------------------------
# Evaluation helpers
# ---------------------------------------------------------------------------

@torch.no_grad()
def predict_all(
    model: nn.Module,
    samples: list,
    device: torch.device,
) -> tuple[list[int], list[int]]:
    eval_tf = transforms.Compose([
        transforms.Resize((IMAGE_SIZE, IMAGE_SIZE)),
        transforms.ToTensor(),
        transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
    ])
    model.eval()
    y_true, y_pred = [], []
    for path, label in samples:
        img = eval_tf(Image.open(path).convert("RGB")).unsqueeze(0).to(device)
        logits = model(img)
        probs = torch.softmax(logits, dim=1)
        y_pred.append(int(probs.argmax(dim=1).item()))
        y_true.append(label)
    return y_true, y_pred


def plot_confusion(cm: np.ndarray, classes: list[str], out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(12, 10))
    im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax)
    ax.set(
        xticks=np.arange(len(classes)),
        yticks=np.arange(len(classes)),
        xticklabels=classes,
        yticklabels=classes,
        ylabel="True label",
        xlabel="Predicted label",
        title="AslCNN3 — 26-class Confusion Matrix",
    )
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right", rotation_mode="anchor")
    thresh = cm.max() / 2.0 if cm.size else 0
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(
                j, i, str(cm[i, j]),
                ha="center", va="center",
                color="white" if cm[i, j] > thresh else "black",
                fontsize=7,
            )
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Confusion matrix saved → {out_path}")


def weakest_pairs(
    cm: np.ndarray,
    classes: list[str],
    top_n: int = 10,
) -> list[dict]:
    """Return the top-N off-diagonal confusion pairs (true→predicted)."""
    pairs = []
    for i in range(len(classes)):
        for j in range(len(classes)):
            if i != j and cm[i, j] > 0:
                pairs.append({
                    "true": classes[i],
                    "predicted": classes[j],
                    "count": int(cm[i, j]),
                })
    return sorted(pairs, key=lambda x: x["count"], reverse=True)[:top_n]


def per_class_f1(report: dict, classes: list[str]) -> list[dict]:
    rows = []
    for letter in classes:
        r = report.get(letter, {})
        rows.append({
            "letter": letter,
            "precision": round(r.get("precision", 0.0), 4),
            "recall": round(r.get("recall", 0.0), 4),
            "f1": round(r.get("f1-score", 0.0), 4),
            "support": r.get("support", 0),
        })
    return sorted(rows, key=lambda x: x["f1"])


# ---------------------------------------------------------------------------
# Comparison table vs MobileNet baseline
# ---------------------------------------------------------------------------

def load_baseline_accuracy(metrics_path: Path) -> float | None:
    if not metrics_path.is_file():
        return None
    try:
        data = json.loads(metrics_path.read_text(encoding="utf-8"))
        return float(data.get("eval_accuracy") or data.get("best_val_accuracy") or 0.0)
    except Exception:
        return None


def print_comparison(cnn3_acc: float, baselines: dict[str, float | None]) -> None:
    print("\n" + "=" * 50)
    print("  Model Comparison (eval accuracy)")
    print("=" * 50)
    print(f"  AslCNN3 (ours, 3-block)  : {cnn3_acc:.4f}  ← THIS RUN")
    for name, acc in baselines.items():
        acc_str = f"{acc:.4f}" if acc is not None else "  N/A  (not trained yet)"
        print(f"  {name:<30}: {acc_str}")
    print("=" * 50 + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Train AslCNN3 — custom 3-conv ASL classifier")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--num-workers", type=int, default=0)
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Skip overwriting backend/models/asl_model.pth (dry-run mode)",
    )
    args = parser.parse_args()

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)

    # Resolve dataset path
    data_dir = args.data_dir.resolve()
    if not data_dir.is_dir():
        data_dir = FALLBACK_DATA.resolve()
        print(f"[warn] Primary dataset not found; falling back to {data_dir}")
    if not data_dir.is_dir():
        raise FileNotFoundError(
            f"No dataset found. Tried:\n  {args.data_dir}\n  {FALLBACK_DATA}"
        )

    print(f"Dataset : {data_dir}")
    train_samples, val_samples, test_samples, classes = build_samples(data_dir)

    print(f"\n--- Dataset breakdown ---")
    breakdown = dataset_breakdown(train_samples, val_samples, test_samples, classes)
    print(f"  Combined images (train) : {breakdown['total_train']}  (Roboflow + webcam, pre-merged into asl_combined/)")
    print(f"  Train / Val / Test      : {breakdown['total_train']} / {breakdown['total_val']} / {breakdown['total_test']}")
    print(f"  Grand total             : {breakdown['grand_total']}")
    print(f"  Classes ({len(classes)})           : {classes}\n")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device  : {device}  |  Image size: {IMAGE_SIZE}×{IMAGE_SIZE}")
    print(f"Arch    : AslCNN3 (3 conv blocks, BatchNorm, Dropout, softmax output)")
    print(f"Epochs  : {args.epochs}  |  Batch: {args.batch_size}  |  LR: {args.lr}\n")

    train_loader, val_loader = make_loaders(
        train_samples, val_samples, args.batch_size, args.num_workers
    )

    model = AslCNN3(num_classes=len(classes)).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = ReduceLROnPlateau(optimizer, mode="max", factor=0.5, patience=4)

    history: list[dict] = []
    best_acc = 0.0
    best_state: dict | None = None

    for epoch in range(1, args.epochs + 1):
        tr_loss, tr_acc = run_epoch(model, train_loader, criterion, optimizer, device, train=True)
        va_loss, va_acc = run_epoch(model, val_loader, criterion, None, device, train=False)
        scheduler.step(va_acc)
        history.append({
            "epoch": epoch,
            "train_loss": round(tr_loss, 6),
            "train_acc": round(tr_acc, 6),
            "val_loss": round(va_loss, 6),
            "val_acc": round(va_acc, 6),
        })
        marker = "  ★" if va_acc >= best_acc else ""
        print(
            f"Epoch {epoch:>3}/{args.epochs}"
            f"  train_loss={tr_loss:.4f}  train_acc={tr_acc:.4f}"
            f"  val_loss={va_loss:.4f}  val_acc={va_acc:.4f}{marker}"
        )
        if va_acc >= best_acc:
            best_acc = va_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    if best_state:
        model.load_state_dict(best_state)

    # ------------------------------------------------------------------
    # Final evaluation on test set (fall back to val if no test split)
    # ------------------------------------------------------------------
    eval_samples = test_samples if test_samples else val_samples
    eval_split_name = "test" if test_samples else "val"
    print(f"\nEvaluating on {eval_split_name} set ({len(eval_samples)} images)…")

    y_true, y_pred = predict_all(model, eval_samples, device)
    label_ids = list(range(len(classes)))
    report = classification_report(
        y_true, y_pred,
        labels=label_ids,
        target_names=classes,
        output_dict=True,
        zero_division=0,
    )
    cm = confusion_matrix(y_true, y_pred, labels=label_ids)

    eval_accuracy = float(report["accuracy"])
    print(f"Eval accuracy : {eval_accuracy:.4f}")
    print(f"Best val acc  : {best_acc:.4f}")

    # Weakest letter pairs from confusion matrix
    weak = weakest_pairs(cm, classes, top_n=10)
    print("\nTop confused letter pairs (true → predicted):")
    for p in weak[:10]:
        print(f"  {p['true']} → {p['predicted']}  ({p['count']} errors)")

    # Per-class F1 (sorted ascending)
    class_f1 = per_class_f1(report, classes)
    print("\nWeakest per-class F1:")
    for row in class_f1[:5]:
        print(f"  {row['letter']}  precision={row['precision']:.3f}  recall={row['recall']:.3f}  f1={row['f1']:.3f}")

    # ------------------------------------------------------------------
    # Save model + labels
    # ------------------------------------------------------------------
    if not args.no_save:
        MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
        torch.save(
            {
                "state_dict": model.state_dict(),
                "num_classes": len(classes),
                "arch": ARCH_CNN3,
                "image_size": IMAGE_SIZE,
            },
            MODEL_OUT,
        )
        LABELS_OUT.write_text(json.dumps(classes, indent=2), encoding="utf-8")
        print(f"\nModel saved  → {MODEL_OUT}")
        print(f"Labels saved → {LABELS_OUT}")
    else:
        print("\n[--no-save] Skipped writing model files.")

    # ------------------------------------------------------------------
    # Save metrics JSON
    # ------------------------------------------------------------------
    metrics = {
        "model": "AslCNN3",
        "arch": ARCH_CNN3,
        "image_size": IMAGE_SIZE,
        "augmentation": [
            "RandomHorizontalFlip(p=0.5)",
            "RandomRotation(±15°)",
            "ColorJitter(brightness=0.30, contrast=0.20, saturation=0.20)",
        ],
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "lr": args.lr,
        "optimizer": "Adam(weight_decay=1e-4)",
        "scheduler": "ReduceLROnPlateau(factor=0.5, patience=4)",
        "classes": classes,
        "dataset_breakdown": breakdown,
        "best_val_accuracy": round(best_acc, 6),
        "eval_accuracy": round(eval_accuracy, 6),
        "eval_split": eval_split_name,
        "history": history,
        "classification_report": report,
        "weakest_confusion_pairs": weak,
        "per_class_f1_sorted": class_f1,
    }
    METRICS_OUT.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(f"Metrics      → {METRICS_OUT}")

    # ------------------------------------------------------------------
    # Confusion matrix plot
    # ------------------------------------------------------------------
    plot_confusion(cm, classes, CM_OUT)

    # ------------------------------------------------------------------
    # Comparison table vs baseline models
    # ------------------------------------------------------------------
    mobilenet_acc = load_baseline_accuracy(ROOT / "ml" / "training_metrics.json")

    baselines = {
        "MobileNetV2 (transfer learn)": mobilenet_acc,
    }
    print_comparison(eval_accuracy, baselines)

    comparison = {
        "AslCNN3_eval_accuracy": round(eval_accuracy, 6),
        "AslCNN3_best_val_accuracy": round(best_acc, 6),
        "MobileNetV2_eval_accuracy": mobilenet_acc,
        "note": (
            "AslCNN3 is trained from scratch with 3 conv layers, BatchNorm, and Dropout. "
            "MobileNetV2 uses ImageNet pretrained weights (transfer learning). "
            "This comparison demonstrates the accuracy–complexity tradeoff between "
            "a purpose-built lightweight CNN and a heavyweight pretrained backbone."
        ),
    }
    COMPARE_OUT.write_text(json.dumps(comparison, indent=2), encoding="utf-8")
    print(f"Comparison   → {COMPARE_OUT}")
    print("\nDone. The active inference pipeline will automatically use AslCNN3.")


if __name__ == "__main__":
    main()
