import { create, all } from 'mathjs'
import type { Editor, TLShapeId } from 'tldraw'

const math = create(all)

export type MathSymbolResult = {
  symbol: string
  confidence: number
  alternatives?: { symbol: string; confidence: number }[]
}

export type MathRecognizeResult = {
  expression: string
  result: string
  symbols: MathSymbolResult[]
}

function normalizeExpression(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d)([xy])/gi, '$1*$2')
    .replace(/([xy])(\d)/gi, '$1*$2')
    .replace(/(\))(\()/g, '$1*$2')
    .replace(/(\d|\))([xy(])/gi, '$1*$2')
    .replace(/([xy)])(\d|\()/gi, '$1*$2')
}

function tryEvaluateExpression(expr: string): string {
  const normalized = normalizeExpression(expr)
  if (!normalized) return 'No expression recognized'

  if (normalized.includes('=')) {
    const eqIdx = normalized.indexOf('=')
    const left = normalized.slice(0, eqIdx)
    const right = normalized.slice(eqIdx + 1)
    if (left && !right) {
      try {
        const value = math.evaluate(left) as number
        if (typeof value === 'number' && Number.isFinite(value)) return formatNum(value)
      } catch {
        /* fall through */
      }
    }
    if (left && right) {
      try {
        const value = math.evaluate(left) as number
        if (typeof value === 'number' && Number.isFinite(value)) return formatNum(value)
      } catch {
        /* fall through */
      }
      try {
        const f = (x: number) => {
          const lv = math.evaluate(left, { x }) as number
          const rv = math.evaluate(right, { x }) as number
          return lv - rv
        }
        const y0 = f(0)
        const y1 = f(1)
        if (Math.abs(y1 - y0) > 1e-9) {
          const root = -y0 / (y1 - y0)
          if (Number.isFinite(root)) return `x = ${formatNum(root)}`
        }
      } catch {
        /* fall through */
      }
    }
    return 'Equation recognized — ask AI Copilot to solve step-by-step'
  }

  try {
    const value = math.evaluate(normalized) as number | { re?: number; im?: number }
    if (typeof value === 'number' && Number.isFinite(value)) return formatNum(value)
    return String(value)
  } catch {
    return 'Expression recognized — could not auto-evaluate'
  }
}

function formatNum(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return Number.isInteger(r) ? String(r) : String(r)
}

const MIN_SYMBOL_SIZE = 4

type ShapeBox = {
  id: TLShapeId
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  index: string
}

function isUsableDrawShape(editor: Editor, id: TLShapeId): boolean {
  const shape = editor.getShape(id)
  if (shape?.type !== 'draw') return false
  const bounds = editor.getShapePageBounds(id)
  if (!bounds) return false
  return bounds.width >= MIN_SYMBOL_SIZE && bounds.height >= MIN_SYMBOL_SIZE
}

function toShapeBox(editor: Editor, id: TLShapeId): ShapeBox {
  const bounds = editor.getShapePageBounds(id)!
  const shape = editor.getShape(id)!
  return {
    id,
    x: bounds.x,
    y: bounds.y,
    w: bounds.width,
    h: bounds.height,
    cx: bounds.x + bounds.width / 2,
    cy: bounds.y + bounds.height / 2,
    index: shape.index,
  }
}

function verticalOverlap(a: ShapeBox, b: ShapeBox): number {
  const top = Math.max(a.y, b.y)
  const bot = Math.min(a.y + a.h, b.y + b.h)
  return Math.max(0, bot - top)
}

/** Group strokes on one line near the most recent stroke. */
function pickExpressionCluster(editor: Editor, ids: TLShapeId[]): TLShapeId[] {
  const boxes = ids.map((id) => toShapeBox(editor, id))
  if (boxes.length <= 1) return ids

  const anchor = [...boxes].sort((a, b) => a.index.localeCompare(b.index)).pop()!

  // Ignore old equations elsewhere on the board — stay near the latest stroke.
  const padX = Math.max(280, anchor.w * 10)
  const padY = Math.max(70, anchor.h * 2)
  const nearby = boxes.filter((b) => {
    return Math.abs(b.cx - anchor.cx) <= padX / 2 && Math.abs(b.cy - anchor.cy) <= padY / 2
  })
  const pool = nearby.length > 0 ? nearby : [anchor]

  const maxDy = Math.max(60, anchor.h * 1.5)
  const maxGap = Math.max(70, anchor.w * 2.2)

  const onLine = pool.filter((b) => {
    if (Math.abs(b.cy - anchor.cy) <= maxDy) return true
    return verticalOverlap(b, anchor) >= Math.min(b.h, anchor.h) * 0.08
  })

  const sorted = [...onLine].sort((a, b) => a.cx - b.cx)
  const anchorIdx = sorted.findIndex((b) => b.id === anchor.id)
  if (anchorIdx < 0) return [anchor.id]

  let left = anchorIdx
  let right = anchorIdx
  while (left > 0) {
    const gap = sorted[left].x - (sorted[left - 1].x + sorted[left - 1].w)
    if (gap > maxGap) break
    left--
  }
  while (right < sorted.length - 1) {
    const gap = sorted[right + 1].x - (sorted[right].x + sorted[right].w)
    if (gap > maxGap) break
    right++
  }

  let cluster = sorted.slice(left, right + 1)
  // Typical equations are short — drop distant outliers if the cluster grew too wide.
  if (cluster.length > 8) {
    cluster = [...cluster]
      .sort((a, b) => Math.abs(a.cx - anchor.cx) - Math.abs(b.cx - anchor.cx))
      .slice(0, 8)
      .sort((a, b) => a.cx - b.cx)
  }
  return cluster.map((b) => b.id)
}

