import { create, all } from 'mathjs'

const math = create(all)

export type GraphFunction = { expr: string; label: string; color: string }
export type GraphSpec = {
  type: 'graph'
  title: string
  functions: GraphFunction[]
  xMin: number
  xMax: number
  yMin: number
  yMax: number
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

export function renderGraphToDataUrl(spec: GraphSpec): { dataUrl: string; w: number; h: number } {
  const W = 820
  const H = 580
  const PAD = { left: 56, right: 24, top: 36, bottom: 52 }
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

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  ctx.strokeStyle = '#e5e7eb'
  ctx.lineWidth = 1
  const xTicks = 10
  const yTicks = 8
  for (let i = 0; i <= xTicks; i += 1) {
    const x = xMin + (i / xTicks) * (xMax - xMin)
    const px = toX(x)
    ctx.beginPath()
    ctx.moveTo(px, PAD.top)
    ctx.lineTo(px, PAD.top + plotH)
    ctx.stroke()
  }
  for (let i = 0; i <= yTicks; i += 1) {
    const y = yMin + (i / yTicks) * (yMax - yMin)
    const py = toY(y)
    ctx.beginPath()
    ctx.moveTo(PAD.left, py)
    ctx.lineTo(PAD.left + plotW, py)
    ctx.stroke()
  }

  ctx.strokeStyle = '#374151'
  ctx.lineWidth = 1.5
  const xAxisY = toY(0)
  if (xAxisY >= PAD.top && xAxisY <= PAD.top + plotH) {
    ctx.beginPath()
    ctx.moveTo(PAD.left, xAxisY)
    ctx.lineTo(PAD.left + plotW, xAxisY)
    ctx.stroke()
  }
  const yAxisX = toX(0)
  if (yAxisX >= PAD.left && yAxisX <= PAD.left + plotW) {
    ctx.beginPath()
    ctx.moveTo(yAxisX, PAD.top)
    ctx.lineTo(yAxisX, PAD.top + plotH)
    ctx.stroke()
  }

  ctx.fillStyle = '#6b7280'
  ctx.font = '12px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(String(xMin), toX(xMin), H - 18)
  ctx.fillText(String(xMax), toX(xMax), H - 18)
  ctx.textAlign = 'right'
  ctx.fillText(String(yMax), PAD.left - 8, toY(yMax) + 4)
  ctx.fillText(String(yMin), PAD.left - 8, toY(yMin) + 4)

  const compiled = spec.functions.map((fn) => ({
    fn,
    node: compileExpr(fn.expr),
  }))

  const steps = Math.max(200, Math.floor(plotW * 1.5))
  for (const { fn, node } of compiled) {
    ctx.strokeStyle = STROKE[fn.color] ?? STROKE.blue
    ctx.lineWidth = 2.2
    ctx.beginPath()
    let started = false
    for (let i = 0; i <= steps; i += 1) {
      const x = xMin + (i / steps) * (xMax - xMin)
      const y = evalY(node, x)
      if (y === null || y < yMin - (yMax - yMin) || y > yMax + (yMax - yMin)) {
        started = false
        continue
      }
      const px = toX(x)
      const py = toY(y)
      if (!started) {
        ctx.moveTo(px, py)
        started = true
      } else {
        ctx.lineTo(px, py)
      }
    }
    ctx.stroke()
  }

  let legendY = PAD.top + 8
  ctx.textAlign = 'left'
  ctx.font = '13px system-ui, sans-serif'
  for (const { fn } of compiled) {
    ctx.fillStyle = STROKE[fn.color] ?? STROKE.blue
    ctx.fillRect(PAD.left + plotW - 180, legendY, 14, 3)
    ctx.fillStyle = '#111827'
    ctx.fillText(fn.label, PAD.left + plotW - 160, legendY + 4)
    legendY += 18
  }

  return { dataUrl: canvas.toDataURL('image/png'), w: W, h: H }
}
