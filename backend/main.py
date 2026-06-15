import os
import io
import json
import re
import time
import uuid

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Depends, Header, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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


class CanvasShapeContext(BaseModel):
    id: str
    type: str
    label: str = ""
    x: float = 0
    y: float = 0
    w: float = 0
    h: float = 0
    color: str = ""
    geo: str = ""
    isDocument: bool = False


class CanvasImageContext(BaseModel):
    id: str
    name: str = ""
    x: float = 0
    y: float = 0
    w: float = 0
    h: float = 0
    data_url: str | None = None


class CanvasEdgeContext(BaseModel):
    label: str = ""
    fromLabel: str = ""
    toLabel: str = ""


class ExplainRequest(BaseModel):
    messages: list[ChatMsg] = []
    text: str = ""
    project_id: str | None = None
    language: str = Field(default="English")
    canvas_shapes: list[CanvasShapeContext] = []
    canvas_edges: list[CanvasEdgeContext] = []
    canvas_summary: str = ""
    selected_shape_ids: list[str] = []
    selected_labels: list[str] = []
    document_text: str = ""
    canvas_images: list[CanvasImageContext] = []
    visual_type: str = ""  # flowchart | graph | labeled_diagram
    generate_visual: bool = False


class ExplainResponse(BaseModel):
    explanation: str
    diagram: dict | None = None
    visual_steps: list[str] = []


# ---------------------------------------------------------------------------
# LLM configuration
# ---------------------------------------------------------------------------

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama").lower()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_VISION_MODEL = os.getenv("OPENAI_VISION_MODEL", "llama-3.2-11b-vision-preview")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")

SPATIAL_JSON_SUFFIX = (
    '\nReturn ONLY a valid JSON object: {"explanation":"your answer here","diagram":null}\n'
    "Set diagram to null — do NOT generate a new diagram unless explicitly asked to draw one."
)

CANVAS_OVERVIEW_PROMPT = (
    "You are StudyCanvas AI with full awareness of the user's whiteboard.\n"
    "The user wants to understand what TOPICS and SUBJECT MATTER are on their canvas.\n"
    "Explain the board as a coherent academic summary — the main subject, key concepts, "
    "and how they connect in the learning flow.\n"
    "NEVER list shape types, coordinates, pixel positions, or shape IDs.\n"
    "NEVER say 'there is a rectangle at (x,y)'. Speak about the IDEAS on the board.\n"
    + SPATIAL_JSON_SUFFIX
)

SELECTION_EXPLAIN_PROMPT = (
    "You are StudyCanvas AI. The user selected specific element(s) on their canvas and wants "
    "an explanation of THAT concept/step ONLY.\n"
    "Focus entirely on the selected label(s). Explain what it means, why it matters, and "
    "how it fits into the broader topic on the board.\n"
    "Do NOT explain a different topic. Do NOT ignore the selection.\n"
    + SPATIAL_JSON_SUFFIX
)

DOCUMENT_QUERY_PROMPT = (
    "You are StudyCanvas AI. Answer the user's question using the UPLOADED DOCUMENT content "
    "provided in their message. Quote or paraphrase the document. If the answer is not in "
    "the document, say so clearly.\n"
    + SPATIAL_JSON_SUFFIX
)

VISION_QUERY_PROMPT = (
    "You are StudyCanvas AI with vision. The user attached image(s) from their canvas.\n"
    "Describe and explain what you see in the image(s). Connect it to the user's question.\n"
    "If the image shows a diagram, chart, graph, anatomy drawing, or formula, explain its meaning in detail.\n"
    "Name visible labels, parts, steps, or equations. Do NOT say you cannot see the image.\n"
    + SPATIAL_JSON_SUFFIX
)

TEACH_EXPLAIN_PROMPT = (
    "You are StudyCanvas AI, a STEM tutor.\n"
    "Answer the user's question clearly with real terminology and LaTeX formulas "
    "(inline $F=ma$ or block $$E=mc^2$$).\n"
    "Do NOT generate a diagram — the app will ask the user if they want a visual separately.\n"
    "Return ONLY a valid JSON object — no markdown, no backticks.\n\n"
    'Format: {"explanation":"4-8 sentences answering the question",'
    '"diagram":null,"offer_visual":true}\n\n'
    "Set offer_visual to true when a flowchart, labeled diagram, or math graph would help "
    "(processes, anatomy/systems, functions). Set false for simple factual Q&A.\n"
    "JSON ESCAPING: double LaTeX backslashes inside strings (\\\\frac, \\\\Delta)."
)

