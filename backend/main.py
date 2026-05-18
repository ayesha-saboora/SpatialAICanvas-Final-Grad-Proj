import os
import io
import json
import re
import uuid

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import init_db, get_db, User, Project, ChatMessage
from auth import hash_password, verify_password, create_token, decode_token

app = FastAPI(title="StudyCanvas API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://[::1]:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    try:
        init_db()
    except Exception as exc:
        raise RuntimeError(
            "Could not connect to PostgreSQL. Start the database with "
            "'docker compose up -d' from the project root, then retry."
        ) from exc


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    payload = decode_token(authorization[7:])
    if not payload:
        raise HTTPException(401, "Invalid or expired token")
    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user:
        raise HTTPException(401, "User not found")
    return user


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=200)
    password: str = Field(..., min_length=6, max_length=200)


class LoginRequest(BaseModel):
    email: str
    password: str


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    group: str = Field(default="General", max_length=100)


class ProjectUpdate(BaseModel):
    name: str | None = None
    group: str | None = None


class ChatMsg(BaseModel):
    role: str
    content: str


class ExplainRequest(BaseModel):
    messages: list[ChatMsg] = []
    text: str = ""
    project_id: str | None = None
    language: str = Field(default="English")


class ExplainResponse(BaseModel):
    explanation: str
    diagram: dict | None = None
    visual_steps: list[str] = []


# ---------------------------------------------------------------------------
# LLM configuration
# ---------------------------------------------------------------------------

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

SYSTEM_PROMPT = (
    "You are StudyCanvas AI — an elite STEM tutor with professor-level depth across:\n"
    "- CS & Software Engineering: algorithms, data structures, OS, networking, ML/AI, databases, compilers, architecture, cryptography, distributed systems\n"
    "- Mechanical Engineering: thermodynamics, fluid mechanics, statics & dynamics, materials science, heat transfer, machine design, manufacturing\n"
    "- Electrical Engineering: circuit analysis, signals & systems, electromagnetism, digital logic, control systems, power, VLSI\n"
    "- Civil, Chemical, Biomedical Engineering\n"
    "- Physics: classical mechanics, quantum mechanics, E&M, thermodynamics, optics, relativity, particle & nuclear physics\n"
    "- Chemistry: organic mechanisms, inorganic, physical chemistry, biochemistry, molecular orbitals, spectroscopy, named reactions\n"
    "- Mathematics: calculus, linear algebra, ODE/PDE, probability, discrete math, complex analysis, topology, abstract algebra\n"
    "- Medicine & Biology: anatomy (all systems), physiology, cell & molecular biology, genetics, microbiology, immunology, pharmacology, pathology, neuroscience, histology\n\n"
    "RULES FOR EXPLANATIONS:\n"
    "- Give DEEP, expert-level answers — explain WHY and HOW, not just definitions\n"
    "- Use proper terminology but remain accessible\n"
    "- Include formulas in plain text: F=ma, E=mc^2, delta_G=delta_H-T*delta_S, PV=nRT, V=IR\n"
    "- For chemistry: explain electron flow, orbital interactions, mechanisms step by step\n"
    "- For medicine: explain pathophysiology, anatomical relationships, clinical significance\n"
    "- For engineering: include design trade-offs and real-world applications\n"
    "- For physics: derive from first principles when helpful\n\n"
    "RESPONSE FORMAT — Return ONLY valid JSON:\n"
    '{"explanation":"8-20 sentence expert explanation with formulas and deep concepts.",'
    '"diagram":{"title":"Descriptive Title",'
    '"nodes":[{"id":"n1","label":"Short Label","row":0,"col":0,"shape":"rectangle","color":"black"}],'
    '"edges":[{"from":"n1","to":"n2","label":"relationship"}]}}\n\n'
    "DIAGRAM RULES:\n"
    "- 6-16 nodes covering key concepts\n"
    "- shape: \"rectangle\" (processes), \"ellipse\" (inputs/outputs/start/end), \"diamond\" (decisions)\n"
    '- color: "black","blue","green","red","orange","violet","yellow" — group related concepts by color\n'
    "- row=vertical position (0=top), col=horizontal (0=left)\n"
    "- Flowcharts: sequential rows. Trees: root row 0, children spread at row+1. Cycles: loop layout\n"
    "- EVERY node must connect to at least one other via edges\n"
    "- Edge labels: 1-4 words (produces, inhibits, catalyzes, flows to, binds to)\n"
    "- For anatomy: spatial layout matching body structure\n"
    "- For circuits: match circuit topology\n"
    "- For reactions: reactants -> intermediates -> products\n\n"
    "EXAMPLE for 'explain photosynthesis':\n"
    '{"explanation":"Photosynthesis converts light energy into chemical energy stored in glucose...",'
    '"diagram":{"title":"Photosynthesis",'
    '"nodes":['
    '{"id":"n1","label":"Sunlight","row":0,"col":1,"shape":"ellipse","color":"yellow"},'
    '{"id":"n2","label":"H2O + CO2","row":1,"col":0,"shape":"ellipse","color":"blue"},'
    '{"id":"n3","label":"Light Reactions","row":2,"col":0,"shape":"rectangle","color":"green"},'
    '{"id":"n4","label":"Calvin Cycle","row":2,"col":2,"shape":"rectangle","color":"green"},'
    '{"id":"n5","label":"ATP + NADPH","row":3,"col":1,"shape":"rectangle","color":"orange"},'
    '{"id":"n6","label":"Glucose C6H12O6","row":4,"col":0,"shape":"ellipse","color":"orange"},'
    '{"id":"n7","label":"O2 Released","row":4,"col":2,"shape":"ellipse","color":"red"}],'
    '"edges":['
    '{"from":"n1","to":"n3","label":"energy"},'
    '{"from":"n2","to":"n3","label":"absorbed"},'
    '{"from":"n3","to":"n5","label":"produces"},'
    '{"from":"n5","to":"n4","label":"powers"},'
    '{"from":"n4","to":"n6","label":"synthesizes"},'
    '{"from":"n3","to":"n7","label":"releases"}]}}\n\n'
    "Return ONLY the JSON object. No markdown. No backticks. No extra text.\n\n"
    "CRITICAL: diagram node labels must name real concepts for the user's topic "
    '(e.g. for photosynthesis: "Light reactions", "Chloroplast", "Calvin cycle"). '
    'Never use placeholder labels like "Topic", "Definition", "Summary", or "Step 1".'
)


