"""Recognize a full handwritten expression from one canvas export."""

from __future__ import annotations

import re
from io import BytesIO

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from math_predict import predict_math_symbol, _preprocess_image, _to_ink_grayscale
from math_vision import recognize_expression_vision


def _crop_to_ink(gray: Image.Image) -> tuple[Image.Image, np.ndarray]:
    arr = np.array(gray)
    ink = arr < 245
    if not ink.any():
        return gray, ink
    rows = np.where(ink.any(axis=1))[0]
    cols = np.where(ink.any(axis=0))[0]
    pad = 6
    top = max(0, int(rows[0]) - pad)
    bottom = min(arr.shape[0], int(rows[-1]) + pad + 1)
    left = max(0, int(cols[0]) - pad)
    right = min(arr.shape[1], int(cols[-1]) + pad + 1)
    cropped = gray.crop((left, top, right, bottom))
    return cropped, np.array(cropped) < 245


def _connected_boxes(ink: np.ndarray, min_area: int = 30) -> list[tuple[int, int, int, int]]:
    h, w = ink.shape
    visited = np.zeros_like(ink, dtype=bool)
    boxes: list[tuple[int, int, int, int]] = []

    for y in range(h):
        for x in range(w):
            if not ink[y, x] or visited[y, x]:
                continue
            stack = [(y, x)]
            visited[y, x] = True
            min_x = max_x = x
            min_y = max_y = y
            while stack:
                cy, cx = stack.pop()
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and ink[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
            area = (max_x - min_x + 1) * (max_y - min_y + 1)
            if area >= min_area:
                boxes.append((min_x, min_y, max_x + 1, max_y + 1))

    boxes.sort(key=lambda b: b[0])
    return boxes


def _merge_equals_fragments(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    """Merge only stacked fragments of '=' (two lines), never adjacent characters."""
    if len(boxes) <= 1:
        return boxes
    merged: list[list[int]] = [list(boxes[0])]
    for l, t, r, b in boxes[1:]:
        ml, mt, mr, mb = merged[-1]
        w_a, w_b = mr - ml, r - l
        h_a, h_b = mb - mt, b - t
        h_overlap = min(mr, r) - max(ml, l)
        v_gap = t - mb if t >= mb else (mt - b if mt >= b else -1)
        overlap_ratio = h_overlap / max(1, min(w_a, w_b))
        # Same x-band, vertically stacked thin lines → equals sign
        if overlap_ratio > 0.55 and 0 <= v_gap <= max(h_a, h_b) * 0.9:
            merged[-1] = [min(ml, l), min(mt, t), max(mr, r), max(mb, b)]
        else:
            merged.append([l, t, r, b])
    return [tuple(b) for b in merged]


def _crop_box(arr: np.ndarray, box: tuple[int, int, int, int]) -> Image.Image:
    left, top, right, bottom = box
    patch = arr[top:bottom, left:right]
    side = max(patch.shape[0], patch.shape[1], 12)
    img = Image.fromarray(patch.astype(np.uint8), mode="L")
    return ImageOps.pad(img, (side, side), color=255, centering=(0.5, 0.5))


def _classify_crop(crop: Image.Image) -> dict:
    buf = BytesIO()
    prepped = _preprocess_image(crop)
    prepped.save(buf, format="PNG")
    return predict_math_symbol(buf.getvalue())


def _recognize_with_cnn(image_bytes: bytes) -> dict:
    gray = _to_ink_grayscale(Image.open(BytesIO(image_bytes)))
    cropped, ink = _crop_to_ink(gray)
    arr = np.array(cropped)

    boxes = _merge_equals_fragments(_connected_boxes(ink))
    if not boxes:
        buf = BytesIO()
        _preprocess_image(cropped).save(buf, format="PNG")
        one = predict_math_symbol(buf.getvalue())
        return {"expression": one["symbol"], "symbols": [one]}

    symbols: list[dict] = []
    for box in boxes:
        crop = _crop_box(arr, box)
        crop = crop.filter(ImageFilter.MaxFilter(3))
        symbols.append(_classify_crop(crop))

    expression = "".join(str(s["symbol"]) for s in symbols)
    return {"expression": expression, "symbols": symbols}


def recognize_expression_image(image_bytes: bytes) -> dict:
    """Vision LLM first, then CNN segmentation fallback."""
    if not image_bytes:
        raise ValueError("Empty image")

    vision_expr = recognize_expression_vision(image_bytes)
    if vision_expr:
        cleaned = re.sub(r"[^0-9+\-*/=().]", "", vision_expr)
        if cleaned:
            return {"expression": cleaned, "symbols": [], "source": "vision"}

    result = _recognize_with_cnn(image_bytes)
    result["source"] = "cnn"
    return result