FLOWCHART_VISUAL_PROMPT = (
    "You are StudyCanvas AI, a STEM tutor. Your diagram must EXPLAIN HOW something works — "
    "like a textbook flowchart a professor would draw on a whiteboard. "
    "NOT a concept map, NOT a mind map, NOT a list of related terms linked together.\n"
    "Return ONLY a valid JSON object — no markdown, no backticks, no prose outside the JSON.\n\n"
    "Format:\n"
    '{"explanation":"2-4 sentences introducing the visual.",'
    '"diagram":{"type":"flowchart","title":"Topic Title",'
    '"nodes":[{"id":"n1","label":"Short step label","row":0,"col":0,"shape":"rectangle","color":"black","role":"start"}],'
    '"edges":[{"from":"n1","to":"n2","label":"condition or action"}]}}\n\n'
    "DIAGRAM PHILOSOPHY — teach the PROCEDURE, not the vocabulary:\n"
    "- A reader should follow arrows top-to-bottom and understand HOW the process executes.\n"
    "- Each node = ONE concrete step, state, decision, or outcome in the execution.\n"
    "- Process nodes use verb phrases: 'Compute mid = (lo+hi)/2', 'Compare T with A[mid]'.\n"
    "- Decision nodes are QUESTIONS: 'T == A[mid]?', 'lo <= hi?', 'Is list sorted?'.\n"
    "- Outcome nodes state results: 'Return index', 'Target not found', 'Emit photon'.\n"
    "- The main execution path must be obvious — no orphan nodes, no decorative filler.\n\n"
    "PICK ONE diagram style based on the topic:\n"
    "  ALGORITHM  → top-down flowchart with decisions, branches, and loop-back edges.\n"
    "  MECHANISM  → left-to-right pipeline: input → transformation stages → output.\n"
    "  SYSTEM     → layered architecture: user/data layer → processing → storage/output.\n"
    "  FORMULA    → derive step-by-step: given values → substitute → simplify → result.\n\n"
    "NODE RULES (8-12 nodes — quality over quantity):\n"
    "- Every node must sit on the main execution path OR a decision branch.\n"
    "- Set role on each node: start | input | process | decision | outcome | formula | termination.\n"
    "- Shapes: rectangle=process, diamond=decision, ellipse=input/outcome/termination.\n"
    "- Colors by role:\n"
    "    black=start   blue=input/prerequisite   green=process/action\n"
    "    yellow=decision   orange=success/output   violet=formula/key equation\n"
    "    red=failure/edge case/termination\n"
    "- Include 1-2 formula nodes with LaTeX when math is central (e.g. '$mid = \\\\lfloor (lo+hi)/2 \\\\rfloor$').\n"
    "- Labels: 3-8 words max. Specific and actionable — never vague nouns alone.\n"
    "  BAD: 'Sorted List', 'Repeat Process', 'Target Element', 'Definition'\n"
    "  GOOD: 'Require sorted array A', 'Set lo=0, hi=n-1', 'T == A[mid]?', 'Search left half [lo, mid-1]'\n\n"
    "EDGE RULES — edges carry the logic:\n"
    "- Edge labels tell the reader WHY we go that direction.\n"
    "  Decision branches: 'yes', 'no', 'T < A[mid]', 'T > A[mid]', 'match found', 'list empty'.\n"
    "  Process flow: 'then', 'next', 'init', 'update bounds', 'repeat'.\n"
    "  BANNED vague labels: 'requires', 'produces', 'derived from', 'related to', 'leads to', 'involves'.\n"
    "- Include loop-back edges for iterative algorithms (e.g. after updating bounds, edge back to the loop condition).\n"
    "- Every node needs at least one edge. No disconnected nodes.\n\n"
    "LAYOUT: rows = execution order (0=first step). cols = branch position (0=center, negative=left branch, positive=right).\n\n"
    "EXAMPLE (binary search — follow this pattern for algorithms):\n"
    '{"explanation":"Binary search finds a target T in a sorted array A by repeatedly halving the search range...",'
    '"diagram":{"title":"Binary Search",'
    '"nodes":['
    '{"id":"n1","label":"Start: sorted A, target T","row":0,"col":0,"shape":"rectangle","color":"black","role":"start"},'
    '{"id":"n2","label":"Set lo=0, hi=n-1","row":1,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n3","label":"lo <= hi?","row":2,"col":0,"shape":"diamond","color":"yellow","role":"decision"},'
    '{"id":"n4","label":"Compute mid = (lo+hi)/2","row":3,"col":0,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n5","label":"T == A[mid]?","row":4,"col":0,"shape":"diamond","color":"yellow","role":"decision"},'
    '{"id":"n6","label":"Return mid (found)","row":5,"col":-2,"shape":"ellipse","color":"orange","role":"outcome"},'
    '{"id":"n7","label":"T < A[mid]?","row":5,"col":0,"shape":"diamond","color":"yellow","role":"decision"},'
    '{"id":"n8","label":"Search left: hi = mid-1","row":6,"col":-2,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n9","label":"Search right: lo = mid+1","row":6,"col":2,"shape":"rectangle","color":"green","role":"process"},'
    '{"id":"n10","label":"Return -1 (not found)","row":3,"col":2,"shape":"ellipse","color":"red","role":"termination"}'
    '],'
    '"edges":['
    '{"from":"n1","to":"n2","label":"init"},'
    '{"from":"n2","to":"n3","label":""},'
    '{"from":"n3","to":"n4","label":"yes"},'
    '{"from":"n3","to":"n10","label":"no → done"},'
    '{"from":"n4","to":"n5","label":""},'
    '{"from":"n5","to":"n6","label":"yes → found"},'
    '{"from":"n5","to":"n7","label":"no"},'
    '{"from":"n7","to":"n8","label":"yes → go left"},'
    '{"from":"n7","to":"n9","label":"no → go right"},'
    '{"from":"n8","to":"n3","label":"repeat"},'
    '{"from":"n9","to":"n3","label":"repeat"}'
    ']}}\n\n'
    "JSON ESCAPING — IMPORTANT: any LaTeX backslash inside a JSON string must be DOUBLED. "
    "Write \\\\frac{a}{b}, \\\\Delta, \\\\alpha (two backslashes), NEVER a single backslash."
)

