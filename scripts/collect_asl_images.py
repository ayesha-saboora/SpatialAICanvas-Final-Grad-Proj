"""
ASL Image Collector — press SPACEBAR to capture one image at a time.
Saves to: datasets/ASL Ayesha/<letter>/<letter>_NNNN.jpg

Usage:
  python collect_asl_images.py                    # all letters, 100 total each
  python collect_asl_images.py A C F G H          # specific letters, 100 total each
  python collect_asl_images.py --more 100 A C F   # 100 MORE on top of existing
  python collect_asl_images.py --total 250        # capture until each letter hits 250

Controls:
  SPACE  — capture ONE image
  N      — move to next letter
  Q      — quit
"""

import cv2
import os
import sys
import time

ALL_LETTERS = ["F", "A", "C", "U", "G", "H"]
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "datasets", "ASL Ayesha")


def make_dirs(letters):
    for letter in letters:
        os.makedirs(os.path.join(OUTPUT_DIR, letter), exist_ok=True)


def count_existing(letter):
    folder = os.path.join(OUTPUT_DIR, letter)
    return len([f for f in os.listdir(folder)
                if f.lower().endswith((".jpg", ".png"))])


def put_text(frame, text, pos, scale=1.0, color=(255, 255, 255), thickness=2):
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), thickness + 2)
    cv2.putText(frame, text, pos, cv2.FONT_HERSHEY_SIMPLEX, scale, color, thickness)


def flash_feedback(cap, captured_this_session, target):
    """Show a green flash for ~0.2 s after each capture."""
    deadline = time.time() + 0.2
    while time.time() < deadline:
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.flip(frame, 1)
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (640, 480), (0, 200, 0), -1)
        cv2.addWeighted(overlay, 0.25, frame, 0.75, 0, frame)
        put_text(frame, f"CAPTURED  {captured_this_session}/{target}", (140, 260), 1.5, (0, 255, 80), 3)
        cv2.imshow("ASL Collector", frame)
        cv2.waitKey(1)


def main():
    args = sys.argv[1:]

    # parse --more N and --total N
    more_mode = False
    total_mode = False
    extra = 0
    total_target = 100

    if "--more" in args:
        idx = args.index("--more")
        try:
            extra = int(args[idx + 1])
            args = [a for i, a in enumerate(args) if i != idx and i != idx + 1]
            more_mode = True
        except (IndexError, ValueError):
            print("Usage: --more <number>  e.g. --more 100")
            return

    if "--total" in args:
        idx = args.index("--total")
        try:
            total_target = int(args[idx + 1])
            args = [a for i, a in enumerate(args) if i != idx and i != idx + 1]
            total_mode = True
        except (IndexError, ValueError):
            print("Usage: --total <number>  e.g. --total 250")
            return

    letter_args = [a.upper() for a in args if a.upper() in ALL_LETTERS]
    LETTERS = letter_args if letter_args else ALL_LETTERS

    make_dirs(LETTERS)
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print("ERROR: Could not open webcam.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    letter_idx = 0

    while letter_idx < len(LETTERS):
        letter = LETTERS[letter_idx]
        folder = os.path.join(OUTPUT_DIR, letter)
        existing = count_existing(letter)

        # target = fixed total (--total), existing + extra (--more), or 100
        if total_mode:
            target = total_target
        elif more_mode:
            target = existing + extra
        else:
            target = 100

        if existing >= target:
            print(f"  '{letter}': already at {existing}/{target}, skipping.")
            letter_idx += 1
            continue
        img_index = existing

        while True:
            ret, frame = cap.read()
            if not ret:
                continue
            frame = cv2.flip(frame, 1)

            current_count = count_existing(letter)
            captured_this_session = current_count - existing
            done = current_count >= target

            # ── HUD overlay ──────────────────────────────────────────────────
            overlay = frame.copy()
            cv2.rectangle(overlay, (0, 0), (640, 110), (20, 20, 20), -1)
            cv2.addWeighted(overlay, 0.65, frame, 0.35, 0, frame)

            put_text(frame,
                     f"Letter: {letter}   ({letter_idx+1}/{len(LETTERS)})",
                     (15, 45), 1.3, (0, 230, 255))

            if done:
                put_text(frame, f"{current_count}/{target} done!  N=next  Q=quit",
                         (15, 90), 0.8, (0, 255, 100))
            else:
                remaining = target - current_count
                put_text(frame,
                         f"{current_count}/{target}  ({remaining} left)   "
                         f"SPACE=snap   N=skip   Q=quit",
                         (15, 90), 0.7, (200, 200, 200))

            # progress bar toward total target
            bar_fill = int((current_count / max(target, 1)) * 600)
            bar_fill = min(bar_fill, 600)
            cv2.rectangle(frame, (20, 450), (620, 470), (60, 60, 60), -1)
            cv2.rectangle(frame, (20, 450), (20 + bar_fill, 470), (0, 200, 80), -1)

            cv2.imshow("ASL Collector", frame)
            key = cv2.waitKey(1) & 0xFF

            if key == ord('q'):
                print(f"\nQuit. Last letter: {letter}")
                cap.release()
                cv2.destroyAllWindows()
                _print_summary(LETTERS)
                return

            elif key == ord('n'):
                print(f"  '{letter}': {count_existing(letter)} total images.")
                letter_idx += 1
                break

            elif key == ord(' '):
                if done:
                    continue
                filename = os.path.join(folder, f"{letter}_{img_index:04d}.jpg")
                cv2.imwrite(filename, frame)
                img_index += 1
                flash_feedback(cap, img_index - existing, target - existing)

                if img_index >= target:
                    put_text(frame, "Done! Press N for next letter.", (80, 260),
                             1.0, (0, 255, 80), 2)
                    cv2.imshow("ASL Collector", frame)
                    cv2.waitKey(1)

    print("\nAll letters done!")
    cap.release()
    cv2.destroyAllWindows()
    _print_summary(LETTERS)


def _print_summary(letters):
    print("\n=== Summary ===")
    for letter in letters:
        folder = os.path.join(OUTPUT_DIR, letter)
        n = len([f for f in os.listdir(folder)
                 if f.lower().endswith((".jpg", ".png"))])
        print(f"  {letter}: {n} total images")
    print(f"\nSaved to: {os.path.abspath(OUTPUT_DIR)}")


if __name__ == "__main__":
    main()
