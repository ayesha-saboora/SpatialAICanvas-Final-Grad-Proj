"""
ASL Image Sorter — assign Camera Roll images to letter folders.
Letters: F, A, C, U, G, H  →  datasets/ASL Ayesha/<letter>/

Controls:
  F / A / C / U / G / H  — assign image to that letter folder
  BACKSPACE               — undo last assignment
  S                       — skip image (leave it unsorted)
  Q                       — quit and show summary
"""

import cv2
import os
import shutil
from glob import glob

CAMERA_ROLL = r"C:\Users\ayesh\OneDrive\Pictures\Camera Roll"
OUTPUT_BASE = os.path.join(os.path.dirname(__file__), "..", "datasets", "ASL Ayesha")
LETTERS = ["F", "A", "C", "U", "G", "H"]


def make_dirs():
    for l in LETTERS:
        os.makedirs(os.path.join(OUTPUT_BASE, l), exist_ok=True)


def get_all_images():
    files = glob(os.path.join(CAMERA_ROLL, "*.jpg"))
    files += glob(os.path.join(CAMERA_ROLL, "*.JPG"))
    files += glob(os.path.join(CAMERA_ROLL, "*.png"))
    files += glob(os.path.join(CAMERA_ROLL, "*.PNG"))
    return sorted(files)


def put_text(frame, text, pos, scale=0.9, color=(255, 255, 255), thickness=2):
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), thickness + 2)
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness)


def draw_hud(frame, idx, total, counts, last_action):
    h, w = frame.shape[:2]

    # top bar
    cv2.rectangle(frame, (0, 0), (w, 95), (30, 30, 30), -1)
    put_text(frame, f"Image {idx+1} / {total}   Remaining: {total - idx - 1}", (10, 35), 0.9, (255, 255, 255))

    # letter counts — two rows of 3
    row1 = f"F:{counts['F']}   A:{counts['A']}   C:{counts['C']}"
    row2 = f"U:{counts['U']}   G:{counts['G']}   H:{counts['H']}"
    put_text(frame, row1, (10, 62), 0.72, (0, 230, 255))
    put_text(frame, row2, (10, 88), 0.72, (0, 230, 255))

    # bottom bar
    cv2.rectangle(frame, (0, h - 80), (w, h), (30, 30, 30), -1)
    put_text(frame, "Keys:  F  A  C  U  G  H  to sort  |  S skip  |  BKSP undo  |  Q quit",
             (10, h - 48), 0.62, (200, 200, 200))

    if last_action:
        put_text(frame, last_action, (10, h - 14), 0.72, (100, 255, 100))

    return frame


def main():
    make_dirs()
    images = get_all_images()
    if not images:
        print("No images found in Camera Roll:", CAMERA_ROLL)
        return

    total = len(images)
    print(f"Found {total} images in Camera Roll. Sorting now...")

    counts = {l: 0 for l in LETTERS}
    history = []   # (src_path, dst_path) for undo
    last_action = ""
    idx = 0

    # key → letter mapping
    key_map = {ord(l.lower()): l for l in LETTERS}

    cv2.namedWindow("ASL Sorter", cv2.WINDOW_NORMAL)
    cv2.resizeWindow("ASL Sorter", 960, 760)

    while idx < total:
        src = images[idx]
        frame = cv2.imread(src)
        if frame is None:
            idx += 1
            continue

        # resize keeping aspect ratio
        h, w = frame.shape[:2]
        max_h, max_w = 620, 960
        scale = min(max_w / w, max_h / h)
        frame = cv2.resize(frame, (int(w * scale), int(h * scale)))

        # pad to fixed canvas
        canvas = cv2.copyMakeBorder(frame, 95, 80, 0,
                                    max(0, max_w - int(w * scale)),
                                    cv2.BORDER_CONSTANT, value=(50, 50, 50))
        canvas = draw_hud(canvas, idx, total, counts, last_action)

        cv2.imshow("ASL Sorter", canvas)
        key = cv2.waitKey(0) & 0xFF

        if key == ord('q'):
            break

        elif key in key_map:
            letter = key_map[key]
            fname = os.path.basename(src)
            # rename to avoid collisions: letter_originalname
            dst_name = f"{letter}_{fname}"
            dst_dir = os.path.join(OUTPUT_BASE, letter)
            dst = os.path.join(dst_dir, dst_name)
            shutil.copy2(src, dst)
            history.append((src, dst, letter))
            counts[letter] += 1
            last_action = f"Copied  {os.path.basename(src)}  →  {letter}/"
            idx += 1

        elif key == 8:  # BACKSPACE — undo
            if history:
                _, last_dst, letter = history.pop()
                if os.path.exists(last_dst):
                    os.remove(last_dst)
                counts[letter] = max(0, counts[letter] - 1)
                last_action = f"Undid last  ({letter}/)"
                idx = max(0, idx - 1)
            else:
                last_action = "Nothing to undo"

        elif key == ord('s'):
            last_action = f"Skipped  {os.path.basename(src)}"
            idx += 1

    cv2.destroyAllWindows()

    print("\n=== Done! ===")
    for l in LETTERS:
        folder = os.path.join(OUTPUT_BASE, l)
        n = len([f for f in os.listdir(folder)
                 if f.lower().endswith((".jpg", ".png"))])
        print(f"  {l}: {n} images  →  {folder}")
    print("\nOriginals are kept in Camera Roll (copies only).")


if __name__ == "__main__":
    main()
