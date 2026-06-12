import { create, all } from 'mathjs'

const math = create(all)

export type GraphFunction = { expr: string; label: string; color: string }
export type GraphPoint = { x: number; y: number; label?: string }
export type GraphSpec = {
  type: 'graph'
  title: string
  subtitle?: string
  functions: GraphFunction[]
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  axisLabels?: { x?: string; y?: string }
  points?: GraphPoint[]
}

const STROKE: Record<string, string> = {
  blue: '#2563eb',
  red: '#dc2626',
  green: '#16a34a',
  orange: '#ea5806',
  violet: '#7c3aed',
  black: '#111827',
  yellow: '#ca8a04',
  grey: '#6b7280',
}

function compileExpr(expr: string) {
  const normalized = expr
    .replace(/\^/g, '^')
    .replace(/(\d)(x|sin|cos|tan|sqrt|abs|log|exp)/gi, '$1*$2')
    .replace(/\)(x|sin|cos|tan|sqrt|abs|log|exp)/gi, ')*$1')
  return math.compile(normalized)
}

function evalY(node: { evaluate: (scope: Record<string, number>) => unknown }, x: number): number | null {
  try {
    const y = node.evaluate({ x }) as number
    return Number.isFinite(y) ? y : null
  } catch {
    return null
  }
}

/** A "nice" tick step (1, 2, 2.5, 5, 10 x 10^n) for ~targetTicks divisions. */
function niceStep(range: number, targetTicks: number): number {
  const raw = range / Math.max(1, targetTicks)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  let step
  if (norm < 1.5) step = 1
  else if (norm < 3) step = 2
  else if (norm < 7) step = 5
  else step = 10
  return step * mag
}

function fmt(n: number): string {
  if (Math.abs(n) < 1e-9) return '0'
  const r = Math.round(n * 100) / 100
  return Number.isInteger(r) ? String(r) : String(r)
}

