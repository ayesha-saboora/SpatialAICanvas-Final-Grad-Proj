"""
Merge Roboflow + webcam images into datasets/asl_combined/ with train/valid/test splits.

Sources:
  American Sign Language Letters/train/   (Roboflow — flat folder + _annotations.coco.json)
  American Sign Language Letters/valid/
  American Sign Language Letters/test/
  datasets/our_webcam/ASL_Dataset/<LETTER>/   (your webcam captures)

Output:
  datasets/asl_combined/train/<LETTER>/
  datasets/asl_combined/valid/<LETTER>/
  datasets/asl_combined/test/<LETTER>/

Webcam images are split 80/10/10 (train/valid/test).
Roboflow images keep their original split, sorted by COCO annotation.

Run from repo root:
  python scripts/merge_datasets.py
"""

from __future__ import annotations

import json
import random
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROBOFLOW_DIR = ROOT / "American Sign Language Letters"
WEBCAM_DIR = ROOT / "datasets" / "our_webcam" / "ASL_Dataset"
OUT_DIR = ROOT / "datasets" / "asl_combined"
LETTERS = [chr(ord("A") + i) for i in range(26)]
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

random.seed(42)


# ---------------------------------------------------------------------------
# Roboflow COCO-format reader
# ---------------------------------------------------------------------------

def copy_roboflow_coco_split(split_dir: Path, out_split_dir: Path) -> dict[str, int]:
    """
    Read _annotations.coco.json from a flat Roboflow split folder,
    copy each image into out_split_dir/<LETTER>/ based on its annotation.
    Returns per-letter counts.
    """
    counts: dict[str, int] = {l: 0 for l in LETTERS}
    anno_path = split_dir / "_annotations.coco.json"

    if not anno_path.is_file():
        # Fallback: try folder-per-class layout (some Roboflow exports)
        for letter in LETTERS:
            for candidate in (split_dir / letter, split_dir / letter.lower()):
                if candidate.is_dir():
                    dst = out_split_dir / letter
                    dst.mkdir(parents=True, exist_ok=True)
                    for img in candidate.iterdir():
                        if img.suffix.lower() in IMG_EXT and img.is_file():
                            dst_file = dst / f"rf_{img.name}"
                            if not dst_file.exists():
                                shutil.copy2(img, dst_file)
                            counts[letter] += 1
        return counts

    data = json.loads(anno_path.read_text(encoding="utf-8"))

    # Map category id → letter
    id_to_letter: dict[int, str] = {}
    for cat in data.get("categories", []):
        name = cat.get("name", "").upper()
        if name in LETTERS:
            id_to_letter[cat["id"]] = name

    # Map image id → filename
    id_to_file: dict[int, str] = {
        img["id"]: img["file_name"] for img in data.get("images", [])
    }

    # Map image id → letter (first annotation wins)
    img_to_letter: dict[int, str] = {}
    for ann in data.get("annotations", []):
        img_id = ann["image_id"]
        if img_id in img_to_letter:
            continue
        letter = id_to_letter.get(ann.get("category_id", -1))
        if letter:
            img_to_letter[img_id] = letter

    # Copy files
    for img_id, letter in img_to_letter.items():
        fname = id_to_file.get(img_id)
        if not fname:
            continue
        src = split_dir / fname
        if not src.is_file():
            continue
        dst_dir = out_split_dir / letter
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst_file = dst_dir / f"rf_{src.name}"
        if not dst_file.exists():
            shutil.copy2(src, dst_file)
        counts[letter] += 1

    return counts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"Output directory: {OUT_DIR}")
    totals: dict[str, dict[str, int]] = {l: {"train": 0, "valid": 0, "test": 0} for l in LETTERS}

    # --- Roboflow splits ---
    for split in ("train", "valid", "test"):
        split_dir = ROBOFLOW_DIR / split
        if not split_dir.is_dir():
            print(f"  [skip] Roboflow {split}/ not found")
            continue
        out_split_dir = OUT_DIR / split
        print(f"  Processing Roboflow {split}/...")
        counts = copy_roboflow_coco_split(split_dir, out_split_dir)
        for letter, n in counts.items():
            totals[letter][split] += n
        print(f"    Copied {sum(counts.values())} images")

    # --- Webcam images (split 80/10/10) ---
    if WEBCAM_DIR.is_dir():
        print(f"  Processing webcam data from {WEBCAM_DIR}...")
        webcam_total = 0
        for letter in LETTERS:
            webcam_src = WEBCAM_DIR / letter
            if not webcam_src.is_dir():
                continue
            imgs = [p for p in webcam_src.iterdir() if p.suffix.lower() in IMG_EXT and p.is_file()]
            if not imgs:
                continue
            random.shuffle(imgs)
            n = len(imgs)
            t1 = int(n * 0.80)
            t2 = int(n * 0.90)
            splits_map = {
                "train": imgs[:t1],
                "valid": imgs[t1:t2],
                "test":  imgs[t2:],
            }
            for split, files in splits_map.items():
                dst_dir = OUT_DIR / split / letter
                dst_dir.mkdir(parents=True, exist_ok=True)
                for f in files:
                    dst = dst_dir / f"wc_{f.name}"
                    if not dst.exists():
                        shutil.copy2(f, dst)
                    totals[letter][split] += 1
                    webcam_total += 1
        print(f"    Copied {webcam_total} webcam images")
    else:
        print(f"  [skip] No webcam data found at {WEBCAM_DIR}")

    # --- Summary ---
    print("\n--- Merge Summary (images per letter) ---")
    print(f"  {'Letter':<8} {'Train':>6} {'Valid':>6} {'Test':>6} {'Total':>6}")
    grand = {"train": 0, "valid": 0, "test": 0}
    for letter in LETTERS:
        t = totals[letter]
        total = t["train"] + t["valid"] + t["test"]
        print(f"  {letter:<8} {t['train']:>6} {t['valid']:>6} {t['test']:>6} {total:>6}")
        for s in grand:
            grand[s] += t[s]
    grand_total = sum(grand.values())
    print(f"  {'TOTAL':<8} {grand['train']:>6} {grand['valid']:>6} {grand['test']:>6} {grand_total:>6}")
    print(f"\nDone. Merged dataset at: {OUT_DIR}")
    print("Now re-run: python ml/train_asl_custom3.py --epochs 50")


if __name__ == "__main__":
    main()
