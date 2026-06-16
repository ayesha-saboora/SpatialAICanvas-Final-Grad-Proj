import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type SignAccessMode = 'shortcut' | 'aac'

type PredictResult = { letter: string; confidence: number }

type Props = {
  open: boolean
  onClose: () => void
  isDark: boolean
  mode: SignAccessMode
  onModeChange: (mode: SignAccessMode) => void
  predictSign: (image: Blob) => Promise<PredictResult>
  onShortcut: (letter: string) => void
  onPlaceAacText: (text: string) => void
}

const SHORTCUT_GUIDE: { letter: string; action: string }[] = [
  { letter: 'F', action: 'Flowchart' },
  { letter: 'G', action: 'Graph' },
  { letter: 'A', action: 'Add note' },
  { letter: 'C', action: 'Clear' },
  { letter: 'U', action: 'Undo' },
  { letter: 'H', action: 'Help' },
]

const QUICK_PHRASES: string[] = [
  'I need help',
  'Yes',
  'No',
  'More',
  'Stop',
  'Thank you',
]

const CONFIDENCE_MIN = 0.72
const VOTE_FRAME_MIN = 0.55
const VOTE_FRAMES = 3
const DEBOUNCE_MS = 1500
const CAMERA_TIMEOUT_MS = 15000
const LIVE_INTERVAL_MS = 900

function speak(text: string): void {
  const synth = window.speechSynthesis
  if (!synth || !text.trim()) return
  try {
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text.trim())
    utterance.rate = 0.95
    utterance.pitch = 1
    synth.speak(utterance)
  } catch {
    /* speech synthesis unavailable */
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms))
}

function captureCenterCrop(video: HTMLVideoElement): Promise<Blob> {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return Promise.reject(new Error('Video not ready'))

  const canvas = document.createElement('canvas')
  canvas.width = 224
  canvas.height = 224
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.reject(new Error('Canvas unavailable'))

  const crop = Math.min(vw, vh) * 0.82
  const sx = (vw - crop) / 2
  const sy = (vh - crop) / 2
  ctx.drawImage(video, sx, sy, crop, crop, 0, 0, 224, 224)

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Capture failed'))), 'image/jpeg', 0.92)
  })
}

function majorityVote(results: PredictResult[]): PredictResult | null {
  const tallies = new Map<string, { count: number; confSum: number }>()
  for (const r of results) {
    if (r.confidence < VOTE_FRAME_MIN) continue
    const L = r.letter.toUpperCase()
    const row = tallies.get(L) ?? { count: 0, confSum: 0 }
    row.count += 1
    row.confSum += r.confidence
    tallies.set(L, row)
  }
  let best: { letter: string; count: number; conf: number } | null = null
  for (const [letter, row] of tallies) {
    const conf = row.confSum / row.count
    if (!best || row.count > best.count || (row.count === best.count && conf > best.conf)) {
      best = { letter, count: row.count, conf }
    }
  }
  if (!best || best.count < 2) return null
  return { letter: best.letter, confidence: best.conf }
}

function isVirtualCamera(label: string): boolean {
  return /obs|virtual|lenovo virt|snap camera|manycam|xsplit|droidcam|epoc cam/i.test(label)
}

function physicalCameras(cams: MediaDeviceInfo[]): MediaDeviceInfo[] {
  return cams.filter((c) => !isVirtualCamera(c.label))
}

function preferredCameraId(cams: MediaDeviceInfo[]): string {
  const physical = physicalCameras(cams).filter((c) => !/ir camera|infrared/i.test(c.label))
  const integrated = physical.find((c) =>
    /integrated|webcam|hd user facing|facetime|hp hd|acer|asus|dell|camera.*5986/i.test(c.label),
  )
  if (integrated) return integrated.deviceId
  return physical[0]?.deviceId ?? ''
}