GRAPH_VISUAL_PROMPT = (
    "You are StudyCanvas AI, a STEM visualization expert. The user wants a MATHEMATICAL GRAPH "
    "drawn programmatically on their canvas, styled like Desmos/GeoGebra for clear student learning.\n"
    "Return ONLY valid JSON — no markdown.\n\n"
    'Format: {"explanation":"1-2 sentences about the graph",'
    '"diagram":{"type":"graph","title":"Parent Functions",'
    '"subtitle":"Comparing quadratic, cubic, and trigonometric behavior",'
    '"functions":[{"expr":"x^2","label":"y=x²","color":"blue"},'
    '{"expr":"x^3","label":"y=x³","color":"green"},'
    '{"expr":"sin(x)","label":"y=sin(x)","color":"red"}],'
    '"axisLabels":{"x":"x","y":"y"},'
    '"important_points":[{"x":0,"y":0,"label":"(0,0)"},{"x":1.57,"y":1,"label":"(π/2, 1)"}],'
    '"xMin":-6.28,"xMax":6.28,"yMin":-4,"yMax":4}}\n\n'
    "RULES:\n"
    "- expr uses math.js syntax: x^2, sin(x), cos(x), tan(x), sqrt(x), abs(x), log(x), exp(x), 1/x\n"
    "- Include 1-6 functions relevant to the topic. Plot the standard forms for parent functions.\n"
    "- title states the concept; subtitle states the educational objective in one short phrase.\n"
    "- PREFERRED COLOR PALETTE: quadratic=blue, cubic=green, trigonometric=red. Others: orange, violet, black.\n"
    "- label each function directly with its equation (e.g. y=x², y=sin(x)).\n"
    "- important_points: list key points (intercepts, turning points, maxima/minima). "
    "For y=sin(x) include (0,0),(π/2,1),(π,0),(3π/2,-1) as decimals.\n"
    "- Choose xMin/xMax/yMin/yMax so every curve stays visible — if a fast-growing function "
    "dominates, tighten the y-range so smaller curves (e.g. sin) remain readable.\n"
    "- JSON numbers only (use 1.57 not π/2 in x/y fields; π/2 may appear inside label strings)."
)

GRAPH_REVIEW_PROMPT = (
    "You are a STEM Visualization Review Assistant inside StudyCanvas. The user has a graph and "
    "wants it analyzed and IMPROVED. Review it for: (1) mathematical correctness — do the plotted "
    "functions match the title/intent? e.g. for 'Parent Functions' the cubic must be y=x^3, not "
    "y=x^3-3x; (2) educational effectiveness; (3) readability; (4) axes & scaling — does one curve "
    "dominate and hide others?; (5) visual design; (6) labeling; (7) important points; "
    "(8) titles & context.\n"
    "Return ONLY valid JSON — no markdown.\n\n"
    'Format: {"explanation":"State the issues you found, why they matter for learning, and the '
    'concrete fixes you applied (2-5 short sentences).",'
    '"diagram":{"type":"graph","title":"Parent Functions",'
    '"subtitle":"Comparing quadratic, cubic, and trigonometric behavior",'
    '"functions":[{"expr":"x^2","label":"y=x²","color":"blue"},'
    '{"expr":"x^3","label":"y=x³","color":"green"},'
    '{"expr":"sin(x)","label":"y=sin(x)","color":"red"}],'
    '"axisLabels":{"x":"x","y":"y"},'
    '"important_points":[{"x":0,"y":0,"label":"(0,0)"}],'
    '"xMin":-6.28,"xMax":6.28,"yMin":-4,"yMax":4}}\n\n'
    "RULES:\n"
    "- The diagram is the CORRECTED, improved graph (clean parent/standard forms unless the user "
    "asked for transformations).\n"
    "- expr uses math.js syntax: x^2, sin(x), cos(x), sqrt(x), abs(x), log(x), exp(x), 1/x.\n"
    "- PREFERRED PALETTE: quadratic=blue, cubic=green, trigonometric=red.\n"
    "- Add a clear title + objective subtitle, direct per-curve labels, and important_points "
    "(intercepts, turning points, maxima/minima, key sine values).\n"
    "- Pick ranges so all curves stay visible; tighten y-range when a steep curve hides others.\n"
    "- explanation must read like feedback: issues found → why they matter → improvements made.\n"
    "- JSON numbers only in x/y fields (1.57 not π/2)."
)

LABELED_DIAGRAM_PROMPT = (
    "You are StudyCanvas AI. The user wants a LABELED EDUCATIONAL DIAGRAM on their canvas — "
    "like an anatomy chart or system overview with named parts and connecting arrows.\n"
    "NOT a step-by-step algorithm flowchart. Show PARTS, REGIONS, and RELATIONSHIPS spatially.\n"
    "Return ONLY valid JSON — no markdown.\n\n"
    'Format: {"explanation":"2-3 sentences about the diagram",'
    '"diagram":{"type":"labeled_diagram","title":"Digestive System",'
    '"nodes":[{"id":"n1","label":"Mouth","row":0,"col":0,"shape":"ellipse","color":"blue"},'
    '{"id":"n2","label":"Esophagus","row":1,"col":0,"shape":"rectangle","color":"green"}],'
    '"edges":[{"from":"n1","to":"n2","label":"swallows"}]}}\n\n'
    "RULES:\n"
    "- 12-22 nodes naming the key parts/components.\n"
    "- row = vertical position (0=top), col = horizontal position (0=center, negative=left, positive=right).\n"
    "- Use ellipse for organs/parts, rectangle for structures/processes.\n"
    "- Edges show flow, connection, or hierarchy. Label important edges.\n"
    "- Layout should resemble how a textbook diagram is organized (top-to-bottom flow for systems).\n"
    "- Colors: blue=structure, green=process/path, orange=output, yellow=decision branch."
)


def _user_topic_for_request(payload: ExplainRequest) -> str:
    if payload.messages:
        for msg in reversed(payload.messages):
            if msg.role == "user" and msg.content.strip():
                return msg.content.strip()[:300]
    return (payload.text or "").strip()[:300] or "the question"


