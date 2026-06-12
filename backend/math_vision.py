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
        "Read the handwritten math expression in this image. "
        "Reply with ONLY the expression using digits 0-9 and operators + - * / = ( ). "
        "No spaces, no words, no explanation. Example: 22+1="
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
    except Exception:
        return None

    raw = (resp.choices[0].message.content or "").strip()
    return _extract_expression(raw)


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