def _user_topic_for_request(payload: ExplainRequest) -> str:
    if payload.messages:
        for msg in reversed(payload.messages):
            if msg.role == "user" and msg.content.strip():
                return msg.content.strip()[:300]
    return (payload.text or "").strip()[:300] or "the question"


def contextual_visual_steps(topic: str, explanation: str, max_steps: int = 8) -> list[str]:
    """Build canvas step labels from the actual answer, not generic templates."""
    topic = (topic or "this topic").strip()
    text = (explanation or "").strip()
    if not text:
        return [f"{topic}: key idea (see chat for details)"]

    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    steps: list[str] = []
    for p in parts:
        p = re.sub(r"\s+", " ", p).strip()
        if len(p) < 28:
            continue
        if len(p) > 220:
            p = p[:217].rsplit(" ", 1)[0] + "…"
        steps.append(p)
        if len(steps) >= max_steps:
            break

    if len(steps) < 2:
        chunks = [c.strip() for c in re.split(r";\s+|,\s+", text) if len(c.strip()) > 35]
        steps = chunks[:max_steps]

    if len(steps) < 2:
        chunk_size = 160
        i, t = 0, text
        while i < len(t) and len(steps) < max_steps:
            piece = t[i : i + chunk_size].strip()
            if len(piece) < 40:
                break
            if len(piece) == chunk_size and " " in piece:
                piece = piece.rsplit(" ", 1)[0] + "…"
            steps.append(piece)
            i += chunk_size - 40

    if not steps:
        one = text[:200] + ("…" if len(text) > 200 else "")
        steps = [f"{topic}: {one}"]

    return steps[:max_steps]