def _selected_image_ids(payload: ExplainRequest) -> set[str]:
    sel = set(payload.selected_shape_ids)
    return {img.id for img in payload.canvas_images if img.id in sel}


INTENT_MIN_CONF = 0.45        # non-visual intents must clear this to skip keywords
VISUAL_INTENT_MIN_CONF = 0.30  # visual intents have distinctive phrasing, lower bar


def _resolve_visual_type(payload: ExplainRequest, question: str) -> str | None:
    """Return flowchart | graph | labeled_diagram when user wants a visual.

    Primary path: the trained DistilBERT Prompt Intent Classifier (49-class taxonomy).
    Falls back to TF-IDF baseline if DistilBERT weights are missing, then keywords.
    """
    if payload.generate_visual and payload.visual_type in ("flowchart", "graph", "labeled_diagram"):
        return payload.visual_type

    # Trained model decides the diagram type (replaces keyword matching).
    try:
        from intent_predict import classify_intent, visual_type_for_intent

        intent, conf = classify_intent(question)
    except Exception:
        intent, conf = None, 0.0
        visual_type_for_intent = lambda _i: None  # noqa: E731

    if intent is not None:
        visual = visual_type_for_intent(intent)
        if visual and conf >= VISUAL_INTENT_MIN_CONF:
            return visual
        if not visual and conf >= INTENT_MIN_CONF:
            # Model is confident this is a non-visual (chat) intent.
            return "flowchart" if payload.generate_visual else None

    # Fallback: legacy keyword heuristic (model missing or low confidence).
    q = question.lower()
    graph_kw = (
        "graph", "plot", "function graph", "f(x)", "parabola", "parent function",
        "sketch the", "draw a graph", "draw graph", "plot the", "y =", "y=",
        "sin(", "cos(", "tan(", "coordinate", "axes",
    )
    labeled_kw = (
        "anatomy", "labeled diagram", "labelled diagram", "parts of", "structure of",
        "digestive", "organ", "system diagram", "label the", "components of",
        "anatomical", "body parts", "show the parts",
    )
    flow_kw = (
        "flowchart", "flow chart", "process flow", "algorithm steps", "draw a diagram",
        "draw diagram", "visualize", "create a diagram", "make a diagram", "on my canvas",
    )

    if any(w in q for w in graph_kw):
        return "graph"
    if any(w in q for w in labeled_kw):
        return "labeled_diagram"
    if any(w in q for w in flow_kw):
        return "flowchart"
    if payload.generate_visual:
        return "flowchart"
    return None


VISUALIZATION_IMPROVEMENT_INTENT = "VISUALIZATION_IMPROVEMENT"
_REVIEW_KW = (
    "improve this graph", "improve the graph", "review this graph", "review the graph",
    "critique this graph", "fix this graph", "make this graph better", "better graph",
    "improve this plot", "review this plot", "improve this chart", "review this chart",
    "improve this visualization", "review this visualization", "improve my graph",
    "fix my graph", "improve this figure", "whats wrong with this graph",
    "what's wrong with this graph", "is this graph correct", "improve the scaling",
    "redraw this graph", "improve this diagram graph",
)


def _wants_graph_review(payload: ExplainRequest, question: str) -> bool:
    """Detect a 'review / improve this graph' request via trained model + keywords."""
    try:
        from intent_predict import classify_intent

        intent, conf = classify_intent(question)
        if intent == VISUALIZATION_IMPROVEMENT_INTENT and conf >= VISUAL_INTENT_MIN_CONF:
            return True
    except Exception:
        pass
    q = question.lower()
    return any(kw in q for kw in _REVIEW_KW)


def _detect_interaction_mode(payload: ExplainRequest, question: str) -> str:
    """teach | visual_* | canvas_overview | selection | document | vision"""
    q = question.lower().strip()
    has_canvas = bool(payload.canvas_summary or len(payload.canvas_shapes) >= 2)
    has_selection = bool(payload.selected_labels or payload.selected_shape_ids)
    has_doc = bool(payload.document_text.strip())
    has_images = bool(payload.canvas_images)
    image_selected = bool(_selected_image_ids(payload))

    vision_words = (
        "image", "picture", "photo", "screenshot", "see in", "look at",
        "what does this show", "describe the", "pdf page", "explain this",
        "what is this", "what's in", "tell me about this",
    )
    doc_words = (
        "document", "pdf", "uploaded", "my notes", "the file", "my doc",
        "from the reading", "in the text",
    )
    canvas_words = (
        "on my canvas", "on the canvas", "on my board", "on the board",
        "what's on", "what is on", "summarize my", "summarize the",
        "what am i studying", "what topics", "what's drawn",
    )
    selection_words = (
        "this step", "this node", "this box", "this shape", "selected",
        "explain this", "what does this mean", "tell me about this",
    )

    # Visualization Review: critique an existing graph and regenerate an improved one.
    if _wants_graph_review(payload, question):
        return "visual_graph_review"

    visual_type = _resolve_visual_type(payload, question)
    if visual_type:
        return f"visual_{visual_type}"

    if has_images and image_selected:
        return "vision"
    if has_images and any(w in q for w in vision_words):
        return "vision"
    if has_doc and any(w in q for w in doc_words):
        return "document"
    if has_selection and not image_selected and (
        any(w in q for w in selection_words)
        or len(q.split()) <= 10
    ):
        return "selection"
    if has_canvas and any(w in q for w in canvas_words):
        return "canvas_overview"
    if has_canvas and any(w in q for w in ("summarize", "overview", "what have i")):
        return "canvas_overview"
    return "teach"


