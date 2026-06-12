"""
Merge Roboflow ASL dataset with custom webcam photos into letter-folder layout.

Usage:
  python merge_datasets.py
  python merge_datasets.py --webcam-dir "../datasets/our_webcam" --out-dir "../datasets/asl_combined"

Expected webcam zip layout (any of these after unzip):
  our_webcam/A/*.jpg
  our_webcam/train/A/*.jpg
  our_webcam/photos/A/*.jpg
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROBOFLOW = ROOT / "American Sign Language Letters"
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
LETTERS = [chr(ord("A") + i) for i in range(26)]


def load_coco_split(split_dir: Path) -> list[tuple[Path, str]]:
    anno = split_dir / "_annotations.coco.json"
    if not anno.is_file():
        return []

    data = json.loads(anno.read_text(encoding="utf-8"))
    id_to_name = {
        cat["id"]: cat["name"].upper()
        for cat in data.get("categories", [])
        if cat.get("name", "").upper() in LETTERS
    }
    image_id_to_file = {img["id"]: img["file_name"] for img in data.get("images", [])}
    image_id_to_letter: dict[int, str] = {}
    for ann in data.get("annotations", []):
        img_id = ann["image_id"]
        if img_id in image_id_to_letter:
            continue
        letter = id_to_name.get(ann.get("category_id", -1))
        if letter:
            image_id_to_letter[img_id] = letter

    samples: list[tuple[Path, str]] = []
    for img_id, letter in image_id_to_letter.items():
        fname = image_id_to_file.get(img_id)
        if not fname:
            continue
        path = split_dir / fname
        if path.is_file():
            samples.append((path, letter))
    return samples


def find_webcam_root(webcam_dir: Path) -> Path:
    if not webcam_dir.is_dir():
        raise FileNotFoundError(f"Webcam folder not found: {webcam_dir}")

    for candidate in (
        webcam_dir,
        webcam_dir / "ASL_Dataset",
        webcam_dir / "ASL dataset",
        webcam_dir / "train",
        webcam_dir / "photos",
        webcam_dir / "images",
    ):
        if any((candidate / letter).is_dir() for letter in LETTERS[:5]):
            return candidate
    raise FileNotFoundError(
        f"No letter folders (A, B, C, ...) found under {webcam_dir}. "
        "Unzip so you have e.g. datasets/our_webcam/A/*.jpg"
    )


def copy_image(src: Path, dest_dir: Path, prefix: str) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{prefix}{src.suffix.lower()}"
    n = 0
    while dest.exists():
        n += 1
        dest = dest_dir / f"{prefix}_{n}{src.suffix.lower()}"
    shutil.copy2(src, dest)


def merge(webcam_dir: Path, out_dir: Path) -> None:
    if out_dir.exists():
        shutil.rmtree(out_dir)

    splits = {"train": ROBOFLOW / "train", "valid": ROBOFLOW / "valid", "test": ROBOFLOW / "test"}
    counts: dict[str, dict[str, int]] = {s: {} for s in splits}

    for split, split_dir in splits.items():
        if not split_dir.is_dir():
            continue
        for src, letter in load_coco_split(split_dir):
            dest = out_dir / split / letter
            copy_image(src, dest, f"rf_{src.stem}")
            counts[split][letter] = counts[split].get(letter, 0) + 1

    webcam_root = find_webcam_root(webcam_dir)
    webcam_counts: dict[str, int] = {}
    for letter in LETTERS:
        letter_dir = webcam_root / letter
        if not letter_dir.is_dir():
            letter_dir = webcam_root / letter.lower()
        if not letter_dir.is_dir():
            continue
        for img in letter_dir.iterdir():
            if img.suffix.lower() in IMG_EXT and img.is_file():
                dest = out_dir / "train" / letter
                copy_image(img, dest, f"wc_{img.stem}")
                webcam_counts[letter] = webcam_counts.get(letter, 0) + 1

    print(f"Output -> {out_dir}")
    for split in ("train", "valid", "test"):
        total = sum(counts[split].values())
        if total:
            print(f"  {split}: {total} Roboflow images")
    if webcam_counts:
        print(f"  train: +{sum(webcam_counts.values())} webcam images")
        print("  Webcam letters:", ", ".join(f"{k}({v})" for k, v in sorted(webcam_counts.items())))
    else:
        print("  WARNING: no webcam images found — check unzip path.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge Roboflow + webcam ASL photos")
    parser.add_argument("--webcam-dir", type=Path, default=ROOT / "datasets" / "our_webcam")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "datasets" / "asl_combined")
    args = parser.parse_args()
    merge(args.webcam_dir.resolve(), args.out_dir.resolve())


if __name__ == "__main__":
    main()