function resolveCameraId(
  physical: MediaDeviceInfo[],
  deviceOverride: string | undefined,
  storedId: string,
): string {
  if (deviceOverride && physical.some((c) => c.deviceId === deviceOverride)) return deviceOverride
  if (storedId && physical.some((c) => c.deviceId === storedId)) return storedId
  return preferredCameraId(physical) || physical[0]?.deviceId || ''
}

function shortCameraLabel(label: string, index: number): string {
  if (!label) return `Camera ${index + 1}`
  const trimmed = label.replace(/\s*\([0-9a-f:]+\)\s*$/i, '').trim()
  return trimmed.length > 28 ? `${trimmed.slice(0, 26)}…` : trimmed
}

function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  const msg = err instanceof Error ? err.message : String(err)
  if (name === 'NotAllowedError' || /permission/i.test(msg)) {
    return 'Camera permission denied — click the lock icon in the address bar, allow Camera, then Retry.'
  }
  if (name === 'NotFoundError' || /not found/i.test(msg)) {
    return 'No camera found on this device.'
  }
  if (name === 'NotReadableError' || /in use|busy|allocate/i.test(msg)) {
    return 'Camera is in use by another app — close Teams, Zoom, or Camera app, then Retry.'
  }
  return msg || 'Could not start video source'
}

function hasMediaDevices(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    promise
      .then((v) => { window.clearTimeout(timer); resolve(v) })
      .catch((e) => { window.clearTimeout(timer); reject(e) })
  })
}

function buildCameraAttempts(deviceId: string, cams: MediaDeviceInfo[]): MediaStreamConstraints[] {
  const physical = physicalCameras(cams).filter((c) => !/ir camera|infrared/i.test(c.label))
  const orderedIds = deviceId && physical.some((c) => c.deviceId === deviceId)
    ? [deviceId, ...physical.map((c) => c.deviceId).filter((id) => id !== deviceId)]
    : physical.map((c) => c.deviceId)

  const attempts: MediaStreamConstraints[] = [
    { video: { facingMode: 'user' }, audio: false },
    { video: true, audio: false },
  ]
  for (const id of orderedIds) {
    if (!id) continue
    attempts.push({ video: { deviceId: { ideal: id } }, audio: false })
  }
  return attempts
}

