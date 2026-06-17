# ASL Sign Access — push & pull checklist

Use this so **you** push only the live-ASL fixes, and **anyone who pulls** can run Sign Access the same way you do now.

**Status:** Changes not pushed yet (as of last update).

---

## Part 1 — For you: what to push (ONLY these 3 files)

These are the **only** code changes made to improve live ASL recognition. The CNN weights and architecture were **not** modified.

| File | Purpose |
|------|---------|
| `backend/sign_predict.py` | Inference-time stabilization (TTA) |
| `frontend/src/SignAccessibilityPanel.tsx` | Webcam capture, voting, thresholds, shortcut filter |
| `frontend/src/index.css` | Orange hand-placement guide overlay |

### Do NOT include in this commit

| Exclude | Why |
|---------|-----|
| `backend/.env` | Secrets (DB password, API keys) — never commit |
| `datasets/**` | Training images — not needed to run the app |
| `ASL_PULL_CHECKLIST.md` | Optional — include only if you want this doc on GitHub |

### Push commands (when ready)

```powershell
cd <project-root>

git restore --staged .
git add backend/sign_predict.py frontend/src/SignAccessibilityPanel.tsx frontend/src/index.css

git status
# Confirm ONLY the 3 files above are staged.

git commit -m "Improve live ASL recognition via guided capture and inference TTA"
git push -u origin <branch-name>
```

### Suggested PR title

**Improve live ASL Sign Access (guided capture + inference TTA)**

---

## Part 2 — For the person pulling: run ASL like you do now

After they `git pull`, they need the **3 changed files** plus **existing repo assets** below. No dataset download required.

### 2.1 What must already be in the repo (unchanged by this push)

These were **not** edited in this session but are **required** for ASL to work:

| Path | Role |
|------|------|
| `backend/models/asl_model.pth` | Trained AslCNN3 weights (~1.5 MB) |
| `backend/models/class_labels.json` | A–Z label order |
| `backend/asl_model.py` | CNN architecture (AslCNN3) |
| `backend/main.py` | `POST /accessibility/predict-sign` endpoint |
| `frontend/src/App.tsx` | Wires `predictSign` → API |

If `asl_model.pth` is missing after pull → `503` error. Fix: run `ml/train_asl_custom3.py` or copy weights from teammate.

**ASL does NOT need:** Groq/OpenAI API key, datasets, or Docker (for sign recognition only).

---

### 2.2 One-time machine setup

#### A) PostgreSQL

1. Install PostgreSQL and create database: `studycanvas`
2. Note postgres user + password

#### B) Backend environment

```powershell
cd backend
copy .env.example .env
```

Edit `backend/.env` — **minimum for ASL**:

```env
DATABASE_URL=postgresql+psycopg2://postgres:YOUR_PASSWORD@localhost:5432/studycanvas
JWT_SECRET=use-at-least-32-random-characters-here
```

`OPENAI_API_KEY` can stay empty if they only test Sign Access (AI chat will fail; ASL will still work).

#### C) Python venv + dependencies

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Verify PyTorch (needed for `sign_predict.py`):

```powershell
python -c "import torch; print(torch.__version__)"
```

#### D) Frontend

```powershell
cd frontend
npm install
```

---

### 2.3 Run the app (same as your setup)

**Terminal 1 — backend (port 8002):**

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 127.0.0.1 --port 8002
```

**Terminal 2 — frontend:**

```powershell
cd frontend
npm run dev
```

Open: **http://localhost:5173**

Vite proxies `/api` → `http://127.0.0.1:8002` (see `frontend/vite.config.ts`).

---

### 2.4 Use Sign Access (test steps)

1. **Register / log in** (endpoint requires JWT — without login, predict-sign returns 401).
2. Open canvas → **Sign Access** panel.
3. Allow **camera** when prompted; select laptop webcam (not OBS virtual camera).
4. **Shortcuts** tab — signs: **F** Flowchart, **G** Graph, **A** Add note, **C** Clear, **U** Undo, **H** Help.
5. Place hand in the **orange dashed box**; plain background helps.
6. Hold sign ~2 seconds → tap **Capture sign** (or turn **Live** on).
7. Success: status shows e.g. `Shortcut triggered: A (Add note)`.

**Tips (same as your experience):**

- Left hand often recognizes more reliably than right (mirror + training bias).
- Avoid bright glare beside the hand.
- Status `Frames: X(%), Y(%), Z(%)` shows raw model output when unclear.

