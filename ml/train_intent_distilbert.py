"""
Fine-tune DistilBERT on the 49-class Prompt Intent dataset.

Uses the same CSV and train/test split (random_state=42, 80/20 stratified) as
train_intent.py so results are directly comparable to the TF-IDF baseline.

Run from the backend venv (torch + transformers installed):
  cd backend
  .venv\\Scripts\\python.exe ..\\ml\\train_intent_distilbert.py

Outputs:
  backend/models/intent_distilbert/          (tokenizer + weights)
  backend/models/intent_labels.json          (class order, shared)
  ml/intent_distilbert_metrics.json
  ml/intent_distilbert_confusion_matrix.png

Tip: use Google Colab free GPU for faster training — copy intent_prompts.csv,
run this script, then download intent_distilbert/ back into backend/models/.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from torch.utils.data import Dataset
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    EarlyStoppingCallback,
    Trainer,
    TrainingArguments,
)

ROOT = Path(__file__).resolve().parent.parent
DATA_CSV = ROOT / "datasets" / "intent" / "intent_prompts.csv"
MODEL_OUT = ROOT / "backend" / "models" / "intent_distilbert"
LABELS_OUT = ROOT / "backend" / "models" / "intent_labels.json"
METRICS_OUT = Path(__file__).resolve().parent / "intent_distilbert_metrics.json"
CM_OUT = Path(__file__).resolve().parent / "intent_distilbert_confusion_matrix.png"
DEFAULT_BASE = "distilbert-base-uncased"


def load_dataset(path: Path) -> tuple[list[str], list[str]]:
    if not path.is_file():
        raise FileNotFoundError(f"{path} not found. Run intent_dataset.py first.")
    texts, labels = [], []
    with path.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            t = (row.get("text") or "").strip()
            l = (row.get("label") or "").strip()
            if t and l:
                texts.append(t)
                labels.append(l)
    return texts, labels


class IntentDataset(Dataset):
    def __init__(self, texts: list[str], labels: list[int], tokenizer, max_length: int):
        self.encodings = tokenizer(
            texts,
            truncation=True,
            padding="max_length",
            max_length=max_length,
        )
        self.labels = labels

    def __len__(self) -> int:
        return len(self.labels)

    def __getitem__(self, idx: int) -> dict[str, torch.Tensor]:
        item = {k: torch.tensor(v[idx]) for k, v in self.encodings.items()}
        item["labels"] = torch.tensor(self.labels[idx], dtype=torch.long)
        return item


def plot_confusion(cm: np.ndarray, classes: list[str], out_path: Path) -> None:
    n = len(classes)
    size = max(6, n * 0.32)
    fig, ax = plt.subplots(figsize=(size, size))
    im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    ax.set(
        xticks=np.arange(n),
        yticks=np.arange(n),
        xticklabels=classes,
        yticklabels=classes,
        ylabel="True",
        xlabel="Predicted",
        title="DistilBERT Intent Confusion Matrix",
    )
    ax.tick_params(axis="both", labelsize=7)
    plt.setp(ax.get_xticklabels(), rotation=90, ha="center", rotation_mode="anchor")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def compute_metrics(eval_pred) -> dict[str, float]:
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    return {"accuracy": float((preds == labels).mean())}


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune DistilBERT intent classifier")
    parser.add_argument("--base-model", default=DEFAULT_BASE)
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=128)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    texts, labels = load_dataset(DATA_CSV)
    classes = sorted(set(labels))
    label2id = {label: i for i, label in enumerate(classes)}
    id2label = {i: label for label, i in label2id.items()}

    x_train, x_test, y_train, y_test = train_test_split(
        texts, labels, test_size=0.2, random_state=args.seed, stratify=labels
    )
    y_train_ids = [label2id[l] for l in y_train]
    y_test_ids = [label2id[l] for l in y_test]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"Loaded {len(texts)} prompts, {len(classes)} classes")
    print(f"Train: {len(x_train)}  Test: {len(x_test)}  Device: {device}")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model,
        num_labels=len(classes),
        id2label=id2label,
        label2id=label2id,
    )

    train_ds = IntentDataset(x_train, y_train_ids, tokenizer, args.max_length)
    test_ds = IntentDataset(x_test, y_test_ids, tokenizer, args.max_length)

    training_args = TrainingArguments(
        output_dir=str(ROOT / "ml" / "intent_distilbert_checkpoints"),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        learning_rate=args.lr,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="accuracy",
        greater_is_better=True,
        logging_steps=20,
        save_total_limit=1,
        seed=args.seed,
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=test_ds,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )

    print("Starting fine-tuning...")
    trainer.train()
    eval_result = trainer.evaluate()
    print(f"Eval accuracy: {eval_result.get('eval_accuracy', 0):.4f}")

    preds_output = trainer.predict(test_ds)
    y_pred_ids = np.argmax(preds_output.predictions, axis=-1)
    y_true_names = [id2label[int(i)] for i in y_test_ids]
    y_pred_names = [id2label[int(i)] for i in y_pred_ids]

    report = classification_report(y_true_names, y_pred_names, output_dict=True)
    labels_order = sorted(set(y_true_names) | set(y_pred_names))
    cm = confusion_matrix(y_true_names, y_pred_names, labels=labels_order)

    MODEL_OUT.mkdir(parents=True, exist_ok=True)
    trainer.save_model(str(MODEL_OUT))
    tokenizer.save_pretrained(str(MODEL_OUT))
    LABELS_OUT.write_text(json.dumps(classes, indent=2), encoding="utf-8")
    (MODEL_OUT / "label2id.json").write_text(json.dumps(label2id, indent=2), encoding="utf-8")

    metrics = {
        "model": "distilbert-base-uncased",
        "classes": classes,
        "train_size": len(x_train),
        "test_size": len(x_test),
        "test_accuracy": float(report["accuracy"]),
        "eval_accuracy": float(eval_result.get("eval_accuracy", report["accuracy"])),
        "device": device,
        "epochs": args.epochs,
        "classification_report": report,
    }
    METRICS_OUT.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    plot_confusion(cm, labels_order, CM_OUT)

    demo = [
        "draw a flowchart of photosynthesis",
        "what is photosynthesis",
        "plot y = x^2",
        "draw a labeled diagram of the human heart",
        "debug my python sorting function",
        "prove that sqrt(2) is irrational",
        "what's the time complexity of merge sort",
        "create flashcards for operating systems",
        "compare CNNs and Transformers",
        "integrate x e^x",
    ]
    print("\nSanity check:")
    model.eval()
    for text in demo:
        inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=args.max_length)
        inputs = {k: v.to(model.device) for k, v in inputs.items()}
        with torch.no_grad():
            logits = model(**inputs).logits[0]
            probs = torch.softmax(logits, dim=-1)
            idx = int(probs.argmax().item())
        print(f"  {text!r:55s} -> {id2label[idx]} ({float(probs[idx]):.2f})")

    print(f"\nSaved model  -> {MODEL_OUT}")
    print(f"Saved labels -> {LABELS_OUT}")
    print(f"Metrics      -> {METRICS_OUT}")
    print(f"Confusion matrix -> {CM_OUT}")


if __name__ == "__main__":
    main()
