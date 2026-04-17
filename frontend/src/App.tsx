import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { AssetRecordType, Tldraw, createShapeId, toRichText, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { SproutLogo, SproutHero, SproutDecor, SproutSmall } from './Sprout'
import { BambooStalk } from './Panda'

type AuthMode = 'login' | 'signup'
type UserInfo = { id: string; name: string; email: string }
type Project = { id: string; name: string; group: string; updatedAt: string }
type WsTheme = 'light' | 'dark'
type DiagramNode = { id: string; label: string; row: number; col: number; shape: string; color: string }
type DiagramEdge = { from: string; to: string; label: string }
type DiagramData = { title: string; nodes: DiagramNode[]; edges: DiagramEdge[] }
type ExplainResponse = { explanation: string; diagram?: DiagramData | null; visual_steps: string[] }
type ChatRole = 'user' | 'assistant'
type ChatMessage = { role: ChatRole; content: string }

interface SpeechRecognitionEventLike { results: ArrayLike<ArrayLike<{ transcript: string }>> }
interface SpeechRecognition {
  continuous: boolean; interimResults: boolean; lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null; onend: (() => void) | null
  start: () => void; stop: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognition
type WindowWithSpeech = Window & typeof globalThis & {
  webkitSpeechRecognition?: SpeechRecognitionConstructor
  SpeechRecognition?: SpeechRecognitionConstructor
}

function displayExplanationText(text: string): string {
  const t = text.trim()
  if (!t.startsWith('{')) return text
  try {
    const o = JSON.parse(t) as { explanation?: unknown }
    if (typeof o.explanation === 'string' && o.explanation.trim()) return o.explanation.trim()
  } catch {
    /* ignore */
  }
  return text
}

const TOKEN_KEY = 'sc_token'
/** Dev: Vite proxies /api -> FastAPI. Prod or override: set VITE_API_URL (e.g. http://127.0.0.1:8765). */
const API = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '/api' : 'http://127.0.0.1:8765')

function formatApiError(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((e: { msg?: string }) => e?.msg).filter(Boolean).join(' ') || 'Request failed'
  }
  return 'Authentication failed'
}

const WS_THEMES = {
  light: { board: '#ffffff', grid: '#cce0f0', margin: '#e8a0a0', text: '#1a1a1a' },
  dark: { board: '#1a1a2e', grid: '#2a3a5c', margin: '#5c3a3a', text: '#d4d4e0' },
}

