"""
Train the TF-IDF + Logistic Regression intent baseline (for report comparison).

Production intent routing uses fine-tuned DistilBERT — see train_intent_distilbert.py.

This baseline reads a student's request and predicts one of 49 STEM intents.

Run intent_dataset.py first to create datasets/intent/intent_prompts.csv.

Outputs:
  backend/models/intent_model.joblib    (full TF-IDF + LogReg pipeline)
  backend/models/intent_labels.json     (class order)
  ml/intent_metrics.json                (accuracy + report)
  ml/intent_confusion_matrix.png        (for the report/poster)

NOTE: train with the SAME Python env the backend uses (its .venv) so the saved
pipeline loads without a scikit-learn version mismatch.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

ROOT = Path(__file__).resolve().parent.parent
DATA_CSV = ROOT / "datasets" / "intent" / "intent_prompts.csv"
MODEL_OUT = ROOT / "backend" / "models" / "intent_model.joblib"
LABELS_OUT = ROOT / "backend" / "models" / "intent_labels.json"
METRICS_OUT = Path(__file__).resolve().parent / "intent_metrics.json"
CM_OUT = Path(__file__).resolve().parent / "intent_confusion_matrix.png"


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


def plot_confusion(cm: np.ndarray, classes: list[str], out_path: Path) -> None:
    n = len(classes)
    size = max(6, n * 0.32)
    annotate = n <= 16
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
        title="Prompt Intent Confusion Matrix",
    )
    ax.tick_params(axis="both", labelsize=7)
    plt.setp(ax.get_xticklabels(), rotation=90, ha="center", rotation_mode="anchor")
    if annotate:
        thresh = cm.max() / 2.0 if cm.size else 0
        for i in range(n):
            for j in range(n):
                ax.text(j, i, format(cm[i, j], "d"), ha="center", va="center",
                        color="white" if cm[i, j] > thresh else "black")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


def main() -> None:
    texts, labels = load_dataset(DATA_CSV)
    classes = sorted(set(labels))
    print(f"Loaded {len(texts)} prompts, classes: {classes}")

    x_train, x_test, y_train, y_test = train_test_split(
        texts, labels, test_size=0.2, random_state=42, stratify=labels
    )

    pipeline = Pipeline(
        [
            ("tfidf", TfidfVectorizer(
                lowercase=True,
                ngram_range=(1, 2),
                min_df=1,
                sublinear_tf=True,
            )),
            ("clf", LogisticRegression(max_iter=1000, C=4.0, class_weight="balanced")),
        ]
    )

    pipeline.fit(x_train, y_train)

    y_pred = pipeline.predict(x_test)
    report = classification_report(y_test, y_pred, output_dict=True)
    labels_order = sorted(set(y_test) | set(y_pred))
    cm = confusion_matrix(y_test, y_pred, labels=labels_order)
    acc = report["accuracy"]
    print(f"Test accuracy: {acc:.3f}")
    print(classification_report(y_test, y_pred))

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, MODEL_OUT)
    LABELS_OUT.write_text(json.dumps(list(pipeline.classes_), indent=2), encoding="utf-8")

    metrics = {
        "classes": list(pipeline.classes_),
        "train_size": len(x_train),
        "test_size": len(x_test),
        "test_accuracy": acc,
        "classification_report": report,
    }
    METRICS_OUT.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    plot_confusion(cm, labels_order, CM_OUT)

    # Quick sanity demo on phrasing-vs-topic and fine-grained intents.
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
    for text in demo:
        pred = pipeline.predict([text])[0]
        conf = float(np.max(pipeline.predict_proba([text])[0]))
        print(f"  {text!r:55s} -> {pred} ({conf:.2f})")

    print(f"\nSaved model  -> {MODEL_OUT}")
    print(f"Saved labels -> {LABELS_OUT}")
    print(f"Confusion matrix -> {CM_OUT}")


if __name__ == "__main__":
    main()
