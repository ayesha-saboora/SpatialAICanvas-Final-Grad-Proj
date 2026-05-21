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

function PlantIcon({ running, progress }: { running: boolean; progress: number }) {
  const grow = 0.85 + Math.min(progress, 1) * 0.2
  return (
    <svg className={`plant-timer-icon ${running ? 'plant-timer-icon-running' : ''}`} viewBox="0 0 48 48" fill="none">
      <ellipse cx="24" cy="42" rx="14" ry="4" fill="#16a34a" opacity="0.15" />
      <path d="M18 42V28c0-2 2-4 6-4s6 2 6 4v14" fill="#b45309" opacity="0.85" />
      <path d="M16 42h16v2H16z" fill="#92400e" rx="1" />
      <g style={{ transform: `scale(${grow})`, transformOrigin: '24px 28px' }}>
        <path d="M24 28V14" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M24 18C24 10 32 5 40 5C40 13 32 18 24 18Z"
          fill="#22c55e"
          opacity="0.9"
          className={running ? 'plant-leaf-sway' : ''}
        />
        <path
          d="M24 22C24 16 16 12 8 12C8 18 16 22 24 22Z"
          fill="#4ade80"
          opacity="0.75"
          className={running ? 'plant-leaf-sway plant-leaf-sway-delay' : ''}
        />
        <circle cx="24" cy="10" r="2.5" fill="#fbbf24" opacity={running ? 0.9 : 0.5} />
      </g>
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
    <div className={`plant-timer ${isDark ? 'plant-timer-dark' : ''}`}>
      <button
        type="button"
        className={`plant-timer-fab ${running ? 'plant-timer-fab-active' : ''} ${open ? 'plant-timer-fab-open' : ''}`}
        onClick={() => setOpen(!open)}
        title="Study timer"
        aria-label="Study timer"
      >
        <PlantIcon running={running} progress={progress} />
        {running && <span className="plant-timer-badge">{display}</span>}
      </button>

      {open && (
        <div className="plant-timer-panel">
          <div className="plant-timer-panel-head">
            <PlantIcon running={running} progress={progress} />
            <div>
              <strong>Study Timer</strong>
              <span className="plant-timer-sub">
                {mode === 'stopwatch' ? 'Tracking session' : 'Countdown'}
              </span>
            </div>
          </div>

          <p className="plant-timer-display">{display}</p>

          {mode === 'countdown' && !running && (
            <label className="plant-timer-mins">
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

          <div className="plant-timer-modes">
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

          <div className="plant-timer-actions">
            {!running ? (
              <button type="button" className="plant-timer-start" onClick={start}>
                Start
              </button>
            ) : (
              <button type="button" className="plant-timer-pause" onClick={() => setRunning(false)}>
                Pause
              </button>
            )}
            <button type="button" className="plant-timer-reset" onClick={reset}>
              Reset
            </button>
          </div>

          {mode === 'stopwatch' && (
            <p className="plant-timer-total">Total studied: {formatTime(totalStudied)}</p>
          )}
        </div>
      )}
    </div>
  )
}
