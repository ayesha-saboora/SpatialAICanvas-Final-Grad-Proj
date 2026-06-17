import { createShapeId, toRichText, type Editor, type TLRichText, type TLShapeId } from 'tldraw'
import { mathAnswerColor } from './canvasTheme'

export type SolutionStep = {
  title: string
  content: string
}

export type SolutionPayload = {
  intro?: string
  method?: string
  formula?: string
  steps: SolutionStep[]
  final_answer?: string
  quick_check?: string
}

/** Vertical gap after each text line by size (generous spacing like study notes). */
const LINE_GAP: Record<'xl' | 'l' | 'm' | 's', number> = {
  xl: 56,
  l: 46,
  m: 38,
  s: 30,
}
const SECTION_GAP = 36
const STEP_GAP = 28
const FORMULA_GAP = 44
const NOTES_COLUMN_W = 640
const NOTES_GAP = 80

/** Off-topic phrases that leak from canvas/document context into math answers. */
const OFF_TOPIC = [
  'uae', 'vehicle', 'ecosystem', 'platform', 'stakeholder', 'interoperability',
  'fraud', 'lifecycle', 'unified', 'selected concepts', 'canvas board',
  'not directly related', 'trigonometric functions discussed',
]

function isMathRelevantText(text: string): boolean {
  const lower = text.toLowerCase()
  if (OFF_TOPIC.some((w) => lower.includes(w))) return false
  if (/step\s*\d/i.test(text)) return true
  return /[$∫=^\\]|integrat|deriv|simplif|factor|substitut|u\s*=|dv\s*=|e\^x|\bdx\b|\bdu\b|\+\s*c\b|antideriv|differentiat|product rule|by parts|liate|guideline|algebraic|exponential/i.test(text)
}

export function filterSolutionSteps(steps: SolutionStep[], forMathOnly = true): SolutionStep[] {
  const filtered = steps.filter((s) => {
    const text = `${s.title} ${s.content}`
    const lower = text.toLowerCase()
    if (OFF_TOPIC.some((w) => lower.includes(w))) return false
    if (!forMathOnly) return text.trim().length > 0
    if (/step\s*\d/i.test(text)) return true
    return isMathRelevantText(text)
  })
  return filtered.slice(0, 8)
}

/** Place new notes to the right of existing canvas content — never on top of prior answers. */
export function getNextNotesOrigin(editor: Editor, gap = NOTES_GAP): { x: number; y: number } {
  const ids = [...editor.getCurrentPageShapeIds()]
  const vp = editor.getViewportPageBounds()
  if (ids.length === 0) return { x: vp.x + 64, y: vp.y + 64 }

  let maxRight = -Infinity
  let topY = Infinity
  for (const id of ids) {
    const b = editor.getShapePageBounds(id)
    if (!b) continue
    if (b.maxX > maxRight) maxRight = b.maxX
    if (b.minY < topY) topY = b.minY
  }
  if (!isFinite(maxRight)) return { x: vp.x + 64, y: vp.y + 64 }
  return { x: maxRight + gap, y: isFinite(topY) ? topY : vp.y + 64 }
}

/** Convert LaTeX fragments to readable canvas text. */
export function latexToCanvasText(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^\$\$?|\$\$?$/g, '')
  s = s.replace(/\\int/g, '∫')
  s = s.replace(/\\Rightarrow/g, '⇒')
  s = s.replace(/\\cdot/g, '·')
  s = s.replace(/\\,/g, ' ')
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1)/($2)')
  s = s.replace(/\\text\{([^}]+)\}/g, '$1')
  s = s.replace(/\\left/g, '').replace(/\\right/g, '')
  s = s.replace(/\{([^{}]+)\}/g, '$1')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function toBoldRichText(text: string): TLRichText {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text, marks: [{ type: 'bold' }] }],
    }],
  }
}

function toRichTextWithBold(text: string): TLRichText {
  const nodes: Array<{ type: 'text'; text: string; marks?: Array<{ type: 'bold' }> }> = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) })
    nodes.push({ type: 'text', text: m[1], marks: [{ type: 'bold' }] })
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) })
  if (nodes.length === 0) return toRichText(text)
  return { type: 'doc', content: [{ type: 'paragraph', content: nodes }] }
}

function buildIntro(problem: string, method?: string): string {
  const p = latexToCanvasText(problem)
  const m = (method || 'the appropriate method').toLowerCase()
  if (/∫|integrat/i.test(p)) {
    return `To solve the integral ${p}, we can use the method of **${m}**.`
  }
  return `To solve ${p}, we can use the method of **${m}**.`
}

/** Break long prose into short lines — never one giant horizontal string. */
function wrapLines(text: string, maxChars = 72): string[] {
  const out: string[] = []
  const chunks = text.split(/\n+/).map((s) => s.trim()).filter(Boolean)
  for (const chunk of chunks.length ? chunks : [text]) {
    if (chunk.length <= maxChars) {
      out.push(chunk)
      continue
    }
    let rest = chunk
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars)
      if (cut < 20) cut = rest.lastIndexOf(',', maxChars)
      if (cut < 20) cut = maxChars
      out.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}

