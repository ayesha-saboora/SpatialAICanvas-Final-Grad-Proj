import os
import json

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="StudyCanvas API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExplainRequest(BaseModel):
    text: str = Field(..., min_length=3, max_length=3000)
    language: str = Field(default="English", min_length=2, max_length=30)


class ExplainResponse(BaseModel):
    explanation: str
    visual_steps: list[str]


LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")


def get_llm_client() -> OpenAI:
    if LLM_PROVIDER == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(status_code=500, detail="OPENAI_API_KEY is missing in backend .env")
        return OpenAI(api_key=api_key)

    # Default local free mode (Ollama)
    return OpenAI(base_url=OLLAMA_BASE_URL, api_key="ollama")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ai/explain", response_model=ExplainResponse)
def explain(payload: ExplainRequest):
    client = get_llm_client()
    model = OPENAI_MODEL if LLM_PROVIDER == "openai" else OLLAMA_MODEL

    try:
        completion = client.chat.completions.create(
            model=model,
            temperature=0.2,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a helpful tutor for whiteboard learning. "
                        "Always return valid JSON only with this schema: "
                        '{"explanation":"string","visual_steps":["string","string"]}. '
                        "The explanation should be concise and clear. "
                        "visual_steps must be short box labels that can be drawn on a diagram."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Explain this in {payload.language}:\n\n{payload.text}\n\n"
                        "Rules:\n"
                        "1) explanation: 6-10 short lines max.\n"
                        "2) visual_steps: 4-8 brief phrases, each under 10 words.\n"
                        "3) No markdown. JSON only."
                    ),
                },
            ],
        )
    except Exception as exc:
        if LLM_PROVIDER != "openai":
            raise HTTPException(
                status_code=502,
                detail=(
                    "Local AI request failed. Make sure Ollama is running and the model exists. "
                    "Run: ollama run llama3.2:3b"
                ),
            ) from exc
        raise HTTPException(status_code=502, detail=f"AI request failed: {exc}") from exc

    content = (completion.choices[0].message.content or "").strip()
    if not content:
        return ExplainResponse(
            explanation="No explanation returned.",
            visual_steps=["Topic", "Key point 1", "Key point 2", "Summary"],
        )

    try:
        data = json.loads(content)
        explanation = str(data.get("explanation", "")).strip() or "No explanation returned."
        visual_steps = [str(step).strip() for step in data.get("visual_steps", []) if str(step).strip()]
    except Exception:
        # Fallback for models that return plain text instead of strict JSON.
        explanation = content
        visual_steps = []

    if not visual_steps:
        visual_steps = ["Topic", "Definition", "How it works", "Example", "Summary"]

    return ExplainResponse(explanation=explanation, visual_steps=visual_steps[:8])