def _format_spatial_context(payload: ExplainRequest) -> str:
    parts: list[str] = []

    if payload.canvas_summary.strip():
        parts.append("CANVAS TOPIC SUMMARY:\n" + payload.canvas_summary.strip())

    if payload.canvas_edges:
        flow = [
            f"  {e.fromLabel} → {e.toLabel}" + (f" ({e.label})" if e.label else "")
            for e in payload.canvas_edges[:20]
            if e.fromLabel and e.toLabel
        ]
        if flow:
            parts.append("CONCEPT FLOW ON BOARD:\n" + "\n".join(flow))

    if payload.selected_labels:
        parts.append(
            "USER SELECTED THESE CONCEPTS (explain ONLY these):\n"
            + "\n".join(f"  - {lbl}" for lbl in payload.selected_labels)
        )
    elif payload.selected_shape_ids:
        parts.append("SELECTED SHAPE IDS: " + ", ".join(payload.selected_shape_ids))

    if payload.document_text.strip():
        doc = payload.document_text.strip()
        if len(doc) > 15000:
            doc = doc[:14997] + "..."
        parts.append("FULL UPLOADED DOCUMENT TEXT:\n" + doc)

    return "\n\n".join(parts)


def _build_user_prompt_text(payload: ExplainRequest, question: str, mode: str) -> str:
    spatial = _format_spatial_context(payload)
    blocks = [f"User question: {question}", f"Language: {payload.language}"]
    if spatial:
        blocks.append(spatial)
    if mode == "teach":
        blocks.append(
            'Return ONLY: {"explanation":"...","diagram":null,"offer_visual":true or false}'
        )
    elif mode.startswith("visual_"):
        blocks.append("Return ONLY the JSON object with explanation and diagram.")
    else:
        blocks.append('Return ONLY: {"explanation":"...","diagram":null}')
    return "\n\n".join(blocks)


def _system_prompt_for_mode(mode: str) -> str:
    if mode == "visual_flowchart":
        return FLOWCHART_VISUAL_PROMPT
    if mode == "visual_graph":
        return GRAPH_VISUAL_PROMPT
    if mode == "visual_graph_review":
        return GRAPH_REVIEW_PROMPT
    if mode == "visual_labeled_diagram":
        return LABELED_DIAGRAM_PROMPT
    if mode == "canvas_overview":
        return CANVAS_OVERVIEW_PROMPT
    if mode == "selection":
        return SELECTION_EXPLAIN_PROMPT
    if mode == "document":
        return DOCUMENT_QUERY_PROMPT
    if mode == "vision":
        return VISION_QUERY_PROMPT
    return TEACH_EXPLAIN_PROMPT


def _prepare_llm_messages(payload: ExplainRequest) -> tuple[list[dict], str, bool, str]:
    """Returns (messages, model_name, has_vision_images, interaction_mode)."""
    history = payload.messages or []
    if not history and not payload.text:
        raise HTTPException(422, "Provide either messages or text")

    if history:
        window = history[-4:]
        question = window[-1].content if window[-1].role == "user" else _user_topic_for_request(payload)
    else:
        question = payload.text
        window = []

    mode = _detect_interaction_mode(payload, question)
    system = _system_prompt_for_mode(mode)
    llm_messages: list[dict] = [{"role": "system", "content": system}]

    for msg in window[:-1]:
        if msg.role in ("user", "assistant") and msg.content.strip():
            llm_messages.append({"role": msg.role, "content": msg.content})

    user_text = _build_user_prompt_text(payload, question, mode)
    vision_images = [img for img in payload.canvas_images if img.data_url][:3]
    selected_imgs = _selected_image_ids(payload)
    use_vision = mode == "vision" or (
        selected_imgs
        and vision_images
        and any(img.id in selected_imgs for img in vision_images)
    )

    if use_vision and vision_images:
        # Prefer selected images; otherwise send all available images.
        imgs_to_send = [img for img in vision_images if img.id in selected_imgs] if selected_imgs else vision_images
        content: list[dict] = [{"type": "text", "text": user_text}]
        for img in imgs_to_send[:2]:
            content.append({"type": "image_url", "image_url": {"url": img.data_url}})
        llm_messages.append({"role": "user", "content": content})
        model = OPENAI_VISION_MODEL if LLM_PROVIDER == "openai" else OLLAMA_MODEL
        return llm_messages, model, True, mode

    llm_messages.append({"role": "user", "content": user_text})
    model = OPENAI_MODEL if LLM_PROVIDER == "openai" else OLLAMA_MODEL
    return llm_messages, model, False, mode


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
        base_url = os.getenv("OPENAI_BASE_URL")
        if base_url:
            return OpenAI(api_key=api_key, base_url=base_url)
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
    candidates = [text, _escape_bad_json_backslashes(text)]
    for cand in candidates:
        try:
            return json.loads(cand)
        except json.JSONDecodeError:
            continue
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        raw = match.group()
        for cand in (raw, _escape_bad_json_backslashes(raw)):
            try:
                return json.loads(cand)
            except json.JSONDecodeError:
                continue
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
        validated = validate_visual(data["diagram"])
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
                    return validate_visual(chunk)
                return None
    return None


def parse_explain_content(content: str, topic: str) -> tuple[str, dict | None, list[str], bool]:
    """Normalize LLM output into explanation, optional visual, and offer_visual flag."""
    raw = (content or "").strip()
    data = extract_json(raw)
    explanation = ""
    diagram: dict | None = None
    offer_visual = False

    if isinstance(data, dict):
        explanation = str(data.get("explanation", "")).strip()
        offer_visual = bool(data.get("offer_visual", False))
        if isinstance(data.get("diagram"), dict):
            diagram = validate_visual(data["diagram"])
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

    return explanation, diagram, [], offer_visual