function isFormulaLine(line: string): boolean {
  const t = line.trim()
  if (/^[○•\-*]/.test(t)) return false
  return /^[=∫]|^\\int|e\^x|du\s*=|dv\s*=|\+\s*C\b|∫\s*\w/i.test(t)
}

function isBulletLine(line: string): boolean {
  const t = line.trim()
  return /^[•\-*○]\s/.test(t) || /^(u|dv|du|v)\s*=/.test(t)
}

function normalizeBullet(line: string): string {
  const inner = line.replace(/^[•\-*○]\s*/, '').trim()
  return `○ ${inner}`
}

/** Lay out a full worked solution on the canvas — study-notes style. */
export function placeSolutionOnCanvas(
  editor: Editor,
  payload: SolutionPayload,
  isDarkUi: boolean,
  problemTitle?: string,
  forMathOnly = true,
): TLShapeId[] {
  const ink = mathAnswerColor(isDarkUi)
  const accent = isDarkUi ? 'light-violet' : 'violet'
  const filtered = filterSolutionSteps(payload.steps, forMathOnly)
  if (filtered.length === 0) return []

  const { x: baseX, y: startY } = getNextNotesOrigin(editor)
  let y = startY
  const ids: TLShapeId[] = []

  const addShape = (
    richText: TLRichText,
    size: 'xl' | 'l' | 'm' | 's',
    color = ink,
    opts?: { center?: boolean; indent?: number },
  ) => {
    const id = createShapeId()
    ids.push(id)
    const centered = opts?.center ?? false
    const x = baseX + (opts?.indent ?? 0)
    editor.createShape({
      id,
      type: 'text',
      x,
      y,
      props: {
        richText,
        size,
        color,
        font: 'sans',
        w: centered ? NOTES_COLUMN_W : NOTES_COLUMN_W - (opts?.indent ?? 0),
        textAlign: centered ? 'middle' : 'start',
      },
    })
    y += LINE_GAP[size]
  }

  const addLine = (
    text: string,
    size: 'xl' | 'l' | 'm' | 's',
    color = ink,
    opts?: { center?: boolean; indent?: number; bold?: boolean },
  ) => {
    const line = latexToCanvasText(text).trim()
    if (!line) return
    const richText = opts?.bold ? toBoldRichText(line) : toRichText(line)
    addShape(richText, size, color, opts)
  }

  const addProse = (text: string, color = ink) => {
    const plain = latexToCanvasText(text)
    for (const line of wrapLines(plain, 72)) {
      addShape(toRichTextWithBold(line), 'm', color)
    }
  }

  const addStepContent = (content: string) => {
    for (const part of content.split(/\n+/)) {
      const trimmed = part.trim()
      if (!trimmed) continue
      if (isBulletLine(trimmed)) {
        addLine(normalizeBullet(trimmed), 'm', ink, { indent: 28 })
      } else if (isFormulaLine(trimmed)) {
        addLine(trimmed, 'l', ink, { center: true })
        y += 8
      } else {
        addProse(trimmed, ink)
      }
    }
  }

  const addSpacer = (px = SECTION_GAP) => {
    y += px
  }

  // Intro paragraph: "To solve the integral …, we can use the method of integration by parts."
  const intro = payload.intro?.trim()
    || (problemTitle?.trim() ? buildIntro(problemTitle, payload.method) : '')
  if (intro) {
    addProse(intro, ink)
    addSpacer()
  }

  if (payload.formula?.trim()) {
    addLine(payload.formula.trim(), 'l', ink, { center: true })
    addSpacer(FORMULA_GAP)
  } else if (payload.method?.trim() && !intro) {
    addProse(`We use **${payload.method.trim()}**.`, accent)
    addSpacer()
  }

  for (const step of filtered) {
    if (step.title?.trim() && !/^problem$/i.test(step.title)) {
      addLine(latexToCanvasText(step.title.trim()), 'l', accent, { bold: true })
      y += 12
    }
    if (step.content?.trim()) {
      addStepContent(step.content.trim())
    }
    addSpacer(STEP_GAP)
  }

  if (payload.final_answer?.trim()) {
    addLine('Final Answer', 'l', accent, { bold: true })
    y += 12
    addLine(payload.final_answer.trim(), 'xl', isDarkUi ? 'yellow' : 'green', { center: true })
    addSpacer()
  }

  if (payload.quick_check?.trim()) {
    addLine('Quick Check', 'l', accent, { bold: true })
    y += 12
    addProse(payload.quick_check.trim(), ink)
  }

  if (ids.length > 0) {
    const prev = editor.getSelectedShapeIds()
    editor.select(...ids)
    editor.zoomToSelection({ animation: { duration: 450 } })
    editor.setSelectedShapes(prev)
  }

  return ids
}

