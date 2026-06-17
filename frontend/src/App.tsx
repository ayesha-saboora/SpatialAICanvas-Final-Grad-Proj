import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { AssetRecordType, Tldraw, createShapeId, toRichText, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { SproutLogo, SproutHero, SproutDecor, SproutSmall } from './Sprout'
import { Sparkle } from './Sparkle'
import { collectSpatialContext, resolveSelectionIds, type StoredDocument } from './spatialContext'
import { renderPdfPages } from './pdfRender'
import { renderGraphToDataUrl, type GraphSpec } from './graphPlot'
import { TablePicker } from './TablePicker'
import { PlantTimer } from './PlantTimer'
import { SignAccessibilityPanel, type SignAccessMode } from './SignAccessibilityPanel'
import { formatMathAnswer, getMathAnswerOrigin, recognizeDrawnMath, type MathSymbolResult } from './mathRecognize'
import {
  placeSolutionOnCanvas,
  parseSolutionFromExplanation,
  buildFallbackSolution,
  isSolvePrompt,
  type SolutionPayload,
} from './canvasSolution'
import {
  placeStemExplanationOnCanvas,
  buildStemFromExplanation,
  type StemPayload,
} from './canvasStemFormat'
import {
  applyCanvasTheme,
  CANVAS_BOARD_DARK,
  CANVAS_BOARD_LIGHT,
  diagramArrowColor,
  diagramEdgeLabelColor,
  diagramTitleColor,
  mathAnswerColor,
} from './canvasTheme'
import {
  STUDY_CANVAS_COMPONENTS,
  STUDY_CANVAS_OVERRIDES,
  STUDY_CANVAS_SHAPE_UTILS,
  STUDY_CANVAS_TOOLS,
  setupStudyCanvasEditor,
  setCanvasUiTheme,
} from './tldrawConfig'

type AuthMode = 'login' | 'signup'
type UserInfo = { id: string; name: string; email: string }
type Project = { id: string; name: string; group: string; updatedAt: string }
type WsTheme = 'light' | 'dark'
type DiagramNode = { id: string; label: string; row: number; col: number; shape: string; color: string }
type DiagramEdge = { from: string; to: string; label: string }
type GraphFunctionSpec = { expr: string; label: string; color: string }
type GraphPointSpec = { x: number; y: number; label?: string }
type DiagramData = {
  type?: 'flowchart' | 'graph' | 'labeled_diagram'
  title: string
  subtitle?: string
  nodes?: DiagramNode[]
  edges?: DiagramEdge[]
  functions?: GraphFunctionSpec[]
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  axisLabels?: { x?: string; y?: string }
  points?: GraphPointSpec[]
}
type VisualType = 'flowchart' | 'graph' | 'labeled_diagram'
type SubmitOptions = { generateVisual?: boolean; visualType?: VisualType }
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

function RichMessage({ text }: { text: string }) {
  return (
    <div className="ai-msg-rich">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

function displayExplanationText(text: string): string {
  const t = text.trim()
  if (!t.startsWith('{')) return text
  try {
    const o = JSON.parse(t) as { explanation?: unknown }
    if (typeof o.explanation === 'string' && o.explanation.trim()) return o.explanation.trim()
  } catch {
    /* try partial JSON below */
  }
  const m = t.match(/"explanation"\s*:\s*"((?:[^"\\]|\\.)*)"/s)
  if (m?.[1]) {
    try {
      return JSON.parse(`"${m[1]}"`).trim()
    } catch {
      return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim()
    }
  }
  return text
}


/** Lay out nodes as a readable top-down process flowchart.
 *  Respects execution order, spreads decision branches left/right, and handles loop-back edges. */
function autoLayoutDiagram(diagram: DiagramData): DiagramData {
  const nodes = diagram.nodes ?? []
  const edges = diagram.edges ?? []
  if (nodes.length === 0) return { ...diagram, nodes, edges }

  const idSet = new Set(nodes.map((n) => n.id))
  const outgoing = new Map<string, { to: string; label: string }[]>()
  const incomingCount = new Map<string, number>()

  for (const n of nodes) {
    outgoing.set(n.id, [])
    incomingCount.set(n.id, 0)
  }
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue
    outgoing.get(e.from)!.push({ to: e.to, label: e.label ?? '' })
    incomingCount.set(e.to, (incomingCount.get(e.to) ?? 0) + 1)
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  let startNodes = nodes.filter((n) => (incomingCount.get(n.id) ?? 0) === 0)
  if (startNodes.length === 0) {
    startNodes = [...nodes].sort((a, b) => a.row - b.row || a.col - b.col).slice(0, 1)
  } else {
    startNodes.sort((a, b) => {
      if (a.color === 'black' && b.color !== 'black') return -1
      if (b.color === 'black' && a.color !== 'black') return 1
      return a.row - b.row || a.col - b.col
    })
  }
  const startId = startNodes[0].id

  const level = new Map<string, number>()
  level.set(startId, 0)
  const bfsQueue = [startId]
  while (bfsQueue.length > 0) {
    const id = bfsQueue.shift()!
    for (const { to } of outgoing.get(id) ?? []) {
      if (!level.has(to)) {
        level.set(to, level.get(id)! + 1)
        bfsQueue.push(to)
      }
    }
  }

  // Longest-path pass — skip back-edges (loop arrows) so cycles cannot spin forever.
  for (let iter = 0; iter < nodes.length; iter++) {
    let changed = false
    for (const e of edges) {
      if (!idSet.has(e.from) || !idSet.has(e.to) || !level.has(e.from) || !level.has(e.to)) continue
      if (level.get(e.to)! <= level.get(e.from)!) continue
      const next = level.get(e.from)! + 1
      if (level.get(e.to)! < next) {
        level.set(e.to, next)
        changed = true
      }
    }
    if (!changed) break
  }
  for (const n of nodes) {
    if (!level.has(n.id)) level.set(n.id, n.row)
  }

  const branchLeft = (label: string) => /left|less|lower|no|false|not found|smaller|<|fail|go left/i.test(label)
  const branchRight = (label: string) => /right|greater|higher|yes|true|found|match|success|>|pass|go right/i.test(label)

  const col = new Map<string, number>()
  col.set(startId, 0)

  const sortedLevels = [...new Set(nodes.map((n) => level.get(n.id)!))].sort((a, b) => a - b)
  for (const lv of sortedLevels) {
    const levelIds = nodes.filter((n) => level.get(n.id) === lv).map((n) => n.id)
    for (const id of levelIds) {
      if (col.has(id)) continue
      const parents = edges.filter((e) => e.to === id && col.has(e.from))
      if (parents.length === 0) {
        col.set(id, nodeById.get(id)?.col ?? 0)
      } else if (parents.length === 1) {
        col.set(id, col.get(parents[0].from)!)
      } else {
        const parentCols = parents.map((p) => col.get(p.from)!)
        col.set(id, Math.round(parentCols.reduce((a, b) => a + b, 0) / parentCols.length))
      }
    }
  }

  for (const n of nodes) {
    if (n.shape !== 'diamond') continue
    const outs = outgoing.get(n.id) ?? []
    if (outs.length !== 2) continue
    const baseCol = col.get(n.id) ?? 0
    const [e1, e2] = outs
    if (branchLeft(e1.label) && branchRight(e2.label)) {
      col.set(e1.to, baseCol - 2)
      col.set(e2.to, baseCol + 2)
    } else if (branchRight(e1.label) && branchLeft(e2.label)) {
      col.set(e1.to, baseCol + 2)
      col.set(e2.to, baseCol - 2)
    } else {
      col.set(e1.to, baseCol - 1)
      col.set(e2.to, baseCol + 1)
    }
  }

  const byLevel = new Map<number, DiagramNode[]>()
  for (const n of nodes) {
    const lv = level.get(n.id)!
    if (!byLevel.has(lv)) byLevel.set(lv, [])
    byLevel.get(lv)!.push({ ...n, row: lv, col: col.get(n.id) ?? 0 })
  }

  const laidOut: DiagramNode[] = []
  for (const lv of sortedLevels) {
    const rowNodes = byLevel.get(lv) ?? []
    rowNodes.sort((a, b) => (col.get(a.id) ?? 0) - (col.get(b.id) ?? 0))
    const usedCols = new Set<number>()
    for (const n of rowNodes) {
      let c = col.get(n.id) ?? 0
      while (usedCols.has(c)) c += 1
      usedCols.add(c)
      laidOut.push({ ...n, row: lv, col: c })
    }
  }

  return { ...diagram, nodes: laidOut }
}

type Rect = { x: number; y: number; w: number; h: number }

function rectsOverlap(a: Rect, b: Rect, pad = 12): boolean {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  )
}