function resolveShapeIds(editor: Editor): TLShapeId[] {
  const selected = editor.getSelectedShapeIds().filter((id) => isUsableDrawShape(editor, id))
  if (selected.length > 0) return selected

  const allDraw = [...editor.getCurrentPageShapeIds()].filter((id) => isUsableDrawShape(editor, id))
  if (allDraw.length === 0) return []
  return pickExpressionCluster(editor, allDraw)
}

export function clusterBounds(editor: Editor, shapeIds: TLShapeId[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const sid of shapeIds) {
    const b = editor.getShapePageBounds(sid)
    if (!b) continue
    minX = Math.min(minX, b.minX)
    minY = Math.min(minY, b.minY)
    maxX = Math.max(maxX, b.maxX)
    maxY = Math.max(maxY, b.maxY)
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

export async function exportExpressionImage(editor: Editor, shapeIds: TLShapeId[]): Promise<Blob> {
  const { blob } = await editor.toImage(shapeIds, {
    format: 'png',
    background: true,
    padding: 32,
    scale: 4,
  })
  return blob
}

export async function exportShapeImage(editor: Editor, shapeId: TLShapeId): Promise<Blob> {
  return exportExpressionImage(editor, [shapeId])
}

export type MathRecognizeOutcome = {
  result: MathRecognizeResult
  shapeIds: TLShapeId[]
}

function sanitizeExpression(raw: string): string {
  return raw.replace(/[^0-9+\-*/=().xy]/gi, '')
}

function evaluateBestAnswer(symbols: MathSymbolResult[]): string | null {
  const attempts: string[] = []
  const primary = symbols.map((s) => s.symbol).join('')
  attempts.push(primary, sanitizeExpression(primary))

  const byConf = symbols
    .map((s, i) => ({ i, c: s.confidence }))
    .sort((a, b) => a.c - b.c)

  for (const { i } of byConf) {
    for (const alt of symbols[i].alternatives ?? []) {
      if (alt.symbol === symbols[i].symbol) continue
      const chars = symbols.map((s) => s.symbol)
      chars[i] = alt.symbol
      const joined = chars.join('')
      attempts.push(joined, sanitizeExpression(joined))
    }
  }

  if (byConf.length >= 2) {
    const i0 = byConf[0].i
    const i1 = byConf[1].i
    const opts0 = [symbols[i0].symbol, ...(symbols[i0].alternatives?.slice(0, 2).map((a) => a.symbol) ?? [])]
    const opts1 = [symbols[i1].symbol, ...(symbols[i1].alternatives?.slice(0, 2).map((a) => a.symbol) ?? [])]
    for (const a0 of opts0) {
      for (const a1 of opts1) {
        const chars = symbols.map((s) => s.symbol)
        chars[i0] = a0
        chars[i1] = a1
        const joined = chars.join('')
        attempts.push(joined, sanitizeExpression(joined))
      }
    }
  }

  for (const expr of [...new Set(attempts.filter(Boolean))]) {
    const result = tryEvaluateExpression(expr)
    if (/^-?\d+(\.\d+)?$/.test(result.trim())) return result.trim()
  }
  return null
}

export async function recognizeDrawnMath(
  editor: Editor,
  predictExpression: (image: Blob) => Promise<{ expression: string; symbols: MathSymbolResult[] }>,
): Promise<MathRecognizeOutcome | null> {
  const shapeIds = resolveShapeIds(editor)
  if (shapeIds.length === 0) return null

  const blob = await exportExpressionImage(editor, shapeIds)
  const { expression, symbols } = await predictExpression(blob)
  const evalResult =
    evaluateBestAnswer(symbols) ?? tryEvaluateExpression(sanitizeExpression(expression))
  return { result: { expression, result: evalResult, symbols }, shapeIds }
}

/** Returns only the numeric answer for the canvas — never debug text. */
export function formatMathAnswer(result: MathRecognizeResult): string | null {
  const fromSymbols = evaluateBestAnswer(result.symbols)
  if (fromSymbols) return fromSymbols
  const fromExpr = tryEvaluateExpression(sanitizeExpression(result.expression))
  if (/^-?\d+(\.\d+)?$/.test(fromExpr.trim())) return fromExpr.trim()
  const rootMatch = fromExpr.match(/^x\s*=\s*(-?\d+(?:\.\d+)?)$/i)
  if (rootMatch) return rootMatch[1]
  return null
}
