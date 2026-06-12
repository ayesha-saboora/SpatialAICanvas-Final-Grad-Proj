import { useEffect, useRef, useState } from 'react'

type TimerMode = 'stopwatch' | 'countdown'

type Props = {
  isDark: boolean
  projectId: string | null
}

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function FocusRingIcon({ running, progress }: { running: boolean; progress: number }) {
  const r = 14
  const circ = 2 * Math.PI * r
  const dash = circ * Math.min(Math.max(progress, 0), 1)
  return (
    <svg className={`focus-timer-icon ${running ? 'focus-timer-icon-running' : ''}`} viewBox="0 0 48 48" fill="none">
      <defs>
        <linearGradient id="focus-ring" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="50%" stopColor="#fb5b3c" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r={r} stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
      <circle
        cx="24" cy="24" r={r}
        stroke="url(#focus-ring)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform="rotate(-90 24 24)"
      />
      <text x="24" y="28" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700" fontFamily="Inter, sans-serif">
        {running ? '▶' : '⏱'}
      </text>
    </svg>
  )
}

export function PlantTimer({ isDark, projectId }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<TimerMode>('stopwatch')
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [countdownMins, setCountdownMins] = useState('25')
  const [countdownLeft, setCountdownLeft] = useState(25 * 60)
  const [totalStudied, setTotalStudied] = useState(0)
  const tickRef = useRef<number | null>(null)

  const storageKey = `sc_study_${projectId ?? 'default'}`

  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      const n = parseInt(saved, 10)
      if (Number.isFinite(n) && n >= 0) setTotalStudied(n)
    }
  }, [storageKey])

  useEffect(() => {
    if (!running) {
      if (tickRef.current) window.clearInterval(tickRef.current)
      tickRef.current = null
      return
    }
    tickRef.current = window.setInterval(() => {
      if (mode === 'stopwatch') {
        setElapsed((e) => e + 1)
        setTotalStudied((t) => {
          const next = t + 1
          localStorage.setItem(storageKey, String(next))
          return next
        })
      } else {
        setCountdownLeft((left) => {
          if (left <= 1) {
            setRunning(false)
            return 0
          }
          return left - 1
        })
      }
    }, 1000)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [running, mode, storageKey])

  const display =
    mode === 'stopwatch' ? formatTime(elapsed) : formatTime(countdownLeft)

  const targetSecs = Math.max(1, parseInt(countdownMins, 10) || 25) * 60
  const progress =
    mode === 'countdown' && targetSecs > 0
      ? 1 - countdownLeft / targetSecs
      : Math.min(elapsed / (45 * 60), 1)

  const start = () => {
    if (mode === 'countdown') {
      const secs = Math.max(1, parseInt(countdownMins, 10) || 25) * 60
      if (!running && countdownLeft <= 0) setCountdownLeft(secs)
    }
    setRunning(true)
  }

  const reset = () => {
    setRunning(false)
    setElapsed(0)
    if (mode === 'countdown') {
      setCountdownLeft(Math.max(1, parseInt(countdownMins, 10) || 25) * 60)
    }
  }

  const switchMode = (m: TimerMode) => {
    setRunning(false)
    setMode(m)
    setElapsed(0)
    if (m === 'countdown') {
      setCountdownLeft(Math.max(1, parseInt(countdownMins, 10) || 25) * 60)
    }
  }

  return (
    <div className={`focus-timer ${isDark ? 'focus-timer-dark' : ''}`}>
      <button
        type="button"
        className={`focus-timer-fab ${running ? 'focus-timer-fab-active' : ''} ${open ? 'focus-timer-fab-open' : ''}`}
        onClick={() => setOpen(!open)}
        title="Focus timer"
        aria-label="Focus timer"
      >
        <FocusRingIcon running={running} progress={progress} />
        {running && <span className="focus-timer-badge">{display}</span>}
      </button>

      {open && (
        <div className="focus-timer-panel">
          <div className="focus-timer-panel-head">
            <FocusRingIcon running={running} progress={progress} />
            <div>
              <strong>Focus Session</strong>
              <span className="focus-timer-sub">
                {mode === 'stopwatch' ? 'Tracking study time' : 'Pomodoro countdown'}
              </span>
            </div>
          </div>

          <p className="focus-timer-display">{display}</p>

          {mode === 'countdown' && !running && (
            <label className="focus-timer-mins">
              Minutes
              <input
                type="number"
                min={1}
                max={180}
                value={countdownMins}
                onChange={(e) => {
                  setCountdownMins(e.target.value)
                  const secs = Math.max(1, parseInt(e.target.value, 10) || 25) * 60
                  setCountdownLeft(secs)
                }}
              />
            </label>
          )}

          <div className="focus-timer-modes">
            <button
              type="button"
              className={mode === 'stopwatch' ? 'active' : ''}
              onClick={() => switchMode('stopwatch')}
            >
              Track
            </button>
            <button
              type="button"
              className={mode === 'countdown' ? 'active' : ''}
              onClick={() => switchMode('countdown')}
            >
              Countdown
            </button>
          </div>

          <div className="focus-timer-actions">
            {!running ? (
              <button type="button" className="focus-timer-start" onClick={start}>
                Start
              </button>
            ) : (
              <button type="button" className="focus-timer-pause" onClick={() => setRunning(false)}>
                Pause
              </button>
            )}
            <button type="button" className="focus-timer-reset" onClick={reset}>
              Reset
            </button>
          </div>

          {mode === 'stopwatch' && (
            <p className="focus-timer-total">Total studied: {formatTime(totalStudied)}</p>
          )}
        </div>
      )}
    </div>
  )
}