function estimateLabelSize(text: string): { w: number; h: number } {
  const len = Math.max(4, Math.min(text.length, 28))
  return { w: 20 + len * 7.5, h: 32 }
}

function placeEdgeLabel(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  nodeRects: Rect[],
  label: string,
): { x: number; y: number } | null {
  const mx = (startX + endX) / 2
  const my = (startY + endY) / 2
  const dx = endX - startX
  const dy = endY - startY
  const len = Math.hypot(dx, dy) || 1
  const px = -dy / len
  const py = dx / len
  const { w, h } = estimateLabelSize(label)

  for (const off of [36, -36, 52, -52, 20, -20]) {
    const x = mx + px * off - w / 2
    const y = my + py * off - h / 2
    const rect = { x, y, w, h }
    if (!nodeRects.some((n) => rectsOverlap(rect, n))) return { x, y }
  }
  return null
}

const TOKEN_KEY = 'sc_token'
/** Dev: Vite proxies /api -> FastAPI. Prod or override: set VITE_API_URL (e.g. http://127.0.0.1:8000). */
const API = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '/api' : 'http://127.0.0.1:8000')

function formatApiError(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((e: { msg?: string }) => e?.msg).filter(Boolean).join(' ') || 'Request failed'
  }
  return 'Authentication failed'
}

const WS_THEMES = {
  light: { board: CANVAS_BOARD_LIGHT, grid: 'rgba(168,85,247,0.22)', gridMinor: 'rgba(168,85,247,0.09)', text: '#1a1a1a' },
  dark: { board: CANVAS_BOARD_DARK, grid: 'rgba(168,85,247,0.35)', gridMinor: 'rgba(168,85,247,0.14)', text: '#fafafa' },
}