VALID_SHAPES = {"rectangle", "ellipse", "diamond"}
VALID_COLORS = {"black", "blue", "green", "red", "orange", "violet", "yellow", "grey"}
VALID_ROLES = {"start", "input", "process", "decision", "outcome", "formula", "termination"}
ROLE_DEFAULTS: dict[str, tuple[str, str]] = {
    "start": ("rectangle", "black"),
    "input": ("ellipse", "blue"),
    "process": ("rectangle", "green"),
    "decision": ("diamond", "yellow"),
    "outcome": ("ellipse", "orange"),
    "formula": ("rectangle", "violet"),
    "termination": ("ellipse", "red"),
}
VAGUE_EDGE_LABELS = {
    "requires", "produces", "derived from", "related to", "leads to", "involves",
    "associated with", "connected to", "part of", "includes", "contains",
}


def _normalize_node(n: dict, index: int) -> dict:
    role = str(n.get("role", "")).lower()
    if role not in VALID_ROLES:
        role = ""
    shape = str(n.get("shape", ""))
    color = str(n.get("color", ""))
    if role in ROLE_DEFAULTS:
        default_shape, default_color = ROLE_DEFAULTS[role]
        if shape not in VALID_SHAPES:
            shape = default_shape
        if color not in VALID_COLORS:
            color = default_color
    if shape not in VALID_SHAPES:
        shape = "rectangle"
    if color not in VALID_COLORS:
        color = "black"
    return {
        "id": str(n["id"]),
        "label": str(n["label"])[:80],
        "row": max(0, int(n.get("row", index))),
        "col": int(n.get("col", 0)),
        "shape": shape,
        "color": color,
    }