---

### 2.5 Verify backend ASL is healthy

With backend running and logged in, or via Swagger at **http://127.0.0.1:8002/docs**:

- `POST /accessibility/predict-sign` with a JPEG → `200` + `{ "letter": "...", "confidence": 0.xx }`
- Missing weights → `503` with message about `asl_model.pth`
- Not logged in → `401`

---

## Part 3 — Every code change (with reason)

### `backend/sign_predict.py`

| Change | Why |
|--------|-----|
| Added `_crop_variants()` (88%, 100%, 112% zoom crops) | Live frames vary slightly; averaging 3 views stabilizes softmax without retraining |
| `predict_sign()` averages softmax over variants for AslCNN3 | Reduces jitter between consecutive webcam frames |
| **No change** to CNN weights or `asl_model.py` | Model accuracy on test set stays ~75%; only inference pipeline improved |

### `frontend/src/SignAccessibilityPanel.tsx`

| Change | Why |
|--------|-----|
| `captureFrameForModel()` replaces `captureCenterCrop()` | Capture must match what user sees in the orange box, not a blind center crop |
| `object-fit: cover` math on video | Preview crops video; without this, saved image ≠ on-screen region |
| Horizontal mirror on capture | Matches `scaleX(-1)` selfie preview so hand position aligns |
| 384×384 JPEG from guide box (55% × 72%) | Hand fills more of model input; full frame shrinks hand to useless size at 96×96 |
| `GUIDE_X/Y/W/H` constants synced with CSS | Code crop matches orange overlay |
| `SHORTCUT_LETTERS` whitelist (F, G, A, C, U, H) | Model often misfires on N, Y, etc.; only shortcut letters may trigger actions |
| `majorityVote(..., allowed)` | Ignores non-shortcut letters when voting in shortcut mode |
| Unanimous 3-frame vote (all frames same letter) | Replaces single-frame 55% gate; safer than one noisy frame |
| Confidence: shortcut **24%**, AAC **20%** (was **72%**) | Live webcam softmax is often 20–40% even when correct; 72% blocked everything |
| Per-frame minimum **0%** (was **55%**) | Consensus voting is the guardrail now, not per-frame floor |
| Non-shortcut letters → status message, no action | User sees feedback without wrong canvas actions |
| Orange guide overlay in JSX | Shows where to place hand |
| Updated status / unclear messages | Easier debugging (frame guesses, box hint) |

### `frontend/src/index.css`

| Change | Why |
|--------|-----|
| `.sign-stage { position: relative }` | Positions overlay on camera |
| `.sign-hand-guide` (55% × 72%, dashed orange border) | Visual target synced with capture coordinates |

---

## Part 4 — Troubleshooting (for puller)

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `503` on predict-sign | Missing `backend/models/asl_model.pth` | Pull latest or train/copy weights |
| `401` on predict-sign | Not logged in | Register/login first |
| Always "Unclear" | Hand outside box / bad lighting | Use orange box, plain wall, hold 2s |
| Wrong letter (e.g. Y for A) | Domain shift / glare | Try left hand, reduce glare, retry capture |
| Camera won't start | OBS virtual cam or permission | Close OBS; Retry camera; check browser permission |
| Frontend can't reach API | Backend not on 8002 | Start uvicorn on port **8002** |
| `ModuleNotFoundError: torch` | Venv not activated or incomplete install | `pip install -r requirements.txt` |
| DB connection error | Wrong `DATABASE_URL` | Fix `.env`, ensure PostgreSQL + `studycanvas` DB exist |

---

## Part 5 — What this push does NOT include

- Retraining or new CNN checkpoints
- Dataset changes (`datasets/asl_combined/...`)
- `.env` or credentials
- AI explain / Groq setup (separate feature)
- Fix for right-hand vs left-hand bias (future: more webcam training data)

---

## Part 6 — Quick parity checklist (puller)

After pull + setup, confirm:

- [ ] `backend/models/asl_model.pth` exists (~1.5 MB)
- [ ] `backend/.env` has valid `DATABASE_URL` + `JWT_SECRET`
- [ ] Backend running on **8002**
- [ ] Frontend on **5173**, logged in
- [ ] Sign Access → camera on → orange box visible
- [ ] Capture sign → shortcut fires or shows `Frames: ...` with percentages
- [ ] No `503` on `/accessibility/predict-sign`

---

*Document for Spatial AI Canvas — ASL live recognition deployment. Update the "Status" line at top after you push.*