const apiFetch = async (path: string, opts: RequestInit = {}) => {
  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string> ?? {}) }
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${API}${path}`, { ...opts, headers })
}

function formatCanvasDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Recently updated'
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Updated today'
  if (diffDays === 1) return 'Updated yesterday'
  if (diffDays < 7) return `Updated ${diffDays} days ago`
  return `Updated ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: now.getFullYear() !== d.getFullYear() ? 'numeric' : undefined })}`
}

const MAIN_FEATURES = [
  { icon: '🎨', title: 'Infinite Canvas', desc: 'Zoom, pan, draw, and organize on a boundless whiteboard — your notes never run out of room.', tag: 'Core' },
  { icon: '🤖', title: 'AI Copilot', desc: 'Ask STEM questions by text or voice and get step-by-step explanations tied to your canvas.', tag: 'AI' },
  { icon: '🎙️', title: 'Voice Input', desc: 'Speak your question hands-free — transcribed and sent to the AI automatically.', tag: 'Access' },
  { icon: '📄', title: 'Document Upload', desc: 'Drop PDFs, slides, and images onto the canvas and annotate them in one place.', tag: 'Core' },
  { icon: '📊', title: 'STEM Graphs', desc: 'Flowcharts, labeled diagrams, and Desmos-style math graphs drawn live on your workspace.', tag: 'Visual' },
  { icon: '🧠', title: 'Intent Classifier', desc: 'Fine-tuned DistilBERT on a custom 49-class STEM dataset routes every prompt to the right action.', tag: 'ML' },
]

const SELL_ACCESS = [
  { icon: '🤟', title: 'Sign Shortcuts', hook: 'Fingerspell F, G, A — control the canvas with your hands.' },
  { icon: '💬', title: 'AAC Spell Mode', hook: 'Spell words via webcam. One tap for "I need help."' },
  { icon: '🎙️', title: 'Voice & TTS', hook: 'Speak questions in, hear answers out — multi-modal by design.' },
]

const SELL_ML = [
  { value: '49', label: 'STEM intent classes' },
  { value: '91.1%', label: 'DistilBERT routing accuracy' },
  { value: 'A–Z', label: 'ASL letters trained' },
  { value: '~60ms', label: 'Intent routing' },
]

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'workspace'>('landing')
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [wsTheme, setWsTheme] = useState<WsTheme>('dark')
  const [dashSearch, setDashSearch] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [visualOffer, setVisualOffer] = useState(false)
  const [aiError, setAiError] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [isListening, setIsListening] = useState(false)
  const [autoSendVoice, setAutoSendVoice] = useState(true)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [aiFloat, setAiFloat] = useState(false)
  const [aiPos, setAiPos] = useState({ x: 60, y: 60 })
  const [intentInfo, setIntentInfo] = useState<{ intent: string; confidence: number; backend?: string } | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [mathRecognizing, setMathRecognizing] = useState(false)
  const [signMode, setSignMode] = useState<SignAccessMode>('shortcut')
  const [stylesOpen, setStylesOpen] = useState(false)
  const [newCanvasOpen, setNewCanvasOpen] = useState(false)
  const [newCanvasName, setNewCanvasName] = useState('')
  const [newCanvasGroup, setNewCanvasGroup] = useState('General')
  const [newCanvasError, setNewCanvasError] = useState('')
  const [canvasEditor, setCanvasEditor] = useState<Editor | null>(null)

  const [user, setUser] = useState<UserInfo | null>(null)
  const [projects, setProjects] = useState<Project[]>([])

  const editorRef = useRef<Editor | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const authSectionRef = useRef<HTMLDivElement | null>(null)
  const featuresSectionRef = useRef<HTMLDivElement | null>(null)
  const aslSectionRef = useRef<HTMLDivElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const pendingDiagramRef = useRef<{ diagram?: DiagramData; steps?: string[] } | null>(null)
  const aiDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)
  /** Keeps last canvas selection when user clicks away into chat. */
  const pinnedSelectionRef = useRef<string[]>([])
  /** Full extracted text per project (not truncated like canvas preview). */
  const projectDocumentsRef = useRef<Map<string, StoredDocument[]>>(new Map())

  const userName = user?.name ?? ''

  const groups = useMemo(() => {
    const set = new Set(projects.map((p) => p.group).filter(Boolean))
    return Array.from(set).sort()
  }, [projects])

  const filteredProjects = projects.filter((p) => {
    if (activeGroup && p.group !== activeGroup) return false
    if (dashSearch.trim() && !p.name.toLowerCase().includes(dashSearch.trim().toLowerCase())) return false
    return true
  })
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null
  const activeTheme = WS_THEMES[wsTheme]
  const isDarkUi = wsTheme === 'dark'

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

  // Keep the AI chat pinned to the latest message (incl. while streaming).
  useEffect(() => {
    const el = chatScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chatHistory, aiLoading, visualOffer, chatOpen])

  useEffect(() => {
    if (!selectedProjectId || !user) { setChatHistory([]); return }
    void apiFetch(`/projects/${selectedProjectId}/chat`)
      .then(r => r.ok ? r.json() : [])
      .then((msgs: ChatMessage[]) =>
        setChatHistory(
          msgs.map((m) =>
            m.role === 'assistant'
              ? { ...m, content: displayExplanationText(m.content) }
              : m,
          ),
        ),
      )
  }, [selectedProjectId, user])

  useEffect(() => {
    if (!canvasEditor) return
    setCanvasUiTheme(isDarkUi ? 'dark' : 'light')
    applyCanvasTheme(canvasEditor, isDarkUi ? 'dark' : 'light')
  }, [canvasEditor, isDarkUi])

  const scrollToAuth = () => {
    authSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  const scrollToFeatures = () => {
    featuresSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }
  const scrollToAsl = () => {
    aslSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const onMount = (editor: Editor) => {
    editorRef.current = editor
    setCanvasEditor(editor)
    setCanvasUiTheme(isDarkUi ? 'dark' : 'light')
    setupStudyCanvasEditor(editor, isDarkUi ? 'dark' : 'light')
    ;(editor as unknown as { updateInstanceState: (d: object) => void }).updateInstanceState({ isGridMode: true })
    editor.store.listen(() => {
      const ids = editor.getSelectedShapeIds().map(String)
      if (ids.length > 0) {
        pinnedSelectionRef.current = resolveSelectionIds(editor, ids)
      }
    }, { source: 'user', scope: 'session' })
    applyCanvasTheme(editor, isDarkUi ? 'dark' : 'light')
    const pending = pendingDiagramRef.current
    if (pending) {
      pendingDiagramRef.current = null
      if (pending.diagram) drawVisualOnCanvas(pending.diagram)
    }
  }

  const getNextDiagramOrigin = (editor: Editor, gap = 220): { x: number; y: number } => {
    const ids = [...editor.getCurrentPageShapeIds()]
    if (ids.length === 0) return { x: 160, y: 160 }
    let maxRight = -Infinity
    let topY = Infinity
    for (const id of ids) {
      const b = editor.getShapePageBounds(id)
      if (!b) continue
      if (b.maxX > maxRight) maxRight = b.maxX
      if (b.minY < topY) topY = b.minY
    }
    if (!isFinite(maxRight)) return { x: 160, y: 160 }
    return { x: maxRight + gap, y: isFinite(topY) ? topY : 160 }
  }

  const zoomToShapes = (editor: Editor, ids: ReturnType<typeof createShapeId>[]) => {
    if (ids.length === 0) return
    const prev = editor.getSelectedShapeIds()
    editor.select(...ids)
    editor.zoomToSelection({ animation: { duration: 400 } })
    editor.setSelectedShapes(prev)
  }

  /** Wrap all diagram shapes in a tldraw group so the whole flowchart can be dragged together.
   *  Double-click the group to enter it and move individual nodes separately. */
  const groupDiagramShapes = (editor: Editor, ids: ReturnType<typeof createShapeId>[]) => {
    if (ids.length <= 1) return null
    const groupId = createShapeId()
    const prevTool = editor.getCurrentToolId()
    if (prevTool !== 'select') editor.setCurrentTool('select')
    editor.groupShapes(ids, { groupId, select: false })
    if (prevTool !== 'select') editor.setCurrentTool(prevTool)
    return groupId
  }

  const drawGraphOnCanvas = (diagram: DiagramData) => {
    const editor = editorRef.current
    if (!editor || !diagram.functions?.length) return
    const spec: GraphSpec = {
      type: 'graph',
      title: diagram.title,
      subtitle: diagram.subtitle,
      functions: diagram.functions,
      xMin: diagram.xMin ?? -5,
      xMax: diagram.xMax ?? 5,
      yMin: diagram.yMin ?? -5,
      yMax: diagram.yMax ?? 5,
      axisLabels: diagram.axisLabels,
      points: diagram.points,
    }
    const { dataUrl, w, h } = renderGraphToDataUrl(spec)
    if (!dataUrl) return
    const origin = getNextDiagramOrigin(editor)
    const assetId = AssetRecordType.createId()
    const imageId = createShapeId()
    const titleId = createShapeId()
    editor.createAssets([{
      id: assetId, type: 'image', typeName: 'asset',
      props: { name: diagram.title, src: dataUrl, w, h, mimeType: 'image/png', isAnimated: false },
      meta: {},
    }])
    editor.createShapes([
      {
        id: titleId, type: 'text', x: origin.x, y: origin.y - 56,
        props: { richText: toRichText(diagram.title), size: 'xl', color: diagramTitleColor(isDarkUi) },
      },
      {
        id: imageId, type: 'image', x: origin.x, y: origin.y,
        meta: { scGeneratedGraph: true },
        props: { assetId, w, h },
      },
    ])
    zoomToShapes(editor, [titleId, imageId])
  }

  const drawVisualOnCanvas = (diagram: DiagramData) => {
    if (diagram.type === 'graph') drawGraphOnCanvas(diagram)
    else drawDiagramOnCanvas(diagram)
  }

  const drawDiagramOnCanvas = (diagram: DiagramData) => {
    const editor = editorRef.current
    if (!editor || !diagram.nodes?.length) return

    const isLabeled = diagram.type === 'labeled_diagram'

    try {
      diagram = autoLayoutDiagram(diagram)
    } catch (err) {
      console.error('Diagram layout failed:', err)
      return
    }

    const origin = getNextDiagramOrigin(editor)
    const NODE_W = isLabeled ? 200 : 300
    const NODE_H = isLabeled ? 72 : 92
    const COL_GAP = isLabeled ? 240 : 380
    const ROW_GAP = isLabeled ? 150 : 260
    const BASE_X = origin.x
    const BASE_Y = origin.y
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
      props: { richText: toRichText(diagram.title), size: 'xl', color: diagramTitleColor(isDarkUi) },
    })

    for (const node of diagram.nodes ?? []) {
      const x = BASE_X + node.col * COL_GAP
      const y = BASE_Y + node.row * ROW_GAP
      posMap.set(node.id, { x, y })
      const geo = node.shape === 'ellipse' ? 'ellipse' : node.shape === 'diamond' ? 'diamond' : 'rectangle'
      const isDecision = node.shape === 'diamond'
      nodeShapes.push({
        id: createShapeId(), type: 'geo', x, y,
        props: {
          geo, w: isDecision ? 260 : NODE_W, h: isDecision ? 100 : NODE_H,
          richText: toRichText(node.label),
          color: safeColor(node.color),
          fill: 'semi', size: 'm',
        },
      })
    }
    editor.createShapes(nodeShapes)

    const nodeRects: Rect[] = (diagram.nodes ?? []).map((node) => {
      const p = posMap.get(node.id)!
      const w = node.shape === 'diamond' ? 260 : NODE_W
      const h = node.shape === 'diamond' ? 100 : NODE_H
      return { x: p.x, y: p.y, w, h }
    })

    const nodeById = new Map((diagram.nodes ?? []).map((n) => [n.id, n]))
    const nodeSize = (id: string) => {
      const shape = nodeById.get(id)?.shape
      return shape === 'diamond' ? { w: 260, h: 100 } : { w: NODE_W, h: NODE_H }
    }

    const arrowShapes: Parameters<typeof editor.createShapes>[0] = []
    const labelShapes: Parameters<typeof editor.createShapes>[0] = []

    for (const edge of diagram.edges ?? []) {
      const from = posMap.get(edge.from)
      const to = posMap.get(edge.to)
      if (!from || !to) continue

      const { w: fromW, h: fromH } = nodeSize(edge.from)
      const { w: toW, h: toH } = nodeSize(edge.to)

      const fromCx = from.x + fromW / 2
      const fromCy = from.y + fromH / 2
      const toCx = to.x + toW / 2
      const toCy = to.y + toH / 2
      const dx = toCx - fromCx
      const dy = toCy - fromCy

      let startX: number
      let startY: number
      let endX: number
      let endY: number

      if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx >= 0) {
          startX = from.x + fromW
          startY = fromCy
          endX = to.x
          endY = toCy
        } else {
          startX = from.x
          startY = fromCy
          endX = to.x + toW
          endY = toCy
        }
      } else if (dy > 0) {
        startX = fromCx
        startY = from.y + fromH
        endX = toCx
        endY = to.y
      } else {
        startX = fromCx
        startY = from.y
        endX = toCx
        endY = to.y + toH
      }

      arrowShapes.push({
        id: createShapeId(), type: 'arrow',
        x: startX, y: startY,
        props: {
          start: { x: 0, y: 0 },
          end: { x: endX - startX, y: endY - startY },
          color: diagramArrowColor(isDarkUi), size: 'm',
        },
      })

      if (edge.label) {
        const pos = placeEdgeLabel(startX, startY, endX, endY, nodeRects, edge.label)
        if (pos) {
          labelShapes.push({
            id: createShapeId(), type: 'text',
            x: pos.x, y: pos.y,
            props: { richText: toRichText(edge.label), size: 'm', color: diagramEdgeLabelColor(isDarkUi) },
          })
        }
      }
    }

    if (arrowShapes.length > 0) editor.createShapes(arrowShapes)
    if (labelShapes.length > 0) editor.createShapes(labelShapes)
    const newIds = [
      ...nodeShapes.map((s) => s.id),
      ...arrowShapes.map((s) => s.id),
      ...labelShapes.map((s) => s.id),
    ].filter((id): id is ReturnType<typeof createShapeId> => Boolean(id))
    const groupId = groupDiagramShapes(editor, newIds)
    zoomToShapes(editor, groupId ? [groupId] : newIds)
  }

  const openNewCanvas = () => {
    setNewCanvasName('')
    setNewCanvasGroup(activeGroup ?? 'General')
    setNewCanvasError('')
    setNewCanvasOpen(true)
  }

  const closeNewCanvas = () => {
    setNewCanvasOpen(false)
    setNewCanvasError('')
  }

  const submitNewCanvas = async () => {
    const name = newCanvasName.trim()
    const group = newCanvasGroup.trim() || 'General'
    if (!name) { setNewCanvasError('Please enter a canvas name.'); return }
    const res = await apiFetch('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, group }),
    })
    if (res.ok) {
      const project = await res.json()
      await loadProjects()
      setSelectedProjectId(project.id)
      setNewCanvasOpen(false)
    } else {
      setNewCanvasError('Could not create canvas. Try again.')
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

  const submitPrompt = async (rawPrompt?: string, options?: SubmitOptions) => {
    const prompt = (rawPrompt ?? chatInput).trim()
    if (!prompt) return
    setChatInput('')
    setVisualOffer(false)
    setIntentInfo(null)

    // Trained Prompt Intent Classifier — shows which action our model predicts.
    void apiFetch('/intent/classify', { method: 'POST', body: JSON.stringify({ text: prompt }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.available && data.intent) {
          setIntentInfo({ intent: data.intent, confidence: data.confidence, backend: data.backend })
        }
      })
      .catch(() => {})
    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', content: prompt }]
    setChatHistory([...newHistory, { role: 'assistant', content: '' }])
    setAiLoading(true); setAiError('')

    const appendAssistant = (delta: string) => {
      setChatHistory((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.role !== 'assistant') return prev
        return [...prev.slice(0, -1), { ...last, content: last.content + delta }]
      })
    }

    const replaceAssistant = (full: string) => {
      setChatHistory((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.role !== 'assistant') return prev
        return [...prev.slice(0, -1), { ...last, content: full }]
      })
    }

    const removeAssistantPlaceholder = () => {
      setChatHistory((prev) => {
        if (prev.length === 0) return prev
        const last = prev[prev.length - 1]
        if (last.role === 'assistant' && !last.content) return prev.slice(0, -1)
        return prev
      })
    }

    try {
      const projectKey = selectedProjectId ?? 'default'
      const storedDocs = projectDocumentsRef.current.get(projectKey) ?? []
      const q = prompt.toLowerCase()
      const needsImages =
        /\b(image|picture|photo|screenshot|see in|look at|what does this show|describe the|pdf page|what is this|what's in)\b/.test(q)
        || /\b(document|pdf|uploaded|my notes|the file|from the reading|in the text)\b/.test(q)
        || pinnedSelectionRef.current.length > 0
      const spatial = editorRef.current
        ? await collectSpatialContext(editorRef.current, {
            pinnedSelectionIds: pinnedSelectionRef.current,
            storedDocuments: storedDocs,
            includeImages: needsImages,
          })
        : {
            canvas_shapes: [],
            canvas_edges: [],
            canvas_summary: '',
            selected_shape_ids: [],
            selected_labels: [],
            document_text: '',
            canvas_images: [],
          }

      const isSolveRequest = isSolvePrompt(prompt)

      // Diagram follow-ups and math solves should not pull stale board/document context.
      if (options?.generateVisual || isSolveRequest) {
        spatial.canvas_summary = ''
        spatial.canvas_edges = []
        spatial.canvas_shapes = []
        spatial.selected_labels = []
        spatial.selected_shape_ids = []
        spatial.document_text = ''
        spatial.canvas_images = []
      }

      const res = await apiFetch('/ai/explain-stream', {
        method: 'POST',
        body: JSON.stringify({
          messages: newHistory,
          project_id: selectedProjectId,
          language: 'English',
          generate_visual: options?.generateVisual ?? false,
          visual_type: options?.visualType ?? '',
          ...spatial,
        }),
      })
      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '')
        throw new Error(errBody || `AI request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalExplanation = ''
      let finalDiagram: DiagramData | null = null
      let finalSolution: SolutionPayload | null = null
      let finalStem: StemPayload | null = null
      let responseMode = ''
      let receivedDone = false
      let errorMessage = ''
      let shouldOfferVisual = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        let nlIdx = buffer.indexOf('\n\n')
        while (nlIdx !== -1) {
          const rawEvent = buffer.slice(0, nlIdx)
          buffer = buffer.slice(nlIdx + 2)
          nlIdx = buffer.indexOf('\n\n')
          if (!rawEvent.startsWith('data: ')) continue
          const json = rawEvent.slice(6)
          let parsed: {
            type: string
            content?: string
            explanation?: string
            diagram?: DiagramData | null
            visual_steps?: string[]
            message?: string
            offer_visual?: boolean
            mode?: string
            solution?: SolutionPayload | null
            stem?: StemPayload | null
          }
          try {
            parsed = JSON.parse(json)
          } catch { continue }
          if (parsed.type === 'text' && parsed.content) {
            appendAssistant(parsed.content)
          } else if (parsed.type === 'done') {
            receivedDone = true
            finalExplanation = parsed.explanation ?? ''
            finalDiagram = parsed.diagram ?? null
            shouldOfferVisual = Boolean(parsed.offer_visual)
            responseMode = parsed.mode ?? ''
            if (parsed.solution?.steps?.length) {
              finalSolution = parsed.solution
            }
            if (parsed.stem?.blocks?.length || parsed.stem?.tests?.length) {
              finalStem = parsed.stem
            }
          } else if (parsed.type === 'error') {
            errorMessage = parsed.message ?? 'AI request failed'
          }
        }
      }

      if (errorMessage) {
        removeAssistantPlaceholder()
        throw new Error(errorMessage)
      }
      if (!receivedDone) {
        throw new Error('Stream ended unexpectedly')
      }

      const hasDiagram = Boolean(
        finalDiagram && (
          finalDiagram.type === 'graph'
            ? finalDiagram.functions?.length
            : finalDiagram.nodes?.length
        ),
      )
      const finalText = (finalExplanation || '').trim()

      const isSolveMode = responseMode === 'solve_step' || responseMode === 'solve_numerical' || isSolvePrompt(prompt)
      let solutionPayload = finalSolution
      if (!solutionPayload && finalText && isSolveMode) {
        solutionPayload = parseSolutionFromExplanation(finalText) ?? buildFallbackSolution(finalText, prompt)
      }

      let canvasNote = ''
      const stemPayload = (!isSolveMode && (finalStem ?? (finalText ? buildStemFromExplanation(finalText) : null))) || null

      if (editorRef.current) {
        if (hasDiagram && finalDiagram) {
          drawVisualOnCanvas(finalDiagram)
          canvasNote = 'visual'
        }

        if (isSolveMode && solutionPayload?.steps?.length) {
          const ids = placeSolutionOnCanvas(editorRef.current, solutionPayload, isDarkUi, prompt, true)
          if (ids.length > 0) canvasNote = 'solution'
        } else if (stemPayload && (stemPayload.blocks.length > 0 || stemPayload.tests.length > 0)) {
          const ids = placeStemExplanationOnCanvas(editorRef.current, stemPayload, isDarkUi)
          if (ids.length > 0) {
            canvasNote = canvasNote === 'visual' ? 'visual+explanation' : 'explanation'
          }
        }
      } else if (hasDiagram && finalDiagram) {
        pendingDiagramRef.current = { diagram: finalDiagram }
        canvasNote = 'visual'
      }

      const solutionSuffix = canvasNote === 'solution' ? '\n\n[Solution notes added to canvas]' : ''
      const stemSuffix = canvasNote === 'explanation' || canvasNote === 'visual+explanation'
        ? '\n\n[Explanation cards added to canvas]' : ''
      const visualSuffix = hasDiagram && finalDiagram ? '\n\n[Visual added to canvas]' : ''
      const canvasSuffix = solutionSuffix + stemSuffix + visualSuffix
      if (finalText) {
        replaceAssistant(finalText + canvasSuffix)
      } else {
        removeAssistantPlaceholder()
      }

      setVisualOffer(shouldOfferVisual && !hasDiagram)

    } catch (error) {
      removeAssistantPlaceholder()
      setAiError(error instanceof Error ? error.message : 'Unexpected error')
    } finally { setAiLoading(false) }
  }

  const requestVisual = (visualType: VisualType) => {
    const label = visualType === 'labeled_diagram' ? 'labeled diagram' : visualType
    const lastAssistant = [...chatHistory].reverse().find(
      (m) => m.role === 'assistant' && m.content.trim().length > 20,
    )
    const topic = lastAssistant?.content.replace(/\s+/g, ' ').trim().slice(0, 300) ?? ''
    const hint = topic ? ` Topic: ${topic}` : ''
    void submitPrompt(`Draw a ${label} on my canvas for what we just discussed.${hint}`, {
      generateVisual: true,
      visualType,
    })
  }

  const placeTextOnCanvas = (editor: Editor, text: string, size: 'xl' | 'l' = 'xl') => {
    const id = createShapeId()
    const origin = getNextDiagramOrigin(editor)
    editor.createShapes([
      {
        id,
        type: 'text',
        x: origin.x,
        y: origin.y,
        props: { richText: toRichText(text), size, color: mathAnswerColor(isDarkUi) },
      },
    ])
    zoomToShapes(editor, [id])
  }

  const predictSign = async (image: Blob): Promise<{ letter: string; confidence: number }> => {
    const form = new FormData()
    form.append('file', image, 'sign.jpg')
    const res = await apiFetch('/accessibility/predict-sign', { method: 'POST', body: form })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(err || `Sign detection failed (${res.status})`)
    }
    return res.json()
  }

  const predictMathExpression = async (
    image: Blob,
    symbolImages: Blob[],
  ): Promise<{ expression: string; symbols: MathSymbolResult[]; result?: string | null }> => {
    const form = new FormData()
    form.append('file', image, 'expression.png')
    for (let i = 0; i < symbolImages.length; i++) {
      form.append('symbols', symbolImages[i], `sym${i}.png`)
    }
    const res = await apiFetch('/math/recognize-expression', { method: 'POST', body: form })
    if (!res.ok) {
      const err = await res.text().catch(() => '')
      throw new Error(err || `Math recognition failed (${res.status})`)
    }
    return res.json() as Promise<{ expression: string; symbols: MathSymbolResult[]; result?: string | null }>
  }

  const handleRecognizeMath = async () => {
    const editor = editorRef.current
    if (!editor || mathRecognizing) return
    setMathRecognizing(true)
    try {
      const outcome = await recognizeDrawnMath(editor, predictMathExpression)
      if (!outcome) return
      const answer = formatMathAnswer(outcome.result)
      const editor2 = editorRef.current
      if (!editor2) return
      const origin = getMathAnswerOrigin(editor, outcome.shapeIds) ?? getNextDiagramOrigin(editor2)
      const id = createShapeId()
      const ink = mathAnswerColor(isDarkUi)
      editor2.createShapes([
        {
          id,
          type: 'text',
          x: origin.x,
          y: origin.y,
          props: {
            richText: toRichText(answer ?? "Couldn't read — write larger, one symbol at a time"),
            size: answer ? 'xl' : 'm',
            color: answer ? ink : 'red',
          },
        },
      ])
      zoomToShapes(editor2, [id])
    } catch (err) {
      const editor2 = editorRef.current
      if (editor2) {
        const id = createShapeId()
        const origin = getNextDiagramOrigin(editor2)
        editor2.createShapes([
          {
            id,
            type: 'text',
            x: origin.x,
            y: origin.y,
            props: {
              richText: toRichText('Math error — try again'),
              size: 'm',
              color: 'red',
            },
          },
        ])
      }
      console.error('[math]', err)
    } finally {
      setMathRecognizing(false)
    }
  }

  const handleSignShortcut = (letter: string) => {
    const editor = editorRef.current
    const L = letter.toUpperCase()
    switch (L) {
      case 'F':
        void submitPrompt('Draw a flowchart on my canvas for the current topic.', {
          generateVisual: true,
          visualType: 'flowchart',
        })
        break
      case 'G':
        void submitPrompt('Draw a graph on my canvas for the current topic.', {
          generateVisual: true,
          visualType: 'graph',
        })
        break
      case 'A':
        if (editor) placeTextOnCanvas(editor, 'Signed note')
        break
      case 'C':
        if (editor) editor.deleteShapes(editor.getSelectedShapeIds())
        break
      case 'U':
        editor?.undo()
        break
      default:
        break
    }
  }

  const handlePlaceAacText = (text: string) => {
    const editor = editorRef.current
    if (!editor || !text.trim()) return
    placeTextOnCanvas(editor, text.trim(), 'xl')
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
    const projectKey = selectedProjectId ?? 'default'

    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase()
      const isPdf = file.type === 'application/pdf' || lower.endsWith('.pdf')
      const isDocx = lower.endsWith('.docx') || file.type.includes('wordprocessingml')
      const isImage = file.type.startsWith('image/')

      if (isPdf) {
        // Render pages first — visual is fully independent of backend extraction
        try {
          const pages = await renderPdfPages(file, 20)
          if (pages.length === 0) { setAiError('PDF has no renderable pages'); continue }
          const origin = getNextDiagramOrigin(editor)
          let y = origin.y
          const maxW = 760
          for (const page of pages) {
            const scale = page.w > maxW ? maxW / page.w : 1
            const assetId = AssetRecordType.createId()
            const shapeId = createShapeId()
            editor.createAssets([{
              id: assetId, type: 'image', typeName: 'asset',
              props: {
                name: `${file.name} — p${page.pageNum}`,
                src: page.dataUrl, w: page.w, h: page.h,
                mimeType: 'image/jpeg', isAnimated: false,
              },
              meta: {},
            }])
            editor.createShapes([{
              id: shapeId, type: 'image', x: origin.x, y,
              meta: { scPdfPage: true, scFilename: file.name, scPage: page.pageNum },
              props: { assetId, w: page.w * scale, h: page.h * scale },
            }])
            y += page.h * scale + 20
          }
          editor.zoomToFit()
          setAiError('')
        } catch (err) {
          setAiError(err instanceof Error ? err.message : 'PDF rendering failed')
          continue
        }
        // Fire-and-forget background text extraction for AI context
        const fd = new FormData()
        fd.append('file', file)
        apiFetch('/ai/extract', { method: 'POST', body: fd })
          .then(async (res) => {
            if (!res.ok) return
            const data = await res.json() as { text: string; filename: string }
            if (data.text?.trim()) {
              const existing = projectDocumentsRef.current.get(projectKey) ?? []
              projectDocumentsRef.current.set(projectKey, [
                ...existing,
                { filename: data.filename || file.name, text: data.text },
              ])
            }
          })
          .catch(() => {/* visual already placed — silence extraction errors */})
        continue
      }

      if (isDocx) {
        const fd = new FormData()
        fd.append('file', file)
        try {
          const res = await apiFetch('/ai/extract', { method: 'POST', body: fd })
          if (!res.ok) { setAiError('Could not read document — make sure the server is running'); continue }
          const { text, filename } = await res.json() as { text: string; filename: string }
          const name = filename || file.name
          if (text?.trim()) {
            const existing = projectDocumentsRef.current.get(projectKey) ?? []
            projectDocumentsRef.current.set(projectKey, [...existing, { filename: name, text }])
            // Place an editable text card on the canvas
            const origin = getNextDiagramOrigin(editor)
            const shapeId = createShapeId()
            const wordCount = text.split(/\s+/).filter(Boolean).length
            const preview = text.length > 1200 ? text.slice(0, 1200) + '\n\n…' : text
            editor.createShapes([{
              id: shapeId, type: 'note',
              x: origin.x, y: origin.y,
              props: {
                richText: toRichText(`📄 ${name}  ·  ${wordCount} words\n${'─'.repeat(28)}\n${preview}`),
                color: 'light-blue', size: 's', font: 'mono',
              },
            }])
            editor.zoomToFit()
          }
          setAiError('')
        } catch (err) {
          setAiError(err instanceof Error ? err.message : 'Document extraction failed')
        }
        continue
      }

      if (isImage) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('Failed to read image'))
          reader.readAsDataURL(file)
        })
        const img = new Image()
        img.src = dataUrl
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('Invalid image file'))
        })
        const origin = getNextDiagramOrigin(editor)
        const assetId = AssetRecordType.createId()
        const shapeId = createShapeId()
        const maxW = 600
        const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1
        editor.createAssets([{
          id: assetId, type: 'image', typeName: 'asset',
          props: { name: file.name, src: dataUrl, w: img.naturalWidth, h: img.naturalHeight, mimeType: file.type, isAnimated: false },
          meta: {},
        }])
        editor.createShapes([{
          id: shapeId, type: 'image', x: origin.x, y: origin.y,
          meta: { scFilename: file.name },
          props: { assetId, w: img.naturalWidth * scale, h: img.naturalHeight * scale },
        }])
      }
    }
    editor.zoomToFit()
  }, [selectedProjectId])

  const onCanvasDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setIsDraggingFile(false)
    if (e.dataTransfer.files.length > 0) void handleFileUpload(e.dataTransfer.files)
  }, [handleFileUpload])
  const onCanvasDragOver = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setIsDraggingFile(true) }, [])
  const onCanvasDragLeave = useCallback(() => setIsDraggingFile(false), [])

  const startAiDrag = useCallback((e: React.MouseEvent) => {
    if (!aiFloat) return
    e.preventDefault()
    aiDragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: aiPos.x, startPosY: aiPos.y }
    const onMove = (ev: MouseEvent) => {
      if (!aiDragRef.current) return
      setAiPos({
        x: Math.max(0, aiDragRef.current.startPosX + ev.clientX - aiDragRef.current.startX),
        y: Math.max(0, aiDragRef.current.startPosY + ev.clientY - aiDragRef.current.startY),
      })
    }
    const onUp = () => { aiDragRef.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [aiFloat, aiPos])

  /* ====== LANDING (scrollable: hero → features → auth) ====== */
  if (!user && screen === 'landing') {
    return (
      <div className="landing-scroll">

        {/* ===== DECORATIVE LAYER — floating STEM chips in the viewport margins (wide screens only) ===== */}
        <div className="l-decor-layer" aria-hidden>
          {/* Page 1 — left margin */}
          <span className="l-stem-chip-float l-chip-purple" style={{ top: '22vh', left: '1.8%', '--chip-dur': '7s',   '--chip-delay': '0s'    } as CSSProperties}>E = mc²</span>
          <span className="l-stem-chip-float l-chip-muted"  style={{ top: '52vh', left: '1.2%', '--chip-dur': '9.5s', '--chip-delay': '-2.5s' } as CSSProperties}>∫ f(x) dx</span>
          <span className="l-stem-chip-float l-chip-amber"  style={{ top: '76vh', left: '2%',   '--chip-dur': '8s',   '--chip-delay': '-5s'   } as CSSProperties}>∇²φ = 0</span>
          {/* Page 1 — right margin */}
          <span className="l-stem-chip-float l-chip-coral"  style={{ top: '28vh', right: '1.5%', '--chip-dur': '8.5s', '--chip-delay': '-1.5s' } as CSSProperties}>F = ma</span>
          <span className="l-stem-chip-float l-chip-amber"  style={{ top: '58vh', right: '1.8%', '--chip-dur': '7.5s', '--chip-delay': '-3s'   } as CSSProperties}>y = mx + b</span>
          <span className="l-stem-chip-float l-chip-muted"  style={{ top: '82vh', right: '1.2%', '--chip-dur': '10s',  '--chip-delay': '-6s'   } as CSSProperties}>Σ aₙ</span>
          {/* Page 2 */}
          <span className="l-stem-chip-float l-chip-amber"  style={{ top: '125vh', left: '1.8%',  '--chip-dur': '9s',   '--chip-delay': '-2s'   } as CSSProperties}>PV = nRT</span>
          <span className="l-stem-chip-float l-chip-purple" style={{ top: '165vh', left: '1.2%',  '--chip-dur': '7.5s', '--chip-delay': '-4.5s' } as CSSProperties}>λ = h / p</span>
          <span className="l-stem-chip-float l-chip-muted"  style={{ top: '132vh', right: '1.5%', '--chip-dur': '8.5s', '--chip-delay': '-3.5s' } as CSSProperties}>det(M) ≠ 0</span>
          <span className="l-stem-chip-float l-chip-coral"  style={{ top: '170vh', right: '1.8%', '--chip-dur': '10s',  '--chip-delay': '-1s'   } as CSSProperties}>Δx · Δp ≥ ℏ</span>
          {/* Page 3 */}
          <span className="l-stem-chip-float l-chip-purple" style={{ top: '226vh', left: '1.5%',  '--chip-dur': '8s',   '--chip-delay': '-4s'   } as CSSProperties}>Ax = λx</span>
          <span className="l-stem-chip-float l-chip-muted"  style={{ top: '236vh', right: '1.8%', '--chip-dur': '7s',   '--chip-delay': '-1.5s' } as CSSProperties}>O(n log n)</span>
          <span className="l-stem-chip-float l-chip-coral"  style={{ top: '268vh', right: '1.2%', '--chip-dur': '8.5s', '--chip-delay': '-3s'   } as CSSProperties}>6.022 × 10²³</span>
          <span className="l-stem-chip-float l-chip-amber"  style={{ top: '274vh', left: '2%',    '--chip-dur': '9.5s', '--chip-delay': '-2s'   } as CSSProperties}>πr²</span>

          {/* Sparkle accents at page corners */}
          <div className="l-decor-sparkle" style={{ top: '10vh',  left:  '5%', color: 'rgba(168,85,247,0.45)', '--sp-dur': '6s',  '--sp-delay': '0s'    } as CSSProperties}><Sparkle size={14} /></div>
          <div className="l-decor-sparkle" style={{ top: '10vh',  right: '5%', color: 'rgba(251,91,60,0.4)',   '--sp-dur': '7s',  '--sp-delay': '-2s'   } as CSSProperties}><Sparkle size={12} /></div>
          <div className="l-decor-sparkle" style={{ top: '88vh',  left:  '6%', color: 'rgba(251,191,36,0.4)',  '--sp-dur': '5.5s','--sp-delay': '-1s'   } as CSSProperties}><Sparkle size={10} /></div>
          <div className="l-decor-sparkle" style={{ top: '88vh',  right: '6%', color: 'rgba(168,85,247,0.4)',  '--sp-dur': '8s',  '--sp-delay': '-3s'   } as CSSProperties}><Sparkle size={14} /></div>
          <div className="l-decor-sparkle" style={{ top: '108vh', left:  '5%', color: 'rgba(251,91,60,0.4)',   '--sp-dur': '6.5s','--sp-delay': '-4s'   } as CSSProperties}><Sparkle size={12} /></div>
          <div className="l-decor-sparkle" style={{ top: '188vh', right: '5%', color: 'rgba(251,191,36,0.45)', '--sp-dur': '7.5s','--sp-delay': '-2.5s' } as CSSProperties}><Sparkle size={16} /></div>
          <div className="l-decor-sparkle" style={{ top: '210vh', right: '6%', color: 'rgba(168,85,247,0.4)',  '--sp-dur': '5s',  '--sp-delay': '-1.5s' } as CSSProperties}><Sparkle size={11} /></div>
          <div className="l-decor-sparkle" style={{ top: '290vh', left:  '5%', color: 'rgba(251,91,60,0.4)',   '--sp-dur': '7s',  '--sp-delay': '-0.5s' } as CSSProperties}><Sparkle size={13} /></div>
        </div>

        {/* --- NAV --- */}
        <nav className="l-nav">
          <div className="l-nav-brand">
            <SproutLogo className="l-nav-logo" />
            <span>StudyCanvas</span>
          </div>
          <div className="l-nav-links">
            <button className="l-nav-link" onClick={scrollToFeatures}>Features</button>
            <button className="l-nav-link l-nav-link-accent" onClick={scrollToAsl}>Accessibility & ML</button>
            <button className="l-nav-ghost" onClick={scrollToAuth}>Sign In</button>
            <button className="l-nav-cta" onClick={scrollToAuth}>Get Started</button>
          </div>
        </nav>

        {/* ===== PAGE 1: Hero + 6 features — all visible, no scroll ===== */}
        <section className="l-page l-page-1" ref={featuresSectionRef}>
          <div className="l-page-1-hero">
            <span className="l-badge">AI Study Workspace</span>
            <h1>Learn smarter. <span className="l-gradient-text">Think visually.</span></h1>
            <p className="l-hero-sub l-hero-sub-compact">
              Infinite canvas, AI copilot, voice &amp; STEM visuals — one workspace.
            </p>
            <div className="l-hero-btns l-hero-btns-center l-hero-btns-compact">
              <button className="l-btn-primary l-btn-sm" onClick={scrollToAuth}>Start Free</button>
              <button className="l-btn-outline l-btn-sm" onClick={scrollToAsl}>Why StudyCanvas</button>
            </div>
          </div>
          <div className="l-feat-panel">
            {MAIN_FEATURES.map((f) => (
              <div key={f.title} className="l-feat-cell">
                <div className="l-feat-cell-head">
                  <span className="l-feat-cell-icon">{f.icon}</span>
                  <strong>{f.title}</strong>
                  <span className="l-feat-cell-tag">{f.tag}</span>
                </div>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ===== PAGE 2: Accessibility + ML — minimal sell ===== */}
        <section className="l-page l-page-2" ref={aslSectionRef}>
          <div className="l-page-2-sell">
            <div className="l-page-2-head">
              <span className="l-badge l-badge-accent">Accessibility & ML</span>
              <h2>Built for every learner. <span className="l-gradient-text">Powered by our own models.</span></h2>
              <p className="l-page-2-tagline">Deaf, hard-of-hearing, and motor-accessible — not an afterthought. Real ML, not just a chatbot wrapper.</p>
            </div>
            <div className="l-page-2-grid">
              <div className="l-sell-col">
                <h3>Study your way</h3>
                {SELL_ACCESS.map((s) => (
                  <div key={s.title} className="l-sell-item">
                    <span className="l-sell-icon">{s.icon}</span>
                    <div>
                      <strong>{s.title}</strong>
                      <p>{s.hook}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="l-sell-col l-sell-col-ml">
                <h3>We trained it</h3>
                <p className="l-sell-ml-hook">Custom intent classifier + ASL recognizer. Our models decide <em>what</em> to draw — the LLM fills in the rest.</p>
                <div className="l-sell-stats">
                  {SELL_ML.map((s) => (
                    <div key={s.label} className="l-sell-stat">
                      <span className="l-sell-stat-value">{s.value}</span>
                      <span className="l-sell-stat-label">{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ===== PAGE 3: 3 steps ∥ Sign in ===== */}
        <section className="l-page l-page-3" ref={authSectionRef}>
          <div className="l-page-3-split">
            <div className="l-page-3-steps">
              <span className="l-badge">How It Works</span>
              <h2>Three steps to visual learning</h2>
              <div className="l-timeline">
                <div className="l-timeline-item">
                  <div className="l-step-num">1</div>
                  <div>
                    <h3>Open your canvas</h3>
                    <p>Create a subject workspace — Physics, Organic Chemistry, Linear Algebra. Draw, type equations, or upload lecture PDFs.</p>
                  </div>
                </div>
                <div className="l-timeline-item">
                  <div className="l-step-num">2</div>
                  <div>
                    <h3>Ask the AI — text, voice, or sign</h3>
                    <p>Type, speak, or fingerspell your question. Our trained intent model routes your prompt to the right visual type instantly.</p>
                  </div>
                </div>
                <div className="l-timeline-item">
                  <div className="l-step-num">3</div>
                  <div>
                    <h3>Learn visually on one surface</h3>
                    <p>AI draws flowcharts, labeled diagrams, and math graphs on your canvas. Review and improve graphs with the STEM Visualization Assistant.</p>
                  </div>
                </div>
              </div>
              <SproutDecor className="l-page-3-art" />
            </div>
            <div className="l-page-3-auth">
              <form className="l-auth-card" onSubmit={(e) => void handleAuth(e)}>
                <SproutSmall className="l-auth-art-inline" />
                <h3>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h3>
                <p className="l-auth-sub">{authMode === 'login' ? 'Sign in to your workspace' : 'Start your learning journey — free, no credit card'}</p>
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

  /* ====== DASHBOARD — sidebar + card grid ====== */
  if (screen === 'workspace' && !selectedProject) {
    return (
      <div className="dash">
        <aside className="dash-side">
          <div className="dash-side-brand">
            <SproutLogo className="dash-side-logo" />
            <span>StudyCanvas</span>
          </div>
          <nav className="dash-side-nav">
            <div className="dash-side-label">Subjects</div>
            <button className={`dash-side-item ${!activeGroup ? 'dash-side-active' : ''}`} onClick={() => setActiveGroup(null)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 2h5v5H2V2zm7 0h5v5H9V2zM2 9h5v5H2V9zm7 0h5v5H9V9z" stroke="currentColor" strokeWidth="1.3"/></svg>
              All Canvases
              <span className="dash-side-count">{projects.length}</span>
            </button>
            {groups.map((g) => (
              <button key={g} className={`dash-side-item ${activeGroup === g ? 'dash-side-active' : ''}`} onClick={() => setActiveGroup(g)}>
                <span className="dash-side-dot" />
                {g}
                <span className="dash-side-count">{projects.filter((p) => p.group === g).length}</span>
              </button>
            ))}
          </nav>
          <div className="dash-side-foot">
            <div className="dash-side-user">
              <span className="dash-side-avatar">{(userName || 'U').charAt(0).toUpperCase()}</span>
              <span className="dash-side-name">{userName || 'Account'}</span>
            </div>
            <button className="dash-side-logout" onClick={logOut} title="Log out">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 2H3v12h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </aside>

        <main className="dash-main">
          <div className="dash-top">
            <div className="dash-top-text">
              <h1>{activeGroup ?? 'My Canvases'}</h1>
              <p>{userName ? `Welcome back, ${userName}` : 'Pick up where you left off'}</p>
            </div>
            <div className="dash-top-actions">
              <div className="dash-search">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4"/><path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                <input placeholder="Search canvases..." value={dashSearch} onChange={(e) => setDashSearch(e.target.value)} />
              </div>
              <button className="dash-new-btn" onClick={openNewCanvas}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
                New Canvas
              </button>
            </div>
          </div>

          <div className="dash-grid">
            <button className="dash-new-card" onClick={openNewCanvas}>
              <span className="dash-plus">+</span>
              <span>New Canvas</span>
            </button>

            {filteredProjects.map((project) => (
              <button key={project.id} className="dash-card"
                onClick={() => { setSelectedProjectId(project.id); setScreen('workspace') }}>
                <div className="dash-card-preview">
                  <span className="dash-card-mono">{project.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="dash-card-info">
                  <span className="dash-card-tag">{project.group}</span>
                  <h3>{project.name}</h3>
                  <p>{formatCanvasDate(project.updatedAt)}</p>
                </div>
              </button>
            ))}

            {filteredProjects.length === 0 && (
              <div className="dash-empty">
                <SproutHero className="dash-empty-sprout" />
                <p>{dashSearch.trim() ? `No canvases match "${dashSearch}".` : activeGroup ? `No canvases in "${activeGroup}".` : 'No canvases yet — create your first one!'}</p>
                <button className="dash-new-btn" onClick={openNewCanvas}>Create Canvas</button>
              </div>
            )}
          </div>
        </main>

        {newCanvasOpen && (
          <div className="nc-backdrop" onClick={closeNewCanvas}>
            <div className="nc-modal" onClick={(e) => e.stopPropagation()}>
              <button className="nc-close" onClick={closeNewCanvas} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
              </button>
              <div className="nc-icon"><SproutSmall /></div>
              <h3 className="nc-title">New Canvas</h3>
              <p className="nc-sub">Give your canvas a name and a subject group.</p>
              <label className="nc-label" htmlFor="nc-name">Canvas name</label>
              <input id="nc-name" className="nc-input" autoFocus placeholder="e.g. Thermodynamics Notes"
                value={newCanvasName} onChange={(e) => { setNewCanvasName(e.target.value); setNewCanvasError('') }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitNewCanvas() } }} />
              <label className="nc-label" htmlFor="nc-group">Group</label>
              <input id="nc-group" className="nc-input" placeholder="e.g. Physics, Chemistry, Math"
                value={newCanvasGroup} onChange={(e) => setNewCanvasGroup(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitNewCanvas() } }} />
              {newCanvasError && <p className="nc-error">{newCanvasError}</p>}
              <div className="nc-actions">
                <button className="nc-btn-secondary" onClick={closeNewCanvas}>Cancel</button>
                <button className="nc-btn-primary" onClick={() => void submitNewCanvas()}>Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ====== WORKSPACE ====== */
  const isDark = isDarkUi

  return (
    <div className={`ws-shell ws-layout ${isDark ? 'ws-dark' : 'ws-light'} ${chatOpen && !aiFloat ? 'ws-chat-open' : ''}`}>
      {/* Full-width top toolbar */}
      <header className="ws-toolbar">
        <div className="ws-toolbar-left">
          <button className="ws-back" onClick={() => setSelectedProjectId(null)} title="Back to canvases">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <SproutLogo className="ws-topbar-logo" />
          <div className="ws-proj-crumb">
            {selectedProject?.group && <span className="ws-proj-group">{selectedProject.group}</span>}
            {selectedProject?.group && <span className="ws-proj-sep">›</span>}
            <span className="ws-proj-name">{selectedProject?.name ?? 'Canvas'}</span>
          </div>
        </div>
        <div className="ws-toolbar-right">
          <button className={`ws-toolbar-ai ${chatOpen ? 'ws-toolbar-ai-active' : ''}`} onClick={() => setChatOpen(!chatOpen)} title="AI Copilot">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.5 3.53 1.36 5L2 22l5-1.36A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="1.6"/></svg>
            <span>AI Copilot</span>
          </button>
          <button className="ws-toolbar-logout" onClick={logOut} title="Log out">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M6 2H3v12h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </header>

      {/* Left vertical tool rail */}
      <aside className="ws-rail">
        <button className="ws-rail-btn" onClick={() => setWsTheme(isDark ? 'light' : 'dark')} title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
          {isDark ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3a6 6 0 009 5.2A9 9 0 1112 3z" stroke="currentColor" strokeWidth="1.5" fill="rgba(255,200,50,0.15)"/></svg>
          )}
          <span className="ws-rail-label">{isDark ? 'Light' : 'Dark'}</span>
        </button>

        <div className="ws-rail-divider" />

        <button className="ws-rail-btn" onClick={() => fileInputRef.current?.click()} title="Upload PDF, image, or Word doc">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 13V5m0 0L5 8m3-3l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 13h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          <span className="ws-rail-label">Upload</span>
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,.pdf,.docx,application/pdf" multiple hidden
          onChange={(e) => { if (e.target.files) void handleFileUpload(e.target.files) }} />

        <button className={`ws-rail-btn ${isListening ? 'ws-rail-active' : ''}`} onClick={toggleVoiceMode} disabled={!voiceSupported} title="Voice input">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1a2 2 0 012 2v4a2 2 0 01-4 0V3a2 2 0 012-2z" stroke="currentColor" strokeWidth="1.3"/><path d="M4 7a4 4 0 008 0M8 13v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
          <span className="ws-rail-label">Voice</span>
        </button>

        <button className={`ws-rail-btn ${signOpen ? 'ws-rail-active' : ''}`} onClick={() => setSignOpen(!signOpen)} title="Sign language accessibility">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 3c0-1 2-2 4-2s4 1 4 2v2H4V3z" stroke="currentColor" strokeWidth="1.2"/><path d="M3 5h10v2c0 3-2 6-5 6S3 10 3 7V5z" stroke="currentColor" strokeWidth="1.2"/></svg>
          <span className="ws-rail-label">Sign</span>
        </button>

        <button
          className={`ws-rail-btn ${mathRecognizing ? 'ws-rail-active ws-rail-busy' : ''}`}
          onClick={() => void handleRecognizeMath()}
          disabled={mathRecognizing}
          title="Recognize handwritten math"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13l3-8 2 4 2-3 3 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          <span className="ws-rail-label">{mathRecognizing ? '…' : 'Math'}</span>
        </button>

        <div className="ws-rail-divider" />

        <button className="ws-rail-btn" onClick={() => canvasEditor?.undo()} title="Undo (Ctrl+Z)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 6h7a3.5 3.5 0 110 7H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M3 6l2.5-2.5M3 6l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="ws-rail-label">Undo</span>
        </button>

        <button className="ws-rail-btn" onClick={() => canvasEditor?.redo()} title="Redo (Ctrl+Y)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 6H6a3.5 3.5 0 100 7h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M13 6l-2.5-2.5M13 6l-2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
          <span className="ws-rail-label">Redo</span>
        </button>

        <div className="ws-rail-divider" />

        <div className="ws-rail-table"><TablePicker editor={canvasEditor} isDark={isDark} /></div>
        <button className={`ws-rail-btn ${stylesOpen ? 'ws-rail-active' : ''}`} onClick={() => setStylesOpen(!stylesOpen)} title="Shape styles panel">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="2" fill="currentColor"/><circle cx="12" cy="4" r="2" fill="currentColor"/><circle cx="4" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>
          <span className="ws-rail-label">Styles</span>
        </button>

        <div className="ws-rail-spacer" />
        <PlantTimer isDark={isDark} projectId={selectedProjectId} />
      </aside>

      <section className={`canvas-wrap ${isDark ? 'canvas-dark' : 'canvas-light'} ${isDraggingFile ? 'canvas-wrap-dropping' : ''} ${stylesOpen ? 'styles-open' : ''}`}
        style={{
          '--board-color': activeTheme.board,
          '--grid-major': activeTheme.grid,
          '--grid-minor': activeTheme.gridMinor,
        } as CSSProperties}
        onDrop={onCanvasDrop} onDragOver={onCanvasDragOver} onDragLeave={onCanvasDragLeave}>
        {isDraggingFile && <div className="drop-overlay"><span>Drop file here</span></div>}
        <Tldraw
          persistenceKey={`board_${selectedProject?.id ?? 'default'}`}
          onMount={onMount}
          components={STUDY_CANVAS_COMPONENTS}
          shapeUtils={STUDY_CANVAS_SHAPE_UTILS}
          tools={STUDY_CANVAS_TOOLS}
          overrides={STUDY_CANVAS_OVERRIDES}
        />

        <aside
          className={`ai-panel ${chatOpen ? 'ai-panel-open' : ''} ${aiFloat ? 'ai-panel-float' : ''}`}
          style={aiFloat ? { left: aiPos.x, top: aiPos.y } as CSSProperties : undefined}
        >
          <div
            className="ai-popup-header"
            onMouseDown={startAiDrag}
            style={aiFloat ? { cursor: 'grab' } : undefined}
          >
            <span className="ai-popup-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.7 }}><path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.5 3.53 1.36 5L2 22l5-1.36A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="1.6"/></svg>
              AI Copilot
            </span>
            <div className="ai-popup-actions">
              <label className="ai-popup-auto">
                <input type="checkbox" checked={autoSendVoice} onChange={(e) => setAutoSendVoice(e.target.checked)} />
                Auto-send
              </label>
              <button
                className="ai-popup-action-btn"
                onClick={() => { setAiFloat(!aiFloat); if (!aiFloat) setAiPos({ x: 60, y: 60 }) }}
                title={aiFloat ? 'Dock to side' : 'Float as window'}
              >
                {aiFloat
                  ? <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 4v9h12V4M6 1h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4"/><path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
                }
              </button>
              <button className="ai-popup-action-btn" onClick={() => setChatOpen(false)}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
          </div>
          <div className="ai-popup-messages" ref={chatScrollRef}>
            {chatHistory.length === 0 && (
              <div className="ai-popup-empty">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 10px', display: 'block', opacity: 0.5 }}>
                  <path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.5 3.53 1.36 5L2 22l5-1.36A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M8 10.5h.01M12 10.5h.01M16 10.5h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Ask anything — the AI explains first, then you can add a flowchart, labeled diagram, or math graph directly to your canvas.
              </div>
            )}
            {chatHistory.map((entry, idx) => (
              <div key={`${entry.role}_${idx}`} className={`ai-msg ai-msg-${entry.role}`}>
                {entry.role === 'assistant' ? <RichMessage text={entry.content} /> : entry.content}
              </div>
            ))}
            {visualOffer && !aiLoading && (
              <div className="ai-visual-offer">
                <span>Add a visual to your canvas?</span>
                <div className="ai-visual-offer-btns">
                  <button type="button" onClick={() => requestVisual('flowchart')}>Flowchart</button>
                  <button type="button" onClick={() => requestVisual('labeled_diagram')}>Labeled diagram</button>
                  <button type="button" onClick={() => requestVisual('graph')}>Math graph</button>
                </div>
              </div>
            )}
            {aiLoading && <div className="ai-msg ai-msg-assistant ai-msg-loading">Thinking...</div>}
            {aiError && <p className="ai-popup-error">{aiError}</p>}
          </div>
          {intentInfo && (
            <div
              className="ai-intent-badge"
              title={
                intentInfo.backend === 'distilbert'
                  ? 'Predicted by fine-tuned DistilBERT (49-class STEM intent model)'
                  : 'Predicted by TF-IDF intent classifier (49-class STEM taxonomy)'
              }
            >
              <span className="ai-intent-dot" />
              {intentInfo.backend === 'distilbert' ? 'DistilBERT' : 'Intent'}:{' '}
              <strong>{intentInfo.intent.replace(/_/g, ' ').toLowerCase()}</strong>
              <span className="ai-intent-conf">{Math.round(intentInfo.confidence * 100)}%</span>
            </div>
          )}
          <div className="ai-popup-input">
            <input placeholder="Ask anything..."
              value={chatInput} onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submitPrompt() } }} />
            <button className="ai-popup-send" onClick={() => void submitPrompt()} disabled={aiLoading}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8l12-6-4 6 4 6L2 8z" fill="currentColor"/></svg>
            </button>
          </div>
        </aside>
      </section>

      <SignAccessibilityPanel
        open={signOpen}
        onClose={() => setSignOpen(false)}
        isDark={isDark}
        mode={signMode}
        onModeChange={setSignMode}
        predictSign={predictSign}
        onShortcut={handleSignShortcut}
        onPlaceAacText={handlePlaceAacText}
      />
    </div>
  )
}