export function renderGraphToDataUrl(spec: GraphSpec): { dataUrl: string; w: number; h: number } {
  const W = 880
  const H = 660
  const hasSub = Boolean(spec.subtitle && spec.subtitle.trim())
  const PAD = { left: 60, right: 28, top: hasSub ? 64 : 44, bottom: 56 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return { dataUrl: '', w: W, h: H }

  const { xMin, xMax, yMin, yMax } = spec
  const toX = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * plotW
  const toY = (y: number) => PAD.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH

  // Background + plot frame
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  const xStep = niceStep(xMax - xMin, 10)
  const yStep = niceStep(yMax - yMin, 8)
  const minorX = xStep / 5
  const minorY = yStep / 5

  const clampX = (px: number) => Math.max(PAD.left, Math.min(PAD.left + plotW, px))
  const clampY = (py: number) => Math.max(PAD.top, Math.min(PAD.top + plotH, py))

  // Minor grid
  ctx.strokeStyle = '#f1f3f5'
  ctx.lineWidth = 1
  for (let x = Math.ceil(xMin / minorX) * minorX; x <= xMax; x += minorX) {
    const px = toX(x)
    ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, PAD.top + plotH); ctx.stroke()
  }
  for (let y = Math.ceil(yMin / minorY) * minorY; y <= yMax; y += minorY) {
    const py = toY(y)
    ctx.beginPath(); ctx.moveTo(PAD.left, py); ctx.lineTo(PAD.left + plotW, py); ctx.stroke()
  }

  // Major grid
  ctx.strokeStyle = '#dde1e6'
  ctx.lineWidth = 1
  ctx.fillStyle = '#9aa0a6'
  ctx.font = '11px system-ui, sans-serif'
  for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax + 1e-9; x += xStep) {
    const px = toX(x)
    ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, PAD.top + plotH); ctx.stroke()
    if (Math.abs(x) > 1e-9) {
      ctx.textAlign = 'center'
      ctx.fillText(fmt(x), px, clampY(toY(0)) + 14)
    }
  }
  for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax + 1e-9; y += yStep) {
    const py = toY(y)
    ctx.beginPath(); ctx.moveTo(PAD.left, py); ctx.lineTo(PAD.left + plotW, py); ctx.stroke()
    if (Math.abs(y) > 1e-9) {
      ctx.textAlign = 'right'
      ctx.fillText(fmt(y), clampX(toX(0)) - 6, py + 4)
    }
  }

  // Axes (bold, at origin)
  ctx.strokeStyle = '#5f6368'
  ctx.lineWidth = 1.8
  const xAxisY = toY(0)
  if (xAxisY >= PAD.top && xAxisY <= PAD.top + plotH) {
    ctx.beginPath(); ctx.moveTo(PAD.left, xAxisY); ctx.lineTo(PAD.left + plotW, xAxisY); ctx.stroke()
  }
  const yAxisX = toX(0)
  if (yAxisX >= PAD.left && yAxisX <= PAD.left + plotW) {
    ctx.beginPath(); ctx.moveTo(yAxisX, PAD.top); ctx.lineTo(yAxisX, PAD.top + plotH); ctx.stroke()
  }

  // Axis labels
  ctx.fillStyle = '#3c4043'
  ctx.font = 'italic 13px system-ui, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(spec.axisLabels?.x || 'x', PAD.left + plotW - 2, clampY(xAxisY) - 6)
  ctx.textAlign = 'left'
  ctx.fillText(spec.axisLabels?.y || 'y', clampX(yAxisX) + 6, PAD.top + 10)

  // Curves
  const compiled = spec.functions.map((fn) => ({ fn, node: compileExpr(fn.expr) }))
  const steps = Math.max(240, Math.floor(plotW * 1.5))
  for (const { fn, node } of compiled) {
    ctx.strokeStyle = STROKE[fn.color] ?? STROKE.blue
    ctx.lineWidth = 2.4
    ctx.beginPath()
    let started = false
    let lastInside: { px: number; py: number } | null = null
    for (let i = 0; i <= steps; i += 1) {
      const x = xMin + (i / steps) * (xMax - xMin)
      const y = evalY(node, x)
      if (y === null || y < yMin - (yMax - yMin) || y > yMax + (yMax - yMin)) {
        started = false
        continue
      }
      const px = toX(x)
      const py = toY(y)
      if (!started) { ctx.moveTo(px, py); started = true } else { ctx.lineTo(px, py) }
      if (y >= yMin && y <= yMax) lastInside = { px, py }
    }
    ctx.stroke()

    // Direct label near the curve's last visible point (preferred over legend)
    if (lastInside) {
      ctx.fillStyle = STROKE[fn.color] ?? STROKE.blue
      ctx.font = '600 13px system-ui, sans-serif'
      ctx.textAlign = 'right'
      const lx = Math.min(lastInside.px, PAD.left + plotW - 4)
      const ly = Math.max(PAD.top + 12, Math.min(PAD.top + plotH - 4, lastInside.py - 6))
      ctx.fillText(fn.label, lx, ly)
    }
  }

  // Important points
  for (const pt of spec.points ?? []) {
    if (pt.x < xMin || pt.x > xMax || pt.y < yMin || pt.y > yMax) continue
    const px = toX(pt.x)
    const py = toY(pt.y)
    ctx.fillStyle = '#111827'
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = '#3c4043'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'left'
    const label = pt.label || `(${fmt(pt.x)}, ${fmt(pt.y)})`
    ctx.fillText(label, px + 6, py - 6)
  }

  // Title + subtitle
  ctx.textAlign = 'center'
  ctx.fillStyle = '#111827'
  ctx.font = '700 17px system-ui, sans-serif'
  ctx.fillText(spec.title || 'Graph', W / 2, 24)
  if (hasSub) {
    ctx.fillStyle = '#6b7280'
    ctx.font = '13px system-ui, sans-serif'
    ctx.fillText(spec.subtitle as string, W / 2, 44)
  }

  return { dataUrl: canvas.toDataURL('image/png'), w: W, h: H }
}