def validate_graph(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    funcs_raw = raw.get("functions", [])
    if not isinstance(funcs_raw, list) or len(funcs_raw) == 0:
        return None
    palette = ["blue", "red", "green", "orange", "violet", "black"]
    valid_funcs = []
    for i, f in enumerate(funcs_raw[:6]):
        if not isinstance(f, dict):
            continue
        expr = str(f.get("expr", "")).strip()
        if not expr:
            continue
        color = str(f.get("color", palette[i % len(palette)]))
        if color not in VALID_COLORS:
            color = palette[i % len(palette)]
        valid_funcs.append({
            "expr": expr[:120],
            "label": str(f.get("label", f"f{i + 1}"))[:80],
            "color": color,
        })
    if not valid_funcs:
        return None

    def _bound(key: str, default: float) -> float:
        try:
            return float(raw.get(key, default))
        except (TypeError, ValueError):
            return default

    # Optional educational fields
    axis_raw = raw.get("axisLabels") or raw.get("axis_labels") or {}
    axis_labels = {
        "x": str(axis_raw.get("x", "x"))[:24] if isinstance(axis_raw, dict) else "x",
        "y": str(axis_raw.get("y", "y"))[:24] if isinstance(axis_raw, dict) else "y",
    }

    points = []
    pts_raw = raw.get("points") or raw.get("important_points") or []
    if isinstance(pts_raw, list):
        for p in pts_raw[:12]:
            if not isinstance(p, dict):
                continue
            try:
                px = float(p.get("x"))
                py = float(p.get("y"))
            except (TypeError, ValueError):
                continue
            points.append({"x": px, "y": py, "label": str(p.get("label", ""))[:40]})

    return {
        "type": "graph",
        "title": str(raw.get("title", "Graph"))[:100],
        "subtitle": str(raw.get("subtitle", ""))[:140],
        "functions": valid_funcs,
        "xMin": _bound("xMin", -5),
        "xMax": _bound("xMax", 5),
        "yMin": _bound("yMin", -5),
        "yMax": _bound("yMax", 5),
        "axisLabels": axis_labels,
        "points": points,
    }


def validate_diagram(raw: dict, max_nodes: int = 12) -> dict | None:
    if not isinstance(raw, dict):
        return None
    nodes_raw = raw.get("nodes", [])
    edges_raw = raw.get("edges", [])
    if not isinstance(nodes_raw, list) or len(nodes_raw) == 0:
        return None

    valid_nodes = []
    node_ids: set[str] = set()
    for i, n in enumerate(nodes_raw[:max_nodes]):
        if not isinstance(n, dict) or "id" not in n or "label" not in n:
            continue
        normalized = _normalize_node(n, i)
        node_ids.add(normalized["id"])
        valid_nodes.append(normalized)

    if not valid_nodes:
        return None

    valid_edges = []
    for e in edges_raw:
        if not isinstance(e, dict):
            continue
        fid = str(e.get("from", ""))
        tid = str(e.get("to", ""))
        if fid in node_ids and tid in node_ids and fid != tid:
            label = str(e.get("label", ""))[:40].strip()
            if label.lower() in VAGUE_EDGE_LABELS:
                label = ""
            valid_edges.append({"from": fid, "to": tid, "label": label})

    dtype = str(raw.get("type", "flowchart")).lower()
    if dtype not in ("flowchart", "labeled_diagram"):
        dtype = "flowchart"

    return {
        "type": dtype,
        "title": str(raw.get("title", "Diagram"))[:100],
        "nodes": valid_nodes,
        "edges": valid_edges,
    }


def validate_visual(raw: dict) -> dict | None:
    if not isinstance(raw, dict):
        return None
    vtype = str(raw.get("type", "flowchart")).lower()
    if vtype == "graph":
        return validate_graph(raw)
    max_nodes = 22 if vtype == "labeled_diagram" else 12
    return validate_diagram(raw, max_nodes=max_nodes)


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
    user_topic = _user_topic_for_request(payload)
    llm_messages, model, _has_vision, mode = _prepare_llm_messages(payload)

    try:
        create_kw: dict = {
            "model": model,
            "temperature": 0.25,
            "messages": llm_messages,
            "max_tokens": 1400,
        }
        if LLM_PROVIDER == "openai" and mode in ("teach", "visual_flowchart", "visual_graph", "visual_graph_review", "visual_labeled_diagram") and not _has_vision:
            create_kw["response_format"] = {"type": "json_object"}
        completion = client.chat.completions.create(**create_kw)
    except Exception as exc:
        # If OpenAI quota is exhausted, automatically fall back to local Ollama.
        if LLM_PROVIDER == "openai" and _is_openai_quota_error(exc):
            try:
                fallback_client = OpenAI(base_url=OLLAMA_BASE_URL, api_key="ollama")
                completion = fallback_client.chat.completions.create(
                    model=OLLAMA_MODEL,
                    temperature=0.2,
                    messages=llm_messages,
                    max_tokens=600,
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
        return ExplainResponse(explanation="No explanation returned.", visual_steps=[])

    explanation, diagram, visual_steps, _offer_visual = parse_explain_content(content, user_topic)
    if not mode.startswith("visual_"):
        diagram = None
        visual_steps = []

    if payload.project_id:
        user_content = payload.messages[-1].content if payload.messages else payload.text
        db.add(ChatMessage(id=str(uuid.uuid4()), project_id=payload.project_id, role="user", content=user_content))
        db.add(ChatMessage(id=str(uuid.uuid4()), project_id=payload.project_id, role="assistant", content=explanation))
        db.commit()

    return ExplainResponse(explanation=explanation, diagram=diagram, visual_steps=visual_steps[:8])


# ---------------------------------------------------------------------------
# AI explain — STREAMING (SSE)
# ---------------------------------------------------------------------------

def _decode_so_far(buffer: str) -> str | None:
    """Incrementally extract the current value of the `explanation` field from a
    JSON-in-progress buffer. Returns the decoded string, or None if the field
    has not started streaming yet. Stops at the first unescaped closing quote.

    Preserves unknown backslash escapes (e.g. ``\\frac``, ``\\Delta``) as literal
    ``\\X`` text rather than dropping the backslash, so LaTeX commands survive.
    """
    m = re.search(r'"explanation"\s*:\s*"', buffer)
    if not m:
        return None
    i = m.end()
    out: list[str] = []
    escape = False
    n = len(buffer)
    while i < n:
        c = buffer[i]
        if escape:
            if c == "n":
                out.append("\n")
            elif c == "t":
                out.append("\t")
            elif c == "r":
                out.append("\r")
            elif c == '"':
                out.append('"')
            elif c == "\\":
                out.append("\\")
            elif c == "/":
                out.append("/")
            else:
                # Preserve unknown backslash escapes (LaTeX commands like \frac, \Delta, \beta).
                out.append("\\")
                out.append(c)
            escape = False
        elif c == "\\":
            escape = True
        elif c == '"':
            break
        else:
            out.append(c)
        i += 1
    return "".join(out)


def _escape_bad_json_backslashes(s: str) -> str:
    """Make a JSON-shaped string from an LLM more tolerant of LaTeX commands.

    LLMs often emit ``"\\frac{...}"`` as ``"\\frac{...}"`` (single backslash)
    which JSON's strict parser turns into a form-feed character. This function
    finds odd-length runs of backslashes followed by a non-JSON-escape letter
    and adds one more backslash so ``json.loads`` produces the literal LaTeX
    command instead. ``\\n``, ``\\t``, ``\\r``, ``\\u`` and friends pass through
    unchanged.
    """
    valid_escape_followers = {"n", "t", "r", '"', "\\", "/", "u"}
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        if s[i] != "\\":
            out.append(s[i])
            i += 1
            continue
        j = i
        while j < n and s[j] == "\\":
            j += 1
        run = j - i
        nxt = s[j] if j < n else ""
        if run % 2 == 1 and nxt and nxt not in valid_escape_followers:
            out.append("\\" * (run + 1))
        else:
            out.append("\\" * run)
        i = j
    return "".join(out)


@app.post("/ai/explain-stream")
def explain_stream(payload: ExplainRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    client = get_llm_client()
    user_topic = _user_topic_for_request(payload)
    llm_messages, model, has_vision, mode = _prepare_llm_messages(payload)

    create_kw: dict = {
        "model": model,
        "temperature": 0.25,
        "messages": llm_messages,
        "max_tokens": 1400,
        "stream": True,
    }
    if LLM_PROVIDER == "openai" and mode in ("teach", "visual_flowchart", "visual_graph", "visual_graph_review", "visual_labeled_diagram") and not has_vision:
        create_kw["response_format"] = {"type": "json_object"}

    project_id = payload.project_id
    user_content = payload.messages[-1].content if payload.messages else payload.text
    skip_diagram = not mode.startswith("visual_")

    def _emit_text(new_text: str):
        """Split big bursts so the UI animates naturally even when the upstream
        provider consolidates chunks. Total animation overhead capped at ~500ms.
        """
        if len(new_text) <= 32:
            yield f"data: {json.dumps({'type': 'text', 'content': new_text})}\n\n"
            return
        piece_size = max(16, len(new_text) // 80)
        i = 0
        n = len(new_text)
        while i < n:
            piece = new_text[i : i + piece_size]
            i += piece_size
            yield f"data: {json.dumps({'type': 'text', 'content': piece})}\n\n"
            time.sleep(0.005)

    def event_stream():
        buffer = ""
        last_emitted = 0
        try:
            stream = client.chat.completions.create(**create_kw)
            for chunk in stream:
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta.content or ""
                if not delta:
                    continue
                buffer += delta
                current = _decode_so_far(buffer)
                if current is None:
                    continue
                if len(current) > last_emitted:
                    new_text = current[last_emitted:]
                    last_emitted = len(current)
                    yield from _emit_text(new_text)
        except Exception as exc:
            if has_vision and LLM_PROVIDER == "openai":
                try:
                    fallback_msgs = [m if not isinstance(m.get("content"), list) else {**m, "content": m["content"][0]["text"]} for m in llm_messages]
                    fallback_msgs[0] = {"role": "system", "content": VISION_QUERY_PROMPT}
                    stream = client.chat.completions.create(
                        model=OPENAI_MODEL,
                        temperature=0.25,
                        messages=fallback_msgs,
                        max_tokens=1400,
                        stream=True,
                    )
                    buffer = ""
                    last_emitted = 0
                    for chunk in stream:
                        if not chunk.choices:
                            continue
                        delta = chunk.choices[0].delta.content or ""
                        if not delta:
                            continue
                        buffer += delta
                        current = _decode_so_far(buffer)
                        if current is None:
                            continue
                        if len(current) > last_emitted:
                            new_text = current[last_emitted:]
                            last_emitted = len(current)
                            yield from _emit_text(new_text)
                except Exception:
                    yield f"data: {json.dumps({'type': 'error', 'message': f'AI request failed: {exc}'})}\n\n"
                    return
            else:
                yield f"data: {json.dumps({'type': 'error', 'message': f'AI request failed: {exc}'})}\n\n"
                return

        # Use _decode_so_far so the final explanation matches what we streamed
        # (preserves LaTeX backslashes). parse_explain_content provides the diagram
        # and visual_steps which use the same backslash-tolerant parser.
        streamed_explanation = _decode_so_far(buffer) or ""
        parsed_explanation, diagram, visual_steps, offer_visual = parse_explain_content(buffer, user_topic)
        explanation = streamed_explanation or parsed_explanation
        if skip_diagram:
            diagram = None
            visual_steps = []
        elif mode == "teach":
            offer_visual = False

        if len(explanation) > last_emitted:
            tail = explanation[last_emitted:]
            yield f"data: {json.dumps({'type': 'text', 'content': tail})}\n\n"

        if project_id:
            try:
                db.add(ChatMessage(id=str(uuid.uuid4()), project_id=project_id, role="user", content=user_content))
                db.add(ChatMessage(id=str(uuid.uuid4()), project_id=project_id, role="assistant", content=explanation))
                db.commit()
            except Exception:
                db.rollback()

        yield (
            "data: "
            + json.dumps({
                "type": "done",
                "explanation": explanation,
                "diagram": diagram,
                "visual_steps": visual_steps[:8],
                "mode": mode,
                "offer_visual": offer_visual,
            })
            + "\n\n"
        )

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


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
        if fname.lower().endswith(".pdf"):
            return {"text": "", "filename": fname, "note": "No extractable text — pages can still be viewed on canvas"}
        raise HTTPException(422, "No text could be extracted from the file")

    return {"text": text.strip()[:20000], "filename": fname}


# ---------------------------------------------------------------------------
# ASL sign recognition (Sign Shortcuts + AAC)
# ---------------------------------------------------------------------------

class SignPredictResponse(BaseModel):
    letter: str
    confidence: float


@app.post("/accessibility/predict-sign", response_model=SignPredictResponse)
async def predict_sign_endpoint(
    file: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Upload an image file (JPEG or PNG)")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty image upload")
    try:
        from sign_predict import predict_sign

        result = predict_sign(raw)
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, f"Could not read sign image: {exc}") from exc
    return SignPredictResponse(letter=result["letter"], confidence=result["confidence"])


# ---------------------------------------------------------------------------
# Handwritten math symbol recognition
# ---------------------------------------------------------------------------

class MathPredictResponse(BaseModel):
    symbol: str
    confidence: float
    alternatives: list[dict[str, float | str]] = []


class MathExpressionResponse(BaseModel):
    expression: str
    symbols: list[MathPredictResponse] = []


@app.post("/math/recognize-symbol", response_model=MathPredictResponse)
async def predict_math_symbol_endpoint(
    file: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Upload an image file (JPEG or PNG)")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty image upload")
    try:
        from math_predict import predict_math_symbol

        result = predict_math_symbol(raw)
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, f"Could not read math symbol image: {exc}") from exc
    return MathPredictResponse(**result)


@app.post("/math/recognize-expression", response_model=MathExpressionResponse)
async def predict_math_expression_endpoint(
    file: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "Upload an image file (JPEG or PNG)")
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty image upload")
    try:
        from math_recognize_expression import recognize_expression_image

        result = recognize_expression_image(raw)
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(422, f"Could not read math expression: {exc}") from exc
    return MathExpressionResponse(
        expression=result["expression"],
        symbols=[MathPredictResponse(**s) for s in result["symbols"]],
    )


# ---------------------------------------------------------------------------
# Prompt Intent Classifier (trained model that routes diagram generation)
# ---------------------------------------------------------------------------

class IntentRequest(BaseModel):
    text: str


class IntentResponse(BaseModel):
    available: bool
    backend: str | None = None  # distilbert | tfidf
    intent: str | None
    confidence: float
    scores: dict[str, float]


@app.post("/intent/classify", response_model=IntentResponse)
def classify_intent_endpoint(
    payload: IntentRequest,
    _user: User = Depends(get_current_user),
):
    from intent_predict import classify_detail

    detail = classify_detail(payload.text)
    return IntentResponse(**detail)


