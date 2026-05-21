import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react'
import { AssetRecordType, Tldraw, createShapeId, toRichText, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { SproutLogo, SproutHero, SproutDecor, SproutSmall } from './Sprout'
import { BambooStalk } from './Panda'
import { collectSpatialContext, resolveSelectionIds, type StoredDocument } from './spatialContext'
import { renderPdfPages } from './pdfRender'
import { renderGraphToDataUrl, type GraphSpec } from './graphPlot'
import { TablePicker } from './TablePicker'
import { PlantTimer } from './PlantTimer'
import {
  CANVAS_BOARD_COLOR,
  diagramArrowColor,
  diagramEdgeLabelColor,
  diagramTitleColor,
  restoreCanvasContrastForLightBoard,
} from './canvasTheme'

type AuthMode = 'login' | 'signup'
type UserInfo = { id: string; name: string; email: string }
type Project = { id: string; name: string; group: string; updatedAt: string }
type WsTheme = 'light' | 'dark'
type DiagramNode = { id: string; label: string; row: number; col: number; shape: string; color: string }
type DiagramEdge = { from: string; to: string; label: string }
type GraphFunctionSpec = { expr: string; label: string; color: string }
type DiagramData = {
  type?: 'flowchart' | 'graph' | 'labeled_diagram'
  title: string
  nodes?: DiagramNode[]
  edges?: DiagramEdge[]
  functions?: GraphFunctionSpec[]
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
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
  light: { board: CANVAS_BOARD_COLOR, grid: '#cce0f0', margin: '#e8a0a0', text: '#1a1a1a' },
  dark: { board: CANVAS_BOARD_COLOR, grid: '#2a3a5c', margin: '#5c3a3a', text: '#d4d4e0' },
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
  const [visualOffer, setVisualOffer] = useState(false)
  const [aiError, setAiError] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [isListening, setIsListening] = useState(false)
  const [autoSendVoice, setAutoSendVoice] = useState(true)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
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
  const pendingDiagramRef = useRef<{ diagram?: DiagramData; steps?: string[] } | null>(null)
  /** Keeps last canvas selection when user clicks away into chat. */
  const pinnedSelectionRef = useRef<string[]>([])
  /** Full extracted text per project (not truncated like canvas preview). */
  const projectDocumentsRef = useRef<Map<string, StoredDocument[]>>(new Map())

  const userName = user?.name ?? ''

  const groups = useMemo(() => {
    const set = new Set(projects.map((p) => p.group).filter(Boolean))
    return Array.from(set).sort()
  }, [projects])

  const filteredProjects = activeGroup ? projects.filter((p) => p.group === activeGroup) : projects
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
    restoreCanvasContrastForLightBoard(canvasEditor)
  }, [canvasEditor])

  const scrollToAuth = () => {
    authSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const onMount = (editor: Editor) => {
    editorRef.current = editor
    setCanvasEditor(editor)
    ;(editor as unknown as { updateInstanceState: (d: object) => void }).updateInstanceState({ isGridMode: true })
    editor.store.listen(() => {
      const ids = editor.getSelectedShapeIds().map(String)
      if (ids.length > 0) {
        pinnedSelectionRef.current = resolveSelectionIds(editor, ids)
      }
    }, { source: 'user', scope: 'session' })
    restoreCanvasContrastForLightBoard(editor)
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
      functions: diagram.functions,
      xMin: diagram.xMin ?? -5,
      xMax: diagram.xMax ?? 5,
      yMin: diagram.yMin ?? -5,
      yMax: diagram.yMax ?? 5,
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
      const spatial = editorRef.current
        ? await collectSpatialContext(editorRef.current, {
            pinnedSelectionIds: pinnedSelectionRef.current,
            storedDocuments: storedDocs,
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
      const suffix = hasDiagram ? '\n\n[Visual added to canvas]' : ''
      const finalText = (finalExplanation || '').trim()
      if (finalText) {
        replaceAssistant(finalText + suffix)
      } else {
        removeAssistantPlaceholder()
      }

      setVisualOffer(shouldOfferVisual && !hasDiagram)

      if (hasDiagram && finalDiagram) {
        if (editorRef.current) drawVisualOnCanvas(finalDiagram)
        else pendingDiagramRef.current = { diagram: finalDiagram }
      }
    } catch (error) {
      removeAssistantPlaceholder()
      setAiError(error instanceof Error ? error.message : 'Unexpected error')
    } finally { setAiLoading(false) }
  }

  const requestVisual = (visualType: VisualType) => {
    const label = visualType === 'labeled_diagram' ? 'labeled diagram' : visualType
    void submitPrompt(`Draw a ${label} on my canvas for what we just discussed.`, {
      generateVisual: true,
      visualType,
    })
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

      if (isPdf || isDocx) {
        const formData = new FormData()
        formData.append('file', file)
        try {
          const res = await apiFetch('/ai/extract', { method: 'POST', body: formData })
          if (!res.ok) {
            const errText = await res.text().catch(() => 'Upload failed')
            setAiError(`Document upload failed: ${errText.slice(0, 200)}`)
            continue
          }
          const { text, filename } = await res.json() as { text: string; filename: string }
          if (text?.trim()) {
            const existing = projectDocumentsRef.current.get(projectKey) ?? []
            projectDocumentsRef.current.set(projectKey, [
              ...existing,
              { filename: filename || file.name, text },
            ])
          }
        } catch (err) {
          setAiError(err instanceof Error ? err.message : 'Document extraction failed')
          continue
        }

        if (isPdf) {
          try {
            const pages = await renderPdfPages(file, 10)
            if (pages.length === 0) {
              setAiError('PDF has no renderable pages')
              continue
            }
            const origin = getNextDiagramOrigin(editor)
            let y = origin.y
            const maxW = 720
            for (const page of pages) {
              const scale = page.w > maxW ? maxW / page.w : 1
              const assetId = AssetRecordType.createId()
              const shapeId = createShapeId()
              editor.createAssets([{
                id: assetId, type: 'image', typeName: 'asset',
                props: {
                  name: `${file.name} — page ${page.pageNum}`,
                  src: page.dataUrl,
                  w: page.w,
                  h: page.h,
                  mimeType: 'image/jpeg',
                  isAnimated: false,
                },
                meta: {},
              }])
              editor.createShapes([{
                id: shapeId,
                type: 'image',
                x: origin.x,
                y,
                meta: { scPdfPage: true, scFilename: file.name, scPage: page.pageNum },
                props: {
                  assetId,
                  w: page.w * scale,
                  h: page.h * scale,
                },
              }])
              y += page.h * scale + 48
            }
            setAiError('')
            continue
          } catch (err) {
            setAiError(err instanceof Error ? err.message : 'PDF rendering failed')
            continue
          }
        }
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
            <button className="l-btn-primary" onClick={openNewCanvas}>+ New Canvas</button>
          </div>

          <section className="dash-grid">
            <button className="dash-new-card" onClick={openNewCanvas}>
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
                <button className="l-btn-primary" onClick={openNewCanvas}>Create Canvas</button>
              </div>
            )}
          </section>
        </div>

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
            <TablePicker editor={canvasEditor} isDark={isDark} />
            <button className={`ws-btn ${stylesOpen ? 'ws-btn-active' : ''}`} onClick={() => setStylesOpen(!stylesOpen)}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="2" fill="currentColor"/><circle cx="12" cy="4" r="2" fill="currentColor"/><circle cx="4" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>
              Styles
            </button>
            <button className="ws-btn" onClick={() => fileInputRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 13h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Upload
            </button>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.docx,application/pdf" multiple hidden
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
              {chatHistory.length === 0 && <p className="ai-popup-empty">Ask anything. The AI explains first — then you can choose a flowchart, labeled diagram, or math graph.</p>}
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

        <PlantTimer isDark={isDark} projectId={selectedProjectId} />

        <button className={`ai-fab ${chatOpen ? 'ai-fab-active' : ''}`} onClick={() => setChatOpen(!chatOpen)}
          title="AI Copilot">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.82.5 3.53 1.36 5L2 22l5-1.36A9.96 9.96 0 0012 22c5.52 0 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" strokeWidth="1.5"/><path d="M8 10h.01M12 10h.01M16 10h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </main>
    </div>
  )
}
