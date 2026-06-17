"""Recognize a full handwritten expression from canvas export."""

from __future__ import annotations

import re
from io import BytesIO

import numpy as np
from PIL import Image, ImageFilter, ImageOps

from math_eval import evaluate_expression, normalize_expression
from math_predict import MODEL_PATH, predict_math_symbol, predict_math_symbols_batch, _preprocess_image, _to_ink_grayscale
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


def _connected_boxes(ink: np.ndarray, min_area: int = 24) -> list[tuple[int, int, int, int]]:
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
        if overlap_ratio > 0.55 and 0 <= v_gap <= max(h_a, h_b) * 0.9:
            merged[-1] = [min(ml, l), min(mt, t), max(mr, r), max(mb, b)]
        else:
            merged.append([l, t, r, b])
    return [tuple(b) for b in merged]


def _merge_adjacent_digit_boxes(boxes: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
    if len(boxes) <= 1:
        return boxes
    merged: list[list[int]] = [list(boxes[0])]
    for l, t, r, b in boxes[1:]:
        ml, mt, mr, mb = merged[-1]
        gap = l - mr
        w_prev = mr - ml
        h_prev = mb - mt
        h_cur = b - t
        v_overlap = min(mb, b) - max(mt, t)
        v_ratio = v_overlap / max(1, min(h_prev, h_cur))
        # Wider gap tolerance for multi-digit numbers (110, 55, 120).
        if 0 <= gap <= max(14, w_prev * 0.85) and v_ratio > 0.35:
            merged[-1] = [ml, min(mt, t), max(mr, r), max(mb, b)]
        else:
            merged.append([l, t, r, b])
    return [tuple(b) for b in merged]


def _crop_box(arr: np.ndarray, box: tuple[int, int, int, int]) -> Image.Image:
    left, top, right, bottom = box
    patch = arr[top:bottom, left:right]
    side = max(patch.shape[0], patch.shape[1], 12)
    img = Image.fromarray(patch.astype(np.uint8), mode="L")
    return ImageOps.pad(img, (side, side), color=255, centering=(0.5, 0.5))


def _avg_confidence(symbols: list[dict]) -> float:
    if not symbols:
        return 0.0
    return sum(float(s.get("confidence", 0)) for s in symbols) / len(symbols)


def _recognize_with_cnn(image_bytes: bytes) -> dict:
    gray = _to_ink_grayscale(Image.open(BytesIO(image_bytes)))
    cropped, ink = _crop_to_ink(gray)
    arr = np.array(cropped)

    boxes = _merge_equals_fragments(_merge_adjacent_digit_boxes(_connected_boxes(ink)))
    if not boxes:
        buf = BytesIO()
        _preprocess_image(cropped).save(buf, format="PNG")
        one = predict_math_symbol(buf.getvalue())
        return {"expression": one["symbol"], "symbols": [one]}

    crops: list[Image.Image] = []
    for box in boxes:
        crop = _crop_box(arr, box)
        crop = crop.filter(ImageFilter.MaxFilter(3))
        crops.append(crop)

    symbols = predict_math_symbols_batch(crops)
    expression = "".join(str(s["symbol"]) for s in symbols)
    return {"expression": expression, "symbols": symbols}


def _recognize_per_symbol_crops(symbol_images: list[bytes]) -> dict | None:
    """One CNN prediction per tldraw stroke — best segmentation for 5+2, 55-3."""
    if not symbol_images or not MODEL_PATH.is_file():
        return None
    crops: list[Image.Image] = []
    for raw in symbol_images:
        if not raw:
            continue
        gray = _to_ink_grayscale(Image.open(BytesIO(raw)))
        crops.append(_preprocess_image(gray))
    if not crops:
        return None
    symbols = predict_math_symbols_batch(crops)
    expression = "".join(str(s["symbol"]) for s in symbols)
    return {"expression": expression, "symbols": symbols}


def _score_candidate(expr: str, symbols: list[dict], source: str) -> float:
    normalized = normalize_expression(expr)
    if not normalized or not any(c.isdigit() for c in normalized):
        return -1.0
    score = 0.0
    result = evaluate_expression(normalized)
    if result is not None:
        score += 100.0
    conf = _avg_confidence(symbols)
    score += conf * 40.0
    if source == "vision":
        score += 25.0
    elif source == "shapes":
        score += 15.0
    score += min(len(normalized), 20) * 0.5
    return score


def _pick_best(candidates: list[dict]) -> dict:
    if not candidates:
        raise ValueError("No recognition candidates")
    ranked = sorted(candidates, key=lambda c: _score_candidate(
        c.get("expression", ""), c.get("symbols", []), c.get("source", ""),
    ), reverse=True)
    return ranked[0]


def recognize_expression_image(
    image_bytes: bytes,
    symbol_images: list[bytes] | None = None,
) -> dict:
    """Vision + per-stroke CNN + whole-image CNN; pick the candidate that evaluates."""
    if not image_bytes:
        raise ValueError("Empty image")

    candidates: list[dict] = []

    # Vision reads full expression — best for 110+120 and messy handwriting.
    vision_expr = recognize_expression_vision(image_bytes)
    if vision_expr:
        cleaned = normalize_expression(vision_expr)
        if cleaned:
            candidates.append({
                "expression": cleaned,
                "symbols": [],
                "source": "vision",
            })

    # Per-stroke crops from frontend (one tldraw shape = one symbol).
    if symbol_images:
        try:
            shapes = _recognize_per_symbol_crops(symbol_images)
            if shapes and shapes.get("expression"):
                shapes["source"] = "shapes"
                candidates.append(shapes)
        except Exception as exc:
            print(f"[math] per-symbol path failed: {exc!r}")

    # Whole-image CNN segmentation fallback.
    if MODEL_PATH.is_file():
        try:
            cnn = _recognize_with_cnn(image_bytes)
            if cnn.get("expression"):
                cnn["source"] = "cnn"
                candidates.append(cnn)
        except Exception as exc:
            print(f"[math] CNN path failed: {exc!r}")

    if not candidates:
        if MODEL_PATH.is_file():
            result = _recognize_with_cnn(image_bytes)
            result["source"] = "cnn"
        else:
            raise FileNotFoundError("Math CNN model missing and vision unavailable.")
    else:
        result = _pick_best(candidates)

    expr = normalize_expression(result.get("expression", ""))
    result["expression"] = expr
    result["result"] = evaluate_expression(expr)
    return result
