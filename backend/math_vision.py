"""Read handwritten math via vision LLM (primary path for canvas handwriting)."""

from __future__ import annotations

import base64
import os
import re

from openai import OpenAI


def _vision_client() -> OpenAI | None:
    provider = os.getenv("LLM_PROVIDER", "ollama").lower()
    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return None
        base_url = os.getenv("OPENAI_BASE_URL")
        return OpenAI(api_key=api_key, base_url=base_url) if base_url else OpenAI(api_key=api_key)
    # Ollama with vision-capable model
    return OpenAI(base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1"), api_key="ollama")


def _vision_model() -> str:
    if os.getenv("LLM_PROVIDER", "ollama").lower() == "openai":
        return os.getenv("OPENAI_VISION_MODEL", "llama-3.2-11b-vision-preview")
    return os.getenv("OLLAMA_VISION_MODEL", "moondream")


def recognize_expression_vision(image_bytes: bytes) -> str | None:
    """Return a compact expression like 22+1= or None if vision is unavailable."""
    client = _vision_client()
    if client is None:
        return None

    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    prompt = (
        "Read the handwritten math expression in this image. It may contain several "
        "digits, operators, and parentheses (e.g. 2+3-5= or (5-2)+10=). "
        "Reply with ONLY the expression using digits 0-9 and operators + - * / = ( ). "
        "Read every symbol left to right in order — do not skip, merge, or reorder any "
        "of them, even if there are several operators or a parenthesized group. "
        "Adjacent digits with no operator between them are one multi-digit number "
        "(e.g. '1' next to '0' is 10, not 1 and 0 separately). "
        "Look carefully at each operator stroke: '-' is a single short horizontal line, "
        "'*' is two crossing diagonal strokes (an X shape), '+' is a horizontal line crossed "
        "by a vertical line. Do not confuse '-' with '*' or '+'. "
        "No spaces, no words, no explanation. Examples: 22+1=  2+3-5=  (5-2)+10="
    )
    try:
        resp = client.chat.completions.create(
            model=_vision_model(),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    ],
                }
            ],
            max_tokens=40,
            temperature=0,
        )
    except Exception as e:
        print(f"[math_vision] vision call failed: {e!r}")
        return None

    raw = (resp.choices[0].message.content or "").strip()
    print(f"[math_vision] raw model output: {raw!r}")
    extracted = _extract_expression(raw)
    print(f"[math_vision] extracted expression: {extracted!r}")
    return extracted


def _extract_expression(raw: str) -> str | None:
    """Pull a compact expression from LLM prose or bare output."""
    quoted = re.findall(r'"([^"]*\d[^"]*)"', raw)
    for chunk in quoted:
        cleaned = re.sub(r"[^0-9+\-*/=().]", "", chunk.replace(" ", ""))
        if cleaned:
            return cleaned

    match = re.search(r"(\d+\s*[+\-*/]\s*\d+\s*=)", raw)
    if match:
        return re.sub(r"[^0-9+\-*/=().]", "", match.group(1).replace(" ", ""))

    cleaned = re.sub(r"[^0-9+\-*/=().]", "", raw.replace(" ", ""))
    return cleaned or None