def get_llm_client() -> OpenAI:
    if LLM_PROVIDER == "openai":
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(500, "OPENAI_API_KEY is missing")
        return OpenAI(api_key=api_key)
    return OpenAI(base_url=OLLAMA_BASE_URL, api_key="ollama")


def _is_openai_quota_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "insufficient_quota" in msg or "exceeded your current quota" in msg


def extract_json(text: str) -> dict | None:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return None


def salvage_explanation_from_wrapped_json(raw: str) -> str | None:
    """If the model returned a JSON object string, pull out explanation for chat/canvas."""
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    i = s.find("{")
    if i < 0:
        return None
    try:
        obj, _ = json.JSONDecoder().raw_decode(s, i)
    except json.JSONDecodeError:
        return None
    if not isinstance(obj, dict):
        return None
    exp = obj.get("explanation")
    if isinstance(exp, str) and exp.strip():
        return exp.strip()
    return None


def _looks_like_json_blob(text: str) -> bool:
    t = text.strip()
    return t.startswith("{") and ('"explanation"' in t or '"diagram"' in t)


def _regex_extract_explanation(text: str) -> str | None:
    m = re.search(
        r'"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"',
        text,
        re.DOTALL,
    )
    if not m:
        return None
    try:
        return json.loads(f'"{m.group(1)}"').strip()
    except json.JSONDecodeError:
        return m.group(1).replace("\\n", "\n").replace('\\"', '"').strip()


def _try_extract_diagram_from_text(text: str) -> dict | None:
    data = extract_json(text)
    if isinstance(data, dict) and isinstance(data.get("diagram"), dict):
        validated = validate_diagram(data["diagram"])
        if validated:
            return validated
    i = text.find('"diagram"')
    if i < 0:
        return None
    brace = text.find("{", i)
    if brace < 0:
        return None
    depth = 0
    for j in range(brace, len(text)):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                try:
                    chunk = json.loads(text[brace : j + 1])
                except json.JSONDecodeError:
                    return None
                if isinstance(chunk, dict):
                    return validate_diagram(chunk)
                return None
    return None


def parse_explain_content(content: str, topic: str) -> tuple[str, dict | None, list[str]]:
    """Normalize LLM output into clean explanation text, optional diagram, and fallback steps."""
    raw = (content or "").strip()
    data = extract_json(raw)
    explanation = ""
    diagram: dict | None = None

    if isinstance(data, dict):
        explanation = str(data.get("explanation", "")).strip()
        if isinstance(data.get("diagram"), dict):
            diagram = validate_diagram(data["diagram"])
        if not explanation:
            explanation = salvage_explanation_from_wrapped_json(raw) or raw
    else:
        explanation = salvage_explanation_from_wrapped_json(raw) or raw
        diagram = _try_extract_diagram_from_text(raw)

    if explanation.strip().startswith("{"):
        inner = salvage_explanation_from_wrapped_json(explanation)
        if inner:
            explanation = inner
        if not diagram:
            diagram = _try_extract_diagram_from_text(explanation) or _try_extract_diagram_from_text(raw)

    if _looks_like_json_blob(explanation):
        regex_exp = _regex_extract_explanation(raw) or _regex_extract_explanation(explanation)
        if regex_exp:
            explanation = regex_exp

    explanation = explanation.strip()
    if _looks_like_json_blob(explanation):
        salvaged = salvage_explanation_from_wrapped_json(explanation)
        if salvaged:
            explanation = salvaged

    visual_steps: list[str] = []
    if diagram and diagram.get("nodes"):
        visual_steps = [n["label"] for n in diagram["nodes"][:8]]
    elif explanation and not _looks_like_json_blob(explanation):
        visual_steps = contextual_visual_steps(topic, explanation)[:8]

    return explanation, diagram, visual_steps


VALID_SHAPES = {"rectangle", "ellipse", "diamond"}
VALID_COLORS = {"black", "blue", "green", "red", "orange", "violet", "yellow", "grey"}


