import { useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { Tldraw, createShapeId, toRichText, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'

type AuthMode = 'login' | 'signup'

type Account = {
  name: string
  email: string
  password: string
}

type Project = {
  id: string
  name: string
  updatedAt: string
}

type BoardTheme = {
  id: string
  label: string
  board: string
  grid: string
}

type ExplainResponse = {
  explanation: string
  visual_steps: string[]
}

type ChatRole = 'user' | 'assistant'

type ChatMessage = {
  role: ChatRole
  content: string
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

interface SpeechRecognition {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognition
type WindowWithSpeech = Window &
  typeof globalThis & {
    webkitSpeechRecognition?: SpeechRecognitionConstructor
    SpeechRecognition?: SpeechRecognitionConstructor
  }

const ACCOUNTS_KEY = 'studycanvas_accounts'
const SESSION_KEY = 'studycanvas_session'
const PROJECTS_KEY = 'studycanvas_projects'
const API_BASE_URL = 'http://127.0.0.1:8010'

const boardThemes: BoardTheme[] = [
  { id: 'beige', label: 'Beige', board: '#f7f0e2', grid: '#dfd1bb' },
  { id: 'cream', label: 'Cream', board: '#f8f5ed', grid: '#d8d2c4' },
  { id: 'sage', label: 'Sage', board: '#edf2e8', grid: '#cad6c0' },
  { id: 'sky', label: 'Sky', board: '#edf4ff', grid: '#c7d9f7' },
]

function readStorage<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'auth' | 'workspace'>('landing')
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [themeId, setThemeId] = useState('beige')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([])
  const [isListening, setIsListening] = useState(false)
  const [autoSendVoice, setAutoSendVoice] = useState(true)

  const editorRef = useRef<Editor | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  const currentUser = useMemo(() => localStorage.getItem(SESSION_KEY), [])
  const [sessionEmail, setSessionEmail] = useState(currentUser)

  const projects = useMemo(() => {
    if (!sessionEmail) return []
    const allProjects = readStorage<Record<string, Project[]>>(PROJECTS_KEY, {})
    return allProjects[sessionEmail] ?? []
  }, [sessionEmail, selectedProjectId])

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null

  const activeTheme = boardThemes.find((theme) => theme.id === themeId) ?? boardThemes[0]
  const voiceSupported = Boolean(
    (window as WindowWithSpeech).SpeechRecognition || (window as WindowWithSpeech).webkitSpeechRecognition,
  )

  const onMount = (editor: Editor) => {
    editorRef.current = editor
    ;(editor as unknown as { updateInstanceState: (data: object) => void }).updateInstanceState({
      isGridMode: true,
    })
  }

  const drawVisualStepsOnCanvas = (steps: string[]) => {
    const editor = editorRef.current
    if (!editor || steps.length === 0) return

    const baseX = 160
    const baseY = 140
    const gapY = 130
    const width = 320
    const height = 90

    const shapes = steps.slice(0, 8).map((step, index) => ({
      id: createShapeId(),
      type: 'geo',
      x: baseX,
      y: baseY + index * gapY,
      props: {
        geo: 'rectangle',
        w: width,
        h: height,
        richText: toRichText(`${index + 1}. ${step}`),
        color: 'black',
        size: 'm',
      },
    }))

    editor.createShapes(shapes as Parameters<typeof editor.createShapes>[0])
    editor.zoomToFit()
  }

  const createProject = () => {
    if (!sessionEmail) return
    const projectName = prompt('Project name:')
    if (!projectName) return

    const allProjects = readStorage<Record<string, Project[]>>(PROJECTS_KEY, {})
    const userProjects = allProjects[sessionEmail] ?? []
    const nextProject: Project = {
      id: `p_${Date.now()}`,
      name: projectName.trim(),
      updatedAt: new Date().toLocaleString(),
    }

    const nextProjects = [nextProject, ...userProjects]
    allProjects[sessionEmail] = nextProjects
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(allProjects))
    setSelectedProjectId(nextProject.id)
    setScreen('workspace')
  }

  const handleAuth = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const allAccounts = readStorage<Account[]>(ACCOUNTS_KEY, [])
    const safeEmail = email.trim().toLowerCase()

    if (!safeEmail || !password.trim()) {
      setMessage('Please enter email and password.')
      return
    }

    if (authMode === 'signup') {
      if (!name.trim()) {
        setMessage('Please enter your name.')
        return
      }
      const exists = allAccounts.find((account) => account.email === safeEmail)
      if (exists) {
        setMessage('Account already exists. Please log in.')
        return
      }
      allAccounts.push({ name: name.trim(), email: safeEmail, password })
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(allAccounts))
    }

    const account = allAccounts.find(
      (entry) => entry.email === safeEmail && entry.password === password,
    )
    if (!account) {
      setMessage('Invalid email or password.')
      return
    }

    localStorage.setItem(SESSION_KEY, account.email)
    setSessionEmail(account.email)
    setMessage('')
    setScreen('workspace')
  }

  const logOut = () => {
    recognitionRef.current?.stop()
    localStorage.removeItem(SESSION_KEY)
    setSessionEmail(null)
    setSelectedProjectId(null)
    setScreen('landing')
    setEmail('')
    setPassword('')
    setChatHistory([])
    setChatInput('')
    setIsListening(false)
  }

  const saveProjectAndOpen = (projectId: string) => {
    setSelectedProjectId(projectId)
    setScreen('workspace')
  }

  const submitPrompt = async (rawPrompt?: string) => {
    const prompt = (rawPrompt ?? chatInput).trim()
    if (!prompt) return

    setChatInput('')
    setChatHistory((prev) => [...prev, { role: 'user', content: prompt }])

    setAiLoading(true)
    setAiError('')

    try {
      const response = await fetch(`${API_BASE_URL}/ai/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: prompt,
          language: 'English',
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'AI request failed')
      }

      const data = (await response.json()) as ExplainResponse
      setChatHistory((prev) => [...prev, { role: 'assistant', content: data.explanation }])
      drawVisualStepsOnCanvas(data.visual_steps ?? [])
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unexpected error'
      setAiError(errorMessage)
    } finally {
      setAiLoading(false)
    }
  }

  const toggleVoiceMode = () => {
    if (!voiceSupported) {
      setAiError('Voice is not supported in this browser.')
      return
    }

    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }

    const Constructor =
      (window as WindowWithSpeech).SpeechRecognition ||
      (window as WindowWithSpeech).webkitSpeechRecognition
    if (!Constructor) return

    const recognition = new Constructor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      const collected: string[] = []
      for (let i = 0; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript?.trim()
        if (transcript) collected.push(transcript)
      }

      const spokenText = collected.join(' ').trim()
      if (!spokenText) return

      if (autoSendVoice) {
        void submitPrompt(spokenText)
      } else {
        setChatInput((prev) => `${prev} ${spokenText}`.trim())
      }
    }

    recognition.onerror = () => {
      setAiError('Voice input error. Please try again.')
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognition.start()
    recognitionRef.current = recognition
    setIsListening(true)
  }

  if (!sessionEmail && screen === 'landing') {
    return (
      <div className="landing-page">
        <div className="hero-card">
          <p className="kicker">AI + Canvas + Learning</p>
          <h1>Build ideas visually, not in scattered tabs.</h1>
          <p className="hero-text">
            Draw, annotate, and keep AI explanations right next to your thinking. A clean study
            workspace with project boards and interactive whiteboarding.
          </p>
          <div className="hero-actions">
            <button className="primary-btn hero-btn" onClick={() => setScreen('auth')}>
              Get Started
            </button>
            <button className="ghost-btn hero-btn" onClick={() => setScreen('auth')}>
              I Already Have an Account
            </button>
          </div>
          <div className="hero-badges">
            <span>Infinite whiteboard</span>
            <span>Color themes</span>
            <span>Project based</span>
          </div>
        </div>
      </div>
    )
  }

  if (!sessionEmail && screen === 'auth') {
    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={handleAuth}>
          <h2>{authMode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p>Start your learning projects and open your canvas workspace.</p>

          {authMode === 'signup' && (
            <input
              className="input"
              placeholder="Full name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}

          <input
            className="input"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="input"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {message && <p className="auth-error">{message}</p>}

          <button className="primary-btn auth-submit" type="submit">
            {authMode === 'login' ? 'Log In' : 'Sign Up'}
          </button>

          <button
            className="switch-link"
            type="button"
            onClick={() => {
              setAuthMode(authMode === 'login' ? 'signup' : 'login')
              setMessage('')
            }}
          >
            {authMode === 'login'
              ? 'Need an account? Create one'
              : 'Already registered? Log in instead'}
          </button>
        </form>
      </div>
    )
  }

  if (screen === 'workspace' && !selectedProject) {
    return (
      <div className="projects-page">
        <header className="projects-header">
          <div>
            <h2>Your Projects</h2>
            <p>Select a project to continue or create a new board.</p>
          </div>
          <div className="header-actions">
            <button className="ghost-btn" onClick={logOut}>
              Log Out
            </button>
            <button className="primary-btn" onClick={createProject}>
              New Project
            </button>
          </div>
        </header>

        <section className="project-grid">
          {projects.length === 0 && (
            <div className="project-empty">
              <p>No projects yet.</p>
              <button className="primary-btn" onClick={createProject}>
                Create First Project
              </button>
            </div>
          )}

          {projects.map((project) => (
            <button
              key={project.id}
              className="project-card"
              onClick={() => saveProjectAndOpen(project.id)}
            >
              <h3>{project.name}</h3>
              <p>Updated {project.updatedAt}</p>
            </button>
          ))}
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">S</div>
          <div>
            <h1>StudyCanvas</h1>
            <p>AI Learning Workspace</p>
          </div>
        </div>

        <nav className="nav-list">
          <button className="nav-item" onClick={() => setScreen('workspace')}>
            Your Projects
          </button>
          {projects.map((project) => (
            <button
              key={project.id}
              className={`nav-item ${selectedProject?.id === project.id ? 'nav-item-active' : ''}`}
              onClick={() => saveProjectAndOpen(project.id)}
            >
              {project.name}
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <p className="sidebar-card-title">Canvas Color</p>
          <div className="theme-swatches">
            {boardThemes.map((theme) => (
              <button
                key={theme.id}
                className={`swatch ${theme.id === activeTheme.id ? 'swatch-active' : ''}`}
                style={{ background: theme.board }}
                title={theme.label}
                onClick={() => setThemeId(theme.id)}
              />
            ))}
          </div>
          <p>Grid is enabled so users can sketch clean diagrams and align ideas easily.</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <h2>{selectedProject?.name ?? 'Smart Whiteboard'}</h2>
            <p>Zoom, draw, and brainstorm. Your board saves in this project flow.</p>
          </div>
          <div className="header-actions">
            <button className="ghost-btn" onClick={() => setSelectedProjectId(null)}>
              Back to Projects
            </button>
            <button className="ghost-btn" onClick={createProject}>
              New Project
            </button>
            <button className="ghost-btn" onClick={toggleVoiceMode} disabled={!voiceSupported}>
              {isListening ? 'Stop Voice' : voiceSupported ? 'Start Voice' : 'Voice Unsupported'}
            </button>
            <button className="primary-btn" onClick={logOut}>
              Log Out
            </button>
          </div>
        </header>

        <section className="ai-chat-panel">
          <div className="chat-toolbar">
            <p className="ai-response-title">AI Copilot</p>
            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={autoSendVoice}
                onChange={(event) => setAutoSendVoice(event.target.checked)}
              />
              Auto-send voice
            </label>
          </div>

          <div className="chat-scroll">
            {chatHistory.length === 0 && (
              <p className="chat-placeholder">
                Ask anything and AI will both explain and draw visual boxes on your canvas.
              </p>
            )}
            {chatHistory.map((entry, idx) => (
              <p key={`${entry.role}_${idx}`} className={`chat-bubble chat-${entry.role}`}>
                {entry.content}
              </p>
            ))}
            {aiLoading && <p className="chat-bubble chat-assistant">Thinking...</p>}
            {aiError && <p className="ai-error">{aiError}</p>}
          </div>

          <div className="chat-input-row">
            <input
              className="input chat-input"
              placeholder="Ask a concept, diagram, or step-by-step explanation..."
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submitPrompt()
                }
              }}
            />
            <button className="primary-btn" onClick={() => void submitPrompt()} disabled={aiLoading}>
              Send
            </button>
          </div>
        </section>

        <section
          className="canvas-card"
          style={
            {
              '--board-color': activeTheme.board,
              '--grid-color': activeTheme.grid,
            } as CSSProperties
          }
        >
          <Tldraw persistenceKey={`board_${selectedProject?.id ?? 'default'}`} onMount={onMount} />
        </section>
      </main>
    </div>
  )
}
