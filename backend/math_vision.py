"""Read handwritten math via vision LLM (fallback when CNN is uncertain)."""

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
    return OpenAI(base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1"), api_key="ollama")


def _vision_model() -> str:
    if os.getenv("LLM_PROVIDER", "ollama").lower() == "openai":
        return os.getenv("OPENAI_VISION_MODEL", "llama-3.2-11b-vision-preview")
    return os.getenv("OLLAMA_VISION_MODEL", "moondream")


def recognize_expression_vision(image_bytes: bytes) -> str | None:
    """Return a compact expression like (5-2)+10= or None if vision is unavailable."""
    client = _vision_client()
    if client is None:
        return None

    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    prompt = (
        "Read the handwritten math equation left-to-right. "
        "Use digits 0-9 and operators + - * / and parentheses ( ) and equals =. "
        "Digits written next to each other with NO operator between them form ONE number "
        "(e.g. three strokes 1,1,0 means 110 not 1,1,0). "
        "Reply ONLY with the expression, no spaces, no words. "
        "Examples: 5+2=  55-3=  110+120=  (5-2)+10="
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
            max_tokens=24,
            temperature=0,
        )
    except Exception as e:
        print(f"[math_vision] failed: {e!r}")
        return None

    raw = (resp.choices[0].message.content or "").strip()
    return _extract_expression(raw)


def _extract_expression(raw: str) -> str | None:
    """Pull a compact expression from LLM output."""
    # Prefer longest valid expression chunk.
    candidates: list[str] = []
    for chunk in re.findall(r"[\d+\-*/=().]+", raw.replace(" ", "")):
        cleaned = re.sub(r"[^0-9+\-*/=().]", "", chunk)
        if cleaned and any(c.isdigit() for c in cleaned):
            candidates.append(cleaned)
    if candidates:
        return max(candidates, key=len)

    cleaned = re.sub(r"[^0-9+\-*/=().]", "", raw.replace(" ", ""))
    return cleaned or None