export function SignAccessibilityPanel({
  open,
  onClose,
  isDark,
  mode,
  onModeChange,
  predictSign,
  onShortcut,
  onPlaceAacText,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const lastLetterRef = useRef({ letter: '', t: 0 })
  const startingRef = useRef(false)
  const busyRef = useRef(false)
  const captureRef = useRef<() => Promise<void>>(async () => {})
  const liveTimerRef = useRef<number | null>(null)

  const [cameraOn, setCameraOn] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [predicting, setPredicting] = useState(false)
  const [lastResult, setLastResult] = useState<PredictResult | null>(null)
  const [status, setStatus] = useState('')
  const [spellBuffer, setSpellBuffer] = useState('')
  const [ttsOn, setTtsOn] = useState(true)
  const [liveOn, setLiveOn] = useState(false)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  const listVideoDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) return []
    const devices = await navigator.mediaDevices.enumerateDevices()
    const cams = devices.filter((d) => d.kind === 'videoinput')
    const physical = physicalCameras(cams).filter((c) => !/ir camera|infrared/i.test(c.label))
    const list = physical.length ? physical : physicalCameras(cams)
    setVideoDevices(list)
    return cams
  }, [])

  const startCamera = useCallback(async (deviceOverride?: string) => {
    if (startingRef.current) return
    startingRef.current = true
    setCameraError('')
    setStatus('Starting camera...')
    setCameraOn(false)
    stopCamera()
    await sleep(600)

    try {
      if (!hasMediaDevices()) {
        setCameraError('Camera needs a secure page — open http://localhost:5173 (not an IP address).')
        setStatus('')
        return
      }

      let allCams = await listVideoDevices()
      const physical = physicalCameras(allCams).filter((c) => !/ir camera|infrared/i.test(c.label))
      const deviceId = resolveCameraId(physical, deviceOverride, selectedDeviceId)
      setSelectedDeviceId(deviceId)
      const attempts = buildCameraAttempts(deviceId, allCams)

      let lastErr = 'Could not start video source'
      let permissionDenied = false
      for (const constraints of attempts) {
        try {
          const stream = await withTimeout(
            navigator.mediaDevices.getUserMedia(constraints),
            CAMERA_TIMEOUT_MS,
            'Camera',
          )
          const track = stream.getVideoTracks()[0]
          if (!track || track.readyState !== 'live') {
            stream.getTracks().forEach((t) => t.stop())
            lastErr = 'Camera track not live'
            continue
          }
          const trackLabel = track.label ?? ''
          if (isVirtualCamera(trackLabel)) {
            stream.getTracks().forEach((t) => t.stop())
            lastErr = 'Virtual camera blocked — close OBS / Lenovo Virtual Camera'
            continue
          }

          const settings = track.getSettings()
          if (settings.deviceId) setSelectedDeviceId(settings.deviceId)

          streamRef.current = stream
          const video = videoRef.current
          if (video) {
            video.srcObject = stream
            video.muted = true
            await withTimeout(video.play(), 8000, 'Video play')
          }
          allCams = await listVideoDevices()
          setCameraOn(true)
          setCameraError('')
          setStatus('Hold your sign in frame, then tap Capture sign.')
          return
        } catch (err) {
          if (err instanceof DOMException && err.name === 'NotAllowedError') permissionDenied = true
          lastErr = cameraErrorMessage(err)
        }
      }

      if (permissionDenied) {
        setCameraError(lastErr)
      } else if (physicalCameras(allCams).length === 0 && allCams.length === 0) {
        setCameraError(
          'No camera detected. Check Windows Settings → Privacy → Camera (allow desktop apps), then Retry.',
        )
      } else {
        setCameraError(`${lastErr} — or use Upload photo.`)
      }
      setCameraOn(false)
      setStatus('')
    } finally {
      startingRef.current = false
    }
  }, [listVideoDevices, selectedDeviceId, stopCamera])

  useEffect(() => {
    if (!open) {
      setLiveOn(false)
      window.speechSynthesis?.cancel()
      stopCamera()
      return
    }
    void startCamera()
    return () => {
      setLiveOn(false)
      window.speechSynthesis?.cancel()
      stopCamera()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const acceptLetter = (letter: string, confidence: number): boolean => {
    if (confidence < CONFIDENCE_MIN) {
      setStatus(`Low confidence (${Math.round(confidence * 100)}%). Hold sign steady and retry.`)
      return false
    }
    const now = Date.now()
    if (letter === lastLetterRef.current.letter && now - lastLetterRef.current.t < DEBOUNCE_MS) {
      return false
    }
    lastLetterRef.current = { letter, t: now }
    return true
  }

  const handleDetectedLetter = (letter: string, confidence: number) => {
    const L = letter.toUpperCase()
    setLastResult({ letter: L, confidence })

    if (L === 'H' && mode === 'shortcut') {
      setStatus('F Flowchart · G Graph · A Note · C Clear · U Undo · H Help')
      return
    }

    if (!acceptLetter(L, confidence)) return

    if (mode === 'shortcut') {
      onShortcut(L)
      const action = SHORTCUT_GUIDE.find((s) => s.letter === L)?.action
      setStatus(`Shortcut triggered: ${L}${action ? ` (${action})` : ''}`)
      if (ttsOn && action) speak(action)
    } else {
      setSpellBuffer((prev) => prev + L)
      setStatus(`Added "${L}" to spell buffer`)
      if (ttsOn) speak(L)
    }
  }

  const predictFromBlob = async (blob: Blob) => {
    setPredicting(true)
    setStatus('Detecting sign...')
    try {
      const result = await predictSign(blob)
      handleDetectedLetter(result.letter, result.confidence)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Sign detection failed')
    } finally {
      setPredicting(false)
    }
  }

  const captureAndPredict = async () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      if (!liveOn) setStatus('Camera not ready. Retry or use Upload photo.')
      return
    }
    if (busyRef.current) return

    busyRef.current = true
    setPredicting(true)
    if (!liveOn) setStatus('Hold sign steady — capturing 3 frames…')
    try {
      const frameResults: PredictResult[] = []
      for (let i = 0; i < VOTE_FRAMES; i += 1) {
        if (i > 0) await sleep(180)
        const blob = await captureCenterCrop(video)
        frameResults.push(await predictSign(blob))
      }

      const voted = majorityVote(frameResults)
      if (!voted) {
        if (!liveOn) {
          const guesses = frameResults
            .map((r) => `${r.letter}(${Math.round(r.confidence * 100)}%)`)
            .join(', ')
          setStatus(`Unclear — center your hand, plain background, hold still. Frames: ${guesses}`)
          setLastResult(frameResults[0] ?? null)
        }
        return
      }

      handleDetectedLetter(voted.letter, voted.confidence)
    } catch (err) {
      if (!liveOn) setStatus(err instanceof Error ? err.message : 'Sign detection failed')
    } finally {
      setPredicting(false)
      busyRef.current = false
    }
  }

  captureRef.current = captureAndPredict

  useEffect(() => {
    if (!liveOn || !cameraOn) {
      if (liveTimerRef.current !== null) {
        window.clearInterval(liveTimerRef.current)
        liveTimerRef.current = null
      }
      return
    }
    setStatus('Live detection on — hold each sign steady for a moment.')
    liveTimerRef.current = window.setInterval(() => {
      if (!busyRef.current) void captureRef.current()
    }, LIVE_INTERVAL_MS)
    return () => {
      if (liveTimerRef.current !== null) {
        window.clearInterval(liveTimerRef.current)
        liveTimerRef.current = null
      }
    }
  }, [liveOn, cameraOn])

  const onUploadImage = async (file: File | undefined) => {
    if (!file) return
    await predictFromBlob(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  if (!open) return null

  const hint = cameraError || status

  return createPortal(
    <div
      className={`sign-panel ${isDark ? 'sign-panel-dark' : 'sign-panel-light'}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="sign-panel-header">
        <div className="sign-panel-header-top">
          <div className="sign-panel-title">
            <strong>Sign Access</strong>
            <span className="sign-panel-sub">ASL shortcuts &amp; AAC</span>
          </div>
          <button
            type="button"
            className="sign-panel-close"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onClose()
            }}
            aria-label="Close Sign Access"
          >
            ×
          </button>
        </div>
        <div className="sign-mode-tabs">
          <button
            type="button"
            className={mode === 'shortcut' ? 'sign-tab-active' : ''}
            onClick={() => onModeChange('shortcut')}
          >
            Shortcuts
          </button>
          <button
            type="button"
            className={mode === 'aac' ? 'sign-tab-active' : ''}
            onClick={() => onModeChange('aac')}
          >
            AAC Spell
          </button>
        </div>
      </header>

      {mode === 'shortcut' && (
        <div className="sign-shortcuts-strip" aria-label="Sign shortcuts">
          {SHORTCUT_GUIDE.map((row) => (
            <div key={row.letter} className="sign-shortcut-chip">
              <span className="sign-shortcut-letter">{row.letter}</span>
              <span className="sign-shortcut-action">{row.action}</span>
            </div>
          ))}
        </div>
      )}

      <section className="sign-stage" aria-label="Camera preview">
        {!cameraOn && (
          <div className="sign-stage-empty">
            <span className="sign-stage-icon" aria-hidden>📷</span>
            <span>{cameraError ? 'Camera unavailable' : 'Starting camera…'}</span>
          </div>
        )}
        <video
          ref={videoRef}
          className={`sign-camera${cameraOn ? '' : ' sign-camera-off'}`}
          playsInline
          muted
          autoPlay
        />
      </section>

      <div className="sign-controls">
        <div className="sign-toggle-row">
          <button
            type="button"
            className={`sign-toggle ${liveOn ? 'sign-toggle-on' : ''}`}
            onClick={() => setLiveOn((v) => !v)}
            disabled={!cameraOn}
            aria-pressed={liveOn}
          >
            <span className="sign-toggle-dot" aria-hidden />
            {liveOn ? 'Live: on' : 'Live: off'}
          </button>
          <button
            type="button"
            className={`sign-toggle ${ttsOn ? 'sign-toggle-on' : ''}`}
            onClick={() => {
              setTtsOn((v) => {
                if (v) window.speechSynthesis?.cancel()
                return !v
              })
            }}
            aria-pressed={ttsOn}
          >
            {ttsOn ? '🔊 Sound on' : '🔈 Sound off'}
          </button>
        </div>

        <div className="sign-action-row">
          <button
            type="button"
            className="sign-capture-btn"
            onClick={() => void captureAndPredict()}
            disabled={predicting || !cameraOn || liveOn}
          >
            {liveOn ? 'Live detecting…' : predicting ? 'Detecting…' : 'Capture sign'}
          </button>
          <button
            type="button"
            className="sign-secondary-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={predicting}
          >
            Upload photo
          </button>
          <button
            type="button"
            className="sign-retry-btn"
            onClick={() => void startCamera()}
            disabled={predicting}
          >
            Retry camera
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => void onUploadImage(e.target.files?.[0])}
          />
        </div>

        {videoDevices.length > 0 && (
          <label className="sign-camera-pill">
            <span className="sign-camera-pill-icon" aria-hidden>🎥</span>
            <select
              value={selectedDeviceId}
              onChange={(e) => {
                const id = e.target.value
                setSelectedDeviceId(id)
                void startCamera(id)
              }}
            >
              {videoDevices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {shortCameraLabel(d.label, i)}
                </option>
              ))}
            </select>
          </label>
        )}

        <p className={`sign-status ${cameraError ? 'sign-status-error' : ''}`}>
          {hint ||
            (lastResult
              ? `Detected ${lastResult.letter} (${Math.round(lastResult.confidence * 100)}%)`
              : 'No sign captured yet')}
        </p>
      </div>

      {mode === 'aac' && (
        <footer className="sign-aac-block">
          <div className="sign-quick-phrases" aria-label="Quick phrases">
            {QUICK_PHRASES.map((phrase) => (
              <button
                key={phrase}
                type="button"
                className="sign-quick-phrase"
                onClick={() => {
                  onPlaceAacText(phrase)
                  if (ttsOn) speak(phrase)
                  setStatus(`Said & placed "${phrase}"`)
                }}
              >
                {phrase}
              </button>
            ))}
          </div>

          <div className="sign-aac-buffer">{spellBuffer || 'Spell a word with signs…'}</div>
          <div className="sign-aac-actions">
            <button type="button" onClick={() => setSpellBuffer((p) => p + ' ')}>Space</button>
            <button type="button" onClick={() => setSpellBuffer((p) => p.slice(0, -1))}>Del</button>
            <button type="button" onClick={() => setSpellBuffer('')}>Clear</button>
            <button
              type="button"
              disabled={!spellBuffer.trim()}
              onClick={() => speak(spellBuffer)}
            >
              🔊 Speak
            </button>
            <button
              type="button"
              className="sign-aac-primary"
              disabled={!spellBuffer.trim()}
              onClick={() => {
                const text = spellBuffer.trim()
                if (!text) return
                onPlaceAacText(text)
                if (ttsOn) speak(text)
                setSpellBuffer('')
                setStatus(`Placed "${text}" on canvas`)
              }}
            >
              Add to canvas
            </button>
          </div>
        </footer>
      )}
    </div>,
    document.body,
  )
}