const apiFetch = async (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> ?? {}) }
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${API}${path}`, { ...opts, headers })
}

const FEATURES = [
  { icon: '🎨', title: 'Infinite Canvas', desc: 'Draw, sketch, and annotate freely on a boundless whiteboard with zoom and pan.' },
  { icon: '🤖', title: 'AI Copilot', desc: 'Ask questions by text or voice — get instant explanations and visual diagrams on your canvas.' },
  { icon: '🎙️', title: 'Voice Control', desc: 'Speak naturally and the AI listens, transcribes, and responds in real-time.' },
  { icon: '📄', title: 'Document Upload', desc: 'Drop PDFs and images directly onto your canvas to annotate and study.' },
  { icon: '📊', title: 'Visual Diagrams', desc: 'AI generates step-by-step visual breakdowns drawn right on your workspace.' },
  { icon: '📁', title: 'Organized Projects', desc: 'Group canvases by subject — Physics, Chemistry, Math — and pick up where you left off.' },
]

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'workspace'>('landing')
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [wsTheme, setWsTheme] = useState<WsTheme>('light')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [isListening, setIsListening] = useState(false)
  const [autoSendVoice, setAutoSendVoice] = useState(true)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [stylesOpen, setStylesOpen] = useState(false)

  const [user, setUser] = useState<UserInfo | null>(null)
  const [projects, setProjects] = useState<Project[]>([])

  const editorRef = useRef<Editor | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const authSectionRef = useRef<HTMLDivElement | null>(null)
  const pendingDiagramRef = useRef<{ diagram?: DiagramData; steps?: string[] } | null>(null)

  const userName = user?.name ?? ''

  const groups = useMemo(() => {
    const set = new Set(projects.map((p) => p.group).filter(Boolean))
    return Array.from(set).sort()
  }, [projects])

  const filteredProjects = activeGroup ? projects.filter((p) => p.group === activeGroup) : projects
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null
  const activeTheme = WS_THEMES[wsTheme]

  const voiceSupported = Boolean(
    (window as WindowWithSpeech).SpeechRecognition || (window as WindowWithSpeech).webkitSpeechRecognition,
  )

  const loadProjects = useCallback(async () => {
    if (!user) return
    const r = await apiFetch('/projects')
    if (r.ok) setProjects(await r.json())
  }, [user])

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) return
    void apiFetch('/auth/me').then(r => {
      if (!r.ok) throw new Error()
      return r.json()
    }).then((u: UserInfo) => { setUser(u); setScreen('workspace') })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
  }, [])

  useEffect(() => { void loadProjects() }, [loadProjects])

  useEffect(() => {
    if (!selectedProjectId || !user) { setChatHistory([]); return }
    void apiFetch(`/projects/${selectedProjectId}/chat`)
      .then(r => r.ok ? r.json() : []).then(setChatHistory)
  }, [selectedProjectId, user])

  const scrollToAuth = () => {
    authSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const onMount = (editor: Editor) => {
    editorRef.current = editor
    ;(editor as unknown as { updateInstanceState: (d: object) => void }).updateInstanceState({ isGridMode: true })
    const pending = pendingDiagramRef.current
    if (pending) {
      pendingDiagramRef.current = null
      if (pending.diagram) drawDiagramOnCanvas(pending.diagram)
      else if (pending.steps) drawVisualStepsOnCanvas(pending.steps)
    }
  }

  const drawVisualStepsOnCanvas = (steps: string[]) => {
    const editor = editorRef.current
    if (!editor || steps.length === 0) return
    const shapes = steps.slice(0, 8).map((step, i) => ({
      id: createShapeId(), type: 'geo', x: 160, y: 140 + i * 130,
      props: { geo: 'rectangle', w: 320, h: 90, richText: toRichText(`${i + 1}. ${step}`), color: 'black', size: 'm' },
    }))
    editor.createShapes(shapes as Parameters<typeof editor.createShapes>[0])
    editor.zoomToFit()
  }

  const drawDiagramOnCanvas = (diagram: DiagramData) => {
    const editor = editorRef.current
    if (!editor || diagram.nodes.length === 0) return

    const NODE_W = 260
    const NODE_H = 80
    const COL_GAP = 320
    const ROW_GAP = 180
    const BASE_X = 120
    const BASE_Y = 120
    type TldrawColor = 'black' | 'blue' | 'green' | 'red' | 'orange' | 'violet' | 'yellow' | 'grey' | 'light-blue' | 'light-green' | 'light-red' | 'light-violet' | 'white'
    const TLDRAW_COLORS: Set<string> = new Set([
      'black', 'blue', 'green', 'red', 'orange', 'violet', 'yellow',
      'grey', 'light-blue', 'light-green', 'light-red', 'light-violet', 'white',
    ])
    const safeColor = (c: string): TldrawColor => TLDRAW_COLORS.has(c) ? c as TldrawColor : 'black'

    const nodeShapes: Parameters<typeof editor.createShapes>[0] = []
    const posMap = new Map<string, { x: number; y: number }>()

    nodeShapes.push({
      id: createShapeId(), type: 'text', x: BASE_X, y: BASE_Y - 70,
      props: { richText: toRichText(diagram.title), size: 'xl', color: 'black' },
    })

    for (const node of diagram.nodes) {
      const x = BASE_X + node.col * COL_GAP
      const y = BASE_Y + node.row * ROW_GAP
      posMap.set(node.id, { x, y })
      const geo = node.shape === 'ellipse' ? 'ellipse' : node.shape === 'diamond' ? 'diamond' : 'rectangle'
      nodeShapes.push({
        id: createShapeId(), type: 'geo', x, y,
        props: {
          geo, w: NODE_W, h: NODE_H,
          richText: toRichText(node.label),
          color: safeColor(node.color),
          fill: 'semi', size: 'm',
        },
      })
    }
    editor.createShapes(nodeShapes)

    const arrowShapes: Parameters<typeof editor.createShapes>[0] = []
    const labelShapes: Parameters<typeof editor.createShapes>[0] = []

    for (const edge of diagram.edges) {
      const from = posMap.get(edge.from)
      const to = posMap.get(edge.to)
      if (!from || !to) continue

      let startX: number, startY: number, endX: number, endY: number
      if (from.y === to.y) {
        if (from.x < to.x) {
          startX = from.x + NODE_W; startY = from.y + NODE_H / 2
          endX = to.x; endY = to.y + NODE_H / 2
        } else {
          startX = from.x; startY = from.y + NODE_H / 2
          endX = to.x + NODE_W; endY = to.y + NODE_H / 2
        }
      } else if (from.y < to.y) {
        startX = from.x + NODE_W / 2; startY = from.y + NODE_H
        endX = to.x + NODE_W / 2; endY = to.y
      } else {
        startX = from.x + NODE_W / 2; startY = from.y
        endX = to.x + NODE_W / 2; endY = to.y + NODE_H
      }

      arrowShapes.push({
        id: createShapeId(), type: 'arrow',
        x: startX, y: startY,
        props: {
          start: { x: 0, y: 0 },
          end: { x: endX - startX, y: endY - startY },
          color: 'black', size: 's',
        },
      })

      if (edge.label) {
        labelShapes.push({
          id: createShapeId(), type: 'text',
          x: (startX + endX) / 2 + 10, y: (startY + endY) / 2 - 12,
          props: { richText: toRichText(edge.label), size: 's', color: 'grey' },
        })
      }
    }

    if (arrowShapes.length > 0) editor.createShapes(arrowShapes)
    if (labelShapes.length > 0) editor.createShapes(labelShapes)
    editor.zoomToFit()
  }

  const createProject = async () => {
    const projectName = window.prompt('Canvas name:')
    if (!projectName) return
    const groupName = window.prompt('Group (e.g. Physics, Chemistry, Math):', 'General') || 'General'
    const res = await apiFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({ name: projectName.trim(), group: groupName.trim() }),
    })
    if (res.ok) {
      const project = await res.json()
      await loadProjects()
      setSelectedProjectId(project.id)
    }
  }

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const safeEmail = email.trim().toLowerCase()
    if (!safeEmail || !password.trim()) { setMessage('Please enter email and password.'); return }
    if (authMode === 'signup' && !name.trim()) { setMessage('Please enter your name.'); return }
    try {
      const endpoint = authMode === 'signup' ? '/auth/signup' : '/auth/login'
      const body: Record<string, string> = { email: safeEmail, password }
      if (authMode === 'signup') body.name = name.trim()
      const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) { setMessage(formatApiError(data.detail)); return }
      localStorage.setItem(TOKEN_KEY, data.token)
      setUser(data.user)
      setMessage('')
      setScreen('workspace')
    } catch { setMessage('Connection failed. Is the backend running?') }
  }

  const logOut = () => {
    recognitionRef.current?.stop()
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    setProjects([])
    setSelectedProjectId(null)
    setScreen('landing')
    setEmail(''); setPassword('')
    setChatHistory([]); setChatInput('')
    setIsListening(false); setActiveGroup(null)
  }

  const submitPrompt = async (rawPrompt?: string) => {
    const prompt = (rawPrompt ?? chatInput).trim()
    if (!prompt) return
    setChatInput('')
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: prompt }]
    setChatHistory(newHistory)
    setAiLoading(true); setAiError('')
    try {
      const res = await apiFetch('/ai/explain', {
        method: 'POST',
        body: JSON.stringify({
          messages: newHistory,
          project_id: selectedProjectId,
          language: 'English',
        }),
      })
      if (!res.ok) {
        const errBody = await res.text()
        throw new Error(errBody || `AI request failed (${res.status})`)
      }
      const data = (await res.json()) as ExplainResponse
      const explanationText = displayExplanationText(data.explanation)
      const hasDiagram = data.diagram && data.diagram.nodes && data.diagram.nodes.length > 0
      const suffix = hasDiagram ? '\n\n[Diagram generated on canvas]' : ''
      setChatHistory((prev) => [...prev, { role: 'assistant', content: explanationText + suffix }])

      if (hasDiagram) {
        if (editorRef.current) drawDiagramOnCanvas(data.diagram!)
        else pendingDiagramRef.current = { diagram: data.diagram! }
      } else if (data.visual_steps && data.visual_steps.length > 0) {
        if (editorRef.current) drawVisualStepsOnCanvas(data.visual_steps)
        else pendingDiagramRef.current = { steps: data.visual_steps }
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Unexpected error')
    } finally { setAiLoading(false) }
  }

  const toggleVoiceMode = () => {
    if (!voiceSupported) { setAiError('Voice not supported.'); return }
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return }
    const Constructor = (window as WindowWithSpeech).SpeechRecognition || (window as WindowWithSpeech).webkitSpeechRecognition
    if (!Constructor) return
    const recognition = new Constructor()
    recognition.continuous = true; recognition.interimResults = false; recognition.lang = 'en-US'
    recognition.onresult = (event) => {
      const collected: string[] = []
      for (let i = 0; i < event.results.length; i += 1) {
        const t = event.results[i][0]?.transcript?.trim()
        if (t) collected.push(t)
      }
      const text = collected.join(' ').trim()
      if (!text) return
      if (autoSendVoice) void submitPrompt(text)
      else setChatInput((prev) => `${prev} ${text}`.trim())
    }
    recognition.onerror = () => { setAiError('Voice error.'); setIsListening(false) }
    recognition.onend = () => setIsListening(false)
    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }

  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    const editor = editorRef.current
    if (!editor || files.length === 0) return
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/') && file.type !== 'application/pdf') continue

      if (file.type === 'application/pdf' || file.name.endsWith('.pdf') || file.name.endsWith('.docx')) {
        const formData = new FormData()
        formData.append('file', file)
        try {
          const res = await apiFetch('/ai/extract', { method: 'POST', body: formData })
          if (res.ok) {
            const { text } = await res.json()
            if (text) {
              const shapeId = createShapeId()
              editor.createShapes([{
                id: shapeId, type: 'text', x: 100, y: 100,
                props: { richText: toRichText(text.slice(0, 3000)), size: 's', color: 'black' },
              }])
            }
          }
        } catch { /* fall through to image placement */ }
      }

      if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(file)
        })
        const img = new Image()
        img.src = dataUrl
        await new Promise<void>((resolve) => { img.onload = () => resolve() })
        const assetId = AssetRecordType.createId()
        const shapeId = createShapeId()
        const maxW = 600
        const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1
        editor.createAssets([{
          id: assetId, type: 'image', typeName: 'asset',
          props: { name: file.name, src: dataUrl, w: img.naturalWidth, h: img.naturalHeight, mimeType: file.type, isAnimated: false },
          meta: {},
        }])
        editor.createShapes([{ id: shapeId, type: 'image', x: 100, y: 100, props: { assetId, w: img.naturalWidth * scale, h: img.naturalHeight * scale } }])
      }
    }
    editor.zoomToFit()
  }, [])

  const onCanvasDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDraggingFile(false)
    if (e.dataTransfer.files.length > 0) void handleFileUpload(e.dataTransfer.files)
  }, [handleFileUpload])
  const onCanvasDragOver = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDraggingFile(true) }, [])
  const onCanvasDragLeave = useCallback(() => setIsDraggingFile(false), [])

  /* ====== LANDING (scrollable: hero → features → auth) ====== */
  if (!user && screen === 'landing') {
    return (
      <div className="landing-scroll">
        {/* --- NAV --- */}
        <nav className="l-nav">
          <div className="l-nav-brand">
            <SproutLogo className="l-nav-logo" />
            <span>StudyCanvas</span>
          </div>
          <div className="l-nav-links">
            <button className="l-nav-link" onClick={scrollToAuth}>Features</button>
            <button className="l-nav-link" onClick={scrollToAuth}>About</button>
            <button className="l-nav-cta" onClick={scrollToAuth}>Get Started</button>
          </div>
        </nav>

        {/* --- HERO --- */}
        <section className="l-hero">
          <div className="l-hero-blob l-blob-1" />
          <div className="l-hero-blob l-blob-2" />
          <div className="l-hero-blob l-blob-3" />
          <div className="l-dot-grid" />

          <div className="l-hero-content">
            <span className="l-badge">AI-Powered Learning</span>
            <h1>Your AI study companion<br />that <span className="l-gradient-text">thinks visually.</span></h1>
            <p className="l-hero-sub">
              Stop switching between notes and AI. StudyCanvas puts an intelligent copilot
              right on your infinite whiteboard — sketch, ask, and learn in one place.
            </p>
            <div className="l-hero-btns">
              <button className="l-btn-primary" onClick={scrollToAuth}>Start Learning Free</button>
              <button className="l-btn-outline" onClick={scrollToAuth}>See How It Works</button>
            </div>
          </div>

          <div className="l-hero-visual">
            <div className="l-hero-card l-card-1">
              <div className="l-card-dot green" />
              <span>Explain backpropagation</span>
            </div>
            <div className="l-hero-card l-card-2">
              <div className="l-card-dot pink" />
              <span>AI draws diagrams on your canvas</span>
            </div>
            <div className="l-hero-card l-card-3">
              <div className="l-card-dot green" />
              <span>Voice: "What is entropy?"</span>
            </div>
            <SproutHero className="l-hero-sprout" />
          </div>
        </section>

        {/* --- FEATURES --- */}
        <section className="l-features">
          <SproutDecor className="l-features-decor l-features-decor-1" />
          <SproutDecor className="l-features-decor l-features-decor-2" />
          <div className="l-features-header">
            <span className="l-badge">Features</span>
            <h2>Everything you need to study smarter</h2>
            <p>A complete spatial learning toolkit — canvas, AI, voice, and documents in one workspace.</p>
          </div>
          <div className="l-features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="l-feature-card">
                <span className="l-feature-icon">{f.icon}</span>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* --- HOW IT WORKS --- */}
        <section className="l-how">
          <div className="l-how-header">
            <span className="l-badge">How It Works</span>
            <h2>Three steps to visual learning</h2>
          </div>
          <div className="l-how-steps">
            <div className="l-step">
              <div className="l-step-num">1</div>
              <h3>Open your canvas</h3>
              <p>Create a workspace for any subject. Draw, type, or upload documents.</p>
            </div>
            <div className="l-step-arrow">→</div>
            <div className="l-step">
              <div className="l-step-num">2</div>
              <h3>Ask the AI</h3>
              <p>Type or speak your question. The AI understands context and generates explanations.</p>
            </div>
            <div className="l-step-arrow">→</div>
            <div className="l-step">
              <div className="l-step-num">3</div>
              <h3>Learn visually</h3>
              <p>AI draws step-by-step diagrams right on your canvas. Everything stays in one place.</p>
            </div>
          </div>
          <SproutSmall className="l-how-sprout" />
        </section>

        {/* --- AUTH SECTION --- */}
        <section className="l-auth" ref={authSectionRef}>
          <div className="l-auth-left">
            <h2>Ready to think<br /><span className="l-gradient-text">spatially?</span></h2>
            <p>Join students who are already learning with AI on an infinite canvas. Free to start, no credit card.</p>
            <div className="l-auth-trust">
              <SproutSmall className="l-auth-sprout" />
              <div className="l-auth-stats">
                <span>Infinite Canvas</span>
                <span>AI Copilot</span>
                <span>100% Free</span>
              </div>
            </div>
          </div>
          <div className="l-auth-right">
            <form className="l-auth-card" onSubmit={(e) => void handleAuth(e)}>
              <h3>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h3>
              <p className="l-auth-sub">{authMode === 'login' ? 'Sign in to your workspace' : 'Start your learning journey'}</p>
              {authMode === 'signup' && (
                <input className="l-input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
              )}
              <input className="l-input" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className="l-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {message && <p className="l-auth-error">{message}</p>}
              <button className="l-btn-primary l-auth-submit" type="submit">
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
              <button className="l-switch" type="button"
                onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setMessage('') }}>
                {authMode === 'login' ? "Don't have an account? Sign up" : 'Already registered? Sign in'}
              </button>
            </form>
          </div>
        </section>

        {/* --- FOOTER --- */}
        <footer className="l-footer">
          <SproutLogo className="l-footer-logo" />
          <span>StudyCanvas — AI-Powered Spatial Learning</span>
        </footer>
      </div>
    )
  }

  /* ====== DASHBOARD ====== */
  if (screen === 'workspace' && !selectedProject) {
    return (
      <div className="dash">
        <nav className="dash-nav">
          <div className="dash-nav-brand">
            <SproutLogo className="dash-brand-logo" />
            <span>StudyCanvas</span>
          </div>
          <div className="dash-nav-right">
            <span className="dash-user">Hi, {userName}</span>
            <button className="l-btn-outline dash-logout" onClick={logOut}>Log Out</button>
          </div>
        </nav>

        <div className="dash-body">
          <div className="dash-welcome">
            <div className="dash-welcome-text">
              <h1>My Workspace</h1>
              <p>Pick up where you left off, or start something new.</p>
            </div>
            <SproutDecor className="dash-welcome-sprout" />
          </div>

          <div className="dash-toolbar">
            <div className="dash-groups">
              <button className={`dash-chip ${!activeGroup ? 'dash-chip-active' : ''}`} onClick={() => setActiveGroup(null)}>All</button>
              {groups.map((g) => (
                <button key={g} className={`dash-chip ${activeGroup === g ? 'dash-chip-active' : ''}`} onClick={() => setActiveGroup(g)}>{g}</button>
              ))}
            </div>
            <button className="l-btn-primary" onClick={createProject}>+ New Canvas</button>
          </div>

          <section className="dash-grid">
            <button className="dash-new-card" onClick={createProject}>
              <span className="dash-plus">+</span>
              <span>New Canvas</span>
            </button>

            {filteredProjects.map((project) => (
              <button key={project.id} className="dash-card"
                onClick={() => { setSelectedProjectId(project.id); setScreen('workspace') }}>
                <div className="dash-card-preview">
                  <BambooStalk className="dash-card-bamboo" height={100} />
                </div>
                <div className="dash-card-info">
                  <span className="dash-card-tag">{project.group}</span>
                  <h3>{project.name}</h3>
                  <p>{project.updatedAt}</p>
                </div>
              </button>
            ))}

            {filteredProjects.length === 0 && (
              <div className="dash-empty">
                <SproutHero className="dash-empty-sprout" />
                <p>{activeGroup ? `No canvases in "${activeGroup}".` : 'No canvases yet — create your first one!'}</p>
                <button className="l-btn-primary" onClick={createProject}>Create Canvas</button>
              </div>
            )}
          </section>
        </div>
      </div>
    )
  }

  /* ====== WORKSPACE ====== */
  const isDark = wsTheme === 'dark'

  return (
    <div className={`ws-shell ${isDark ? 'ws-dark' : 'ws-light'}`}>
      <aside className="ws-sidebar">
        <div className="ws-sidebar-top">
          <SproutLogo className="ws-brand-icon" />
          <span className="ws-brand-text">StudyCanvas</span>
        </div>
        <nav className="ws-nav">
          <button className="ws-nav-item" onClick={() => setSelectedProjectId(null)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h5v5H2V2zm7 0h5v5H9V2zM2 9h5v5H2V9zm7 0h5v5H9V9z" stroke="currentColor" strokeWidth="1.3"/></svg>
            My Workspace
          </button>
          {projects.map((project) => (
            <button key={project.id}
              className={`ws-nav-item ${selectedProject?.id === project.id ? 'ws-nav-active' : ''}`}
              onClick={() => { setSelectedProjectId(project.id); setScreen('workspace') }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2h10v12H3z" stroke="currentColor" strokeWidth="1.3"/><path d="M5 5h6M5 8h4" stroke="currentColor" strokeWidth="1.1"/></svg>
              {project.name}
            </button>
          ))}
        </nav>
        <div className="ws-sidebar-bottom">
          <SproutSmall className="ws-sidebar-sprout" />
        </div>
      </aside>

      <main className="ws-main">
        <header className="ws-header">
          <div className="ws-header-left">
            <h2>{selectedProject?.name ?? 'Canvas'}</h2>
          </div>
          <div className="ws-header-right">
            <button className="ws-btn ws-theme-toggle" onClick={() => setWsTheme(isDark ? 'light' : 'dark')}
              title={isDark ? 'Switch to Light' : 'Switch to Dark'}>
              {isDark ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3a6 6 0 009 5.2A9 9 0 1112 3z" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,200,50,0.15)"/></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              )}
            </button>
            <button className={`ws-btn ${stylesOpen ? 'ws-btn-active' : ''}`} onClick={() => setStylesOpen(!stylesOpen)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="2" fill="currentColor"/><circle cx="12" cy="4" r="2" fill="currentColor"/><circle cx="4" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>
              Styles
            </button>
            <button className="ws-btn" onClick={() => fileInputRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Upload
            </button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple hidden
              onChange={(e) => { if (e.target.files) void handleFileUpload(e.target.files) }} />
            <button className={`ws-btn ${isListening ? 'ws-btn-active' : ''}`} onClick={toggleVoiceMode} disabled={!voiceSupported}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1a2 2 0 012 2v4a2 2 0 01-4 0V3a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.3"/><path d="M4 7a4 4 0 008 0M8 13v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              {isListening ? 'Listening...' : 'Voice'}
            </button>
            <button className="ws-btn ws-btn-logout" onClick={logOut}>Log Out</button>
          </div>
        </header>

        <div className="ws-body">
          <section className={`canvas-wrap ${isDraggingFile ? 'canvas-wrap-dropping' : ''} ${stylesOpen ? 'styles-open' : ''}`}
            style={{ '--board-color': activeTheme.board } as CSSProperties}
            onDrop={onCanvasDrop} onDragOver={onCanvasDragOver} onDragLeave={onCanvasDragLeave}>
            {isDraggingFile && <div className="drop-overlay"><span>Drop file here</span></div>}
            <Tldraw persistenceKey={`board_${selectedProject?.id ?? 'default'}`} onMount={onMount} />
          </section>
        </div>

        {chatOpen && (
          <div className="ai-popup">
            <div className="ai-popup-header">
              <span>AI Copilot</span>
              <div className="ai-popup-actions">
                <label className="ai-popup-auto">
                  <input type="checkbox" checked={autoSendVoice} onChange={(e) => setAutoSendVoice(e.target.checked)} />
                  Auto-send voice
                </label>
                <button className="ai-popup-close" onClick={() => setChatOpen(false)}>
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                </button>
              </div>
            </div>
            <div className="ai-popup-messages">
              {chatHistory.length === 0 && <p className="ai-popup-empty">Ask anything. AI will explain and draw diagrams on your canvas.</p>}
              {chatHistory.map((entry, idx) => (
                <div key={`${entry.role}_${idx}`} className={`ai-msg ai-msg-${entry.role}`}>{entry.content}</div>
              ))}
              {aiLoading && <div className="ai-msg ai-msg-assistant ai-msg-loading">Thinking...</div>}
              {aiError && <p className="ai-popup-error">{aiError}</p>}
            </div>
            <div className="ai-popup-input">
              <input placeholder="Ask anything..."
                value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitPrompt() } }} />
              <button className="ai-popup-send" onClick={() => void submitPrompt()} disabled={aiLoading}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l12-6-4 6 4 6L2 8z" fill="currentColor"/></svg>
              </button>
            </div>
          </div>
        )}

        <button className={`ai-fab ${chatOpen ? 'ai-fab-active' : ''}`} onClick={() => setChatOpen(!chatOpen)}
          title="AI Copilot">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.5 3.53 1.36 5L2 22l5-1.36A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="1.5"/><path d="M8 10h.01M12 10h.01M16 10h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </main>
    </div>
  )
}