/** Parse step blocks from plain explanation text. */
export function parseSolutionFromExplanation(text: string): SolutionPayload | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const steps: SolutionStep[] = []
  const stepRe = /Step\s*(\d+)\s*[:.)]\s*([^\n]*)([\s\S]*?)(?=Step\s*\d+\s*[:.)]|Final\s*Answer|Quick\s*Check|$)/gi
  let m: RegExpExecArray | null
  while ((m = stepRe.exec(trimmed)) !== null) {
    const title = m[2].trim()
    const content = m[3].trim()
    steps.push({ title: title ? `Step ${m[1]}: ${title}` : `Step ${m[1]}`, content })
  }

  if (steps.length > 0) {
    const finalMatch = trimmed.match(/Final\s*Answer\s*[:.]?\s*([\s\S]*?)(?=Quick\s*Check|$)/i)
    const checkMatch = trimmed.match(/Quick\s*Check\s*[:.]?\s*([\s\S]*?)$/i)
    let method = ''
    if (/integration by parts/i.test(trimmed)) method = 'integration by parts'
    const filtered = filterSolutionSteps(steps)
    if (filtered.length === 0) return null
    const introMatch = trimmed.match(/^([\s\S]*?)(?=Step\s*1\s*[:.)]|\*\*Step\s*1)/i)
    return {
      intro: introMatch?.[1]?.trim() || undefined,
      method: method || undefined,
      formula: method ? '∫u dv = uv − ∫v du' : undefined,
      steps: filtered,
      final_answer: finalMatch?.[1]?.trim(),
      quick_check: checkMatch?.[1]?.trim(),
    }
  }

  return null
}

/** Split a dense paragraph into numbered steps (one or two sentences each). */
function paragraphToSteps(text: string): SolutionStep[] {
  const steps: SolutionStep[] = []

  const inline = [...text.matchAll(/Step\s*(\d+)\s*[:.)]\s*([^]*?)(?=Step\s*\d+\s*[:.)]|$)/gi)]
  if (inline.length > 1) {
    for (const m of inline) {
      const title = m[2].split(/[.!?]/)[0]?.trim() ?? ''
      steps.push({
        title: title ? `Step ${m[1]}: ${title}` : `Step ${m[1]}`,
        content: m[2].trim(),
      })
    }
    return steps
  }

  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((s) => s.trim()).filter((s) => s.length > 8) ?? [text]
  let n = 1
  for (let i = 0; i < sentences.length; i += 1) {
    const s = sentences[i]
    const lower = s.toLowerCase()
    let title = `Step ${n}`
    if (lower.startsWith('let ') || lower.includes('choose u')) title = `Step ${n}: Choose u and dv`
    else if (lower.includes('apply') || lower.includes('formula')) title = `Step ${n}: Apply the formula`
    else if (lower.includes('integrat')) title = `Step ${n}: Integrate`
    else if (lower.includes('factor') || lower.includes('simplif')) title = `Step ${n}: Simplify`
    else if (lower.includes('therefore') || lower.includes('final')) title = `Step ${n}: Result`
    steps.push({ title, content: s })
    n += 1
  }
  return steps
}

/** Build canvas layout even when the LLM returns one dense paragraph. */
export function buildFallbackSolution(text: string, problem?: string): SolutionPayload | null {
  const parsed = parseSolutionFromExplanation(text)
  if (parsed?.steps?.length) return parsed

  const trimmed = text.trim()
  if (!trimmed) return null

  let method = ''
  if (/integration by parts/i.test(trimmed)) method = 'integration by parts'
  else if (/u-substitution|substitution/i.test(trimmed)) method = 'U-Substitution'
  else if (/product rule/i.test(trimmed)) method = 'Product Rule'

  const formula = method === 'integration by parts' ? '∫u dv = uv − ∫v du' : ''

  const finalMatch =
    trimmed.match(/(?:final answer|thus|therefore)[:\s]*([^.]+\+C\.?)/i) ||
    trimmed.match(/(e\^x\s*\([^)]+\)\s*\+\s*C)/i) ||
    trimmed.match(/(=\s*e\^x[^.]+C)/i)

  let steps = filterSolutionSteps(paragraphToSteps(trimmed))
  if (steps.length === 0 && isMathRelevantText(trimmed)) {
    steps = [{ title: 'Step 1', content: trimmed }]
  }
  if (steps.length === 0) return null

  return {
    intro: problem?.trim() ? buildIntro(problem, method) : undefined,
    method: method || undefined,
    formula: formula || undefined,
    steps,
    final_answer: finalMatch?.[1]?.trim() || finalMatch?.[0]?.trim(),
  }
}

export function isSolvePrompt(prompt: string): boolean {
  const q = prompt.toLowerCase()
  return (
    /\b(solve|step by step|step-by-step|integrate|integral|antiderivative|derive|differentiate)\b/.test(q) ||
    q.includes('∫') ||
    /\\int/.test(q)
  )
}