def validate_diagram(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    nodes_raw = raw.get("nodes", [])
    edges_raw = raw.get("edges", [])
    if not isinstance(nodes_raw, list) or len(nodes_raw) == 0:
        return None

    valid_nodes = []
    node_ids: set[str] = set()
    for n in nodes_raw:
        if not isinstance(n, dict) or "id" not in n or "label" not in n:
            continue
        nid = str(n["id"])
        node_ids.add(nid)
        valid_nodes.append({
            "id": nid,
            "label": str(n["label"])[:80],
            "row": max(0, int(n.get("row", len(valid_nodes)))),
            "col": max(0, int(n.get("col", 0))),
            "shape": str(n.get("shape", "rectangle")) if n.get("shape") in VALID_SHAPES else "rectangle",
            "color": str(n.get("color", "black")) if n.get("color") in VALID_COLORS else "black",
        })

    if not valid_nodes:
        return None

    valid_edges = []
    for e in edges_raw:
        if not isinstance(e, dict):
            continue
        fid = str(e.get("from", ""))
        tid = str(e.get("to", ""))
        if fid in node_ids and tid in node_ids and fid != tid:
            valid_edges.append({"from": fid, "to": tid, "label": str(e.get("label", ""))[:40]})

    return {"title": str(raw.get("title", "Diagram"))[:100], "nodes": valid_nodes, "edges": valid_edges}


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@app.post("/auth/signup")
def signup(req: SignupRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == req.email.lower().strip()).first():
        raise HTTPException(409, "Email already registered")
    user = User(
        id=str(uuid.uuid4()),
        name=req.name.strip(),
        email=req.email.lower().strip(),
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    token = create_token(user.id, user.email)
    return {"token": token, "user": {"id": user.id, "name": user.name, "email": user.email}}


@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email.lower().strip()).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(401, "Invalid email or password")
    token = create_token(user.id, user.email)
    return {"token": token, "user": {"id": user.id, "name": user.name, "email": user.email}}


@app.get("/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return {"id": user.id, "name": user.name, "email": user.email}


# ---------------------------------------------------------------------------
# Project CRUD
# ---------------------------------------------------------------------------

def _proj_dict(p: Project) -> dict:
    return {"id": p.id, "name": p.name, "group": p.group_name, "updatedAt": p.updated_at.isoformat() if p.updated_at else ""}


@app.get("/projects")
def list_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Project).filter(Project.user_id == user.id).order_by(Project.updated_at.desc()).all()
    return [_proj_dict(p) for p in rows]


@app.post("/projects")
def create_project_endpoint(req: ProjectCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = Project(id=str(uuid.uuid4()), name=req.name.strip(), group_name=req.group.strip(), user_id=user.id)
    db.add(project)
    db.commit()
    db.refresh(project)
    return _proj_dict(project)


@app.put("/projects/{project_id}")
def update_project(project_id: str, req: ProjectUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user.id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    if req.name is not None:
        project.name = req.name.strip()
    if req.group is not None:
        project.group_name = req.group.strip()
    db.commit()
    db.refresh(project)
    return _proj_dict(project)


@app.delete("/projects/{project_id}")
def delete_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id, Project.user_id == user.id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    db.delete(project)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Chat history
# ---------------------------------------------------------------------------

@app.get("/projects/{project_id}/chat")
def get_chat(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not db.query(Project).filter(Project.id == project_id, Project.user_id == user.id).first():
        raise HTTPException(404, "Project not found")
    rows = db.query(ChatMessage).filter(ChatMessage.project_id == project_id).order_by(ChatMessage.created_at).all()
    return [{"role": m.role, "content": m.content} for m in rows]


@app.delete("/projects/{project_id}/chat")
def clear_chat(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not db.query(Project).filter(Project.id == project_id, Project.user_id == user.id).first():
        raise HTTPException(404, "Project not found")
    db.query(ChatMessage).filter(ChatMessage.project_id == project_id).delete()
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# AI explain (with conversation memory)
# ---------------------------------------------------------------------------

@app.post("/ai/explain", response_model=ExplainResponse)
def explain(payload: ExplainRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    client = get_llm_client()
    model = OPENAI_MODEL if LLM_PROVIDER == "openai" else OLLAMA_MODEL
    user_topic = _user_topic_for_request(payload)

    llm_messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]

    if payload.messages:
        for msg in payload.messages[-12:]:
            if msg.role in ("user", "assistant") and msg.content.strip():
                llm_messages.append({"role": msg.role, "content": msg.content})
        if llm_messages[-1]["role"] == "user":
            llm_messages[-1]["content"] = (
                f"Topic: {llm_messages[-1]['content']}\n\n"
                f"Language: {payload.language}\n\n"
                "Generate a thorough expert-level explanation with a detailed visual diagram. Return ONLY valid JSON."
            )
    elif payload.text:
        llm_messages.append({
            "role": "user",
            "content": (
                f"Topic: {payload.text}\n\nLanguage: {payload.language}\n\n"
                "Generate a thorough expert-level explanation with a detailed visual diagram. Return ONLY valid JSON."
            ),
        })
    else:
        raise HTTPException(422, "Provide either messages or text")

    try:
        create_kw: dict = {
            "model": model,
            "temperature": 0.3,
            "messages": llm_messages,
            "response_format": {"type": "json_object"},
        }
        completion = client.chat.completions.create(**create_kw)
    except Exception as exc:
        # If OpenAI quota is exhausted, automatically fall back to local Ollama.
        if LLM_PROVIDER == "openai" and _is_openai_quota_error(exc):
            try:
                fallback_client = OpenAI(base_url=OLLAMA_BASE_URL, api_key="ollama")
                completion = fallback_client.chat.completions.create(
                    model=OLLAMA_MODEL,
                    temperature=0.3,
                    messages=llm_messages,
                )
            except Exception as fallback_exc:
                raise HTTPException(
                    502,
                    "OpenAI quota exceeded and local fallback failed. "
                    "Start Ollama and run: ollama run llama3.2:3b",
                ) from fallback_exc
        else:
            if LLM_PROVIDER != "openai":
                raise HTTPException(502, "Local AI request failed. Make sure Ollama is running. Run: ollama run llama3.2:3b") from exc
            raise HTTPException(502, f"AI request failed: {exc}") from exc

    content = (completion.choices[0].message.content or "").strip()
    if not content:
        return ExplainResponse(
            explanation="No explanation returned.",
            visual_steps=contextual_visual_steps(user_topic, ""),
        )

    explanation, diagram, visual_steps = parse_explain_content(content, user_topic)

    if payload.project_id:
        user_content = payload.messages[-1].content if payload.messages else payload.text
        db.add(ChatMessage(id=str(uuid.uuid4()), project_id=payload.project_id, role="user", content=user_content))
        db.add(ChatMessage(id=str(uuid.uuid4()), project_id=payload.project_id, role="assistant", content=explanation))
        db.commit()

    return ExplainResponse(explanation=explanation, diagram=diagram, visual_steps=visual_steps[:8])


# ---------------------------------------------------------------------------
# Document text extraction
# ---------------------------------------------------------------------------

@app.post("/ai/extract")
async def extract_document(file: UploadFile = File(...), _user: User = Depends(get_current_user)):
    raw = await file.read()
    text = ""
    fname = file.filename or ""

    if file.content_type == "application/pdf" or fname.lower().endswith(".pdf"):
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    elif "wordprocessingml" in (file.content_type or "") or fname.lower().endswith(".docx"):
        from docx import Document
        doc = Document(io.BytesIO(raw))
        text = "\n".join(para.text for para in doc.paragraphs)
    elif (file.content_type or "").startswith("text/") or fname.lower().endswith(".txt"):
        text = raw.decode("utf-8", errors="replace")
    else:
        raise HTTPException(400, f"Unsupported file type: {file.content_type}")

    if not text.strip():
        raise HTTPException(422, "No text could be extracted from the file")

    return {"text": text.strip()[:15000], "filename": fname}


