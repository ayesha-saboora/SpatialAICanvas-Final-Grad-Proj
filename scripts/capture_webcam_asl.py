"""
Webcam ASL data capture tool.

Controls:
  A-Z       — set the current letter label
  SPACE     — capture and save the current frame
  D         — delete the last saved image (undo)
  C         — show per-letter count summary
  Q / ESC   — quit

Images are saved to:
  datasets/our_webcam/ASL_Dataset/<LETTER>/webcam_<LETTER>_<timestamp>.jpg

Run from repo root (no venv needed — only requires opencv-python):
  pip install opencv-python
  python scripts/capture_webcam_asl.py

Optional flags:
  --target 50     save this many images per letter before auto-advancing (default: off)
  --camera 0      webcam index (default 0)
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "datasets" / "our_webcam" / "ASL_Dataset"
LETTERS = [chr(ord("A") + i) for i in range(26)]


def count_existing(letter: str) -> int:
    folder = OUT_DIR / letter
    if not folder.is_dir():
        return 0
    return sum(1 for f in folder.iterdir() if f.suffix.lower() in {".jpg", ".jpeg", ".png"})


def print_summary(counts: dict[str, int]) -> None:
    print("\n--- Per-letter image counts ---")
    for letter in LETTERS:
        existing = count_existing(letter) + counts.get(letter, 0)
        bar = "█" * min(existing, 50)
        print(f"  {letter}: {existing:>4}  {bar}")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture webcam ASL images")
    parser.add_argument("--target", type=int, default=0, help="Auto-advance after N captures per letter (0 = off)")
    parser.add_argument("--camera", type=int, default=0, help="Webcam index")
    args = parser.parse_args()

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera index {args.camera}")

    current_letter = "A"
    session_counts: dict[str, int] = {l: 0 for l in LETTERS}
    last_saved: Path | None = None

    print("=== ASL Webcam Capture ===")
    print("Press A-Z to select letter, SPACE to capture, D to undo, C for counts, Q to quit")
    print(f"Current letter: {current_letter}  (existing: {count_existing(current_letter)})")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to read from camera.")
            break

        existing = count_existing(current_letter) + session_counts[current_letter]
        target_str = f"/{args.target}" if args.target else ""

        # Overlay
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (frame.shape[1], 70), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.5, frame, 0.5, 0, frame)
        cv2.putText(frame, f"Letter: {current_letter}   Captured: {existing}{target_str}",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        cv2.putText(frame, "SPACE=capture  D=undo  C=counts  Q=quit",
                    (10, 58), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 200), 1)

        # Draw a guide box in the centre
        h, w = frame.shape[:2]
        cx, cy, box = w // 2, h // 2, 200
        cv2.rectangle(frame, (cx - box, cy - box), (cx + box, cy + box), (0, 200, 255), 2)
        cv2.putText(frame, "place hand here", (cx - box + 5, cy - box - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 255), 1)

        cv2.imshow("ASL Capture", frame)

        key = cv2.waitKey(1) & 0xFF

        if key == ord("q") or key == 27:  # Q or ESC
            break

        elif chr(key).upper() in LETTERS:
            current_letter = chr(key).upper()
            print(f"Letter set to: {current_letter}  (existing: {count_existing(current_letter)})")

        elif key == ord(" "):  # SPACE — capture
            folder = OUT_DIR / current_letter
            folder.mkdir(parents=True, exist_ok=True)
            timestamp = int(time.time() * 1000)
            filename = folder / f"webcam_{current_letter}_{timestamp}.jpg"
            # Save the raw frame (no overlay)
            ret2, raw = cap.read()
            save_frame = raw if ret2 else frame
            cv2.imwrite(str(filename), save_frame)
            last_saved = filename
            session_counts[current_letter] += 1
            total = count_existing(current_letter)
            print(f"  Saved {filename.name}  (total {current_letter}: {total})")

            # Auto-advance to next letter if target reached
            if args.target and total >= args.target:
                idx = LETTERS.index(current_letter)
                if idx + 1 < len(LETTERS):
                    current_letter = LETTERS[idx + 1]
                    print(f"  Target reached! Moving to: {current_letter}")

        elif key == ord("d"):  # D — undo last save
            if last_saved and last_saved.is_file():
                last_saved.unlink()
                letter = last_saved.parent.name
                session_counts[letter] = max(0, session_counts[letter] - 1)
                print(f"  Deleted {last_saved.name}")
                last_saved = None
            else:
                print("  Nothing to undo.")

        elif key == ord("c"):  # C — summary
            print_summary(session_counts)

    cap.release()
    cv2.destroyAllWindows()
    print("\nSession summary:")
    print_summary(session_counts)


if __name__ == "__main__":
    main()
