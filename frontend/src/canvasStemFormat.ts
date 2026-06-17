import { createShapeId, toRichText, type Editor, type TLRichText, type TLShapeId } from 'tldraw'
import { getNextNotesOrigin } from './canvasSolution'
import { mathAnswerColor } from './canvasTheme'

export type ExplanationBlock = {
  label: string
  content: string
}

export type StemPayload = {
  blocks: ExplanationBlock[]
  tests: string[]
}

const LINE_GAP = { l: 46, m: 38, s: 30 } as const
const BLOCK_GAP = 32
const NOTES_W = 640

function toBoldRichText(text: string): TLRichText {
  return {
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{ type: 'text', text, marks: [{ type: 'bold' }] }],
    }],
  }
}

/** Lay out labeled explanation as separate detailed note lines on canvas. */
export function placeStemExplanationOnCanvas(
  editor: Editor,
  payload: StemPayload,
  isDarkUi: boolean,
  sectionTitle = 'Expected Explanation',
): TLShapeId[] {
  const blocks = payload.blocks.filter((b) => b.label.trim() || b.content.trim())
  const tests = payload.tests.filter((t) => t.trim())
  if (blocks.length === 0 && tests.length === 0) return []

  const ink = mathAnswerColor(isDarkUi)
  const accent = isDarkUi ? 'light-violet' : 'violet'
  const { x: baseX, y: startY } = getNextNotesOrigin(editor)
  let y = startY
  const ids: TLShapeId[] = []

  const addText = (richText: TLRichText, size: keyof typeof LINE_GAP, color = ink, indent = 0) => {
    const id = createShapeId()
    ids.push(id)
    editor.createShape({
      id,
      type: 'text',
      x: baseX + indent,
      y,
      props: { richText, size, color, font: 'sans', w: NOTES_W - indent },
    })
    y += LINE_GAP[size]
  }

  if (sectionTitle) {
    addText(toBoldRichText(sectionTitle), 'l', accent)
    y += 12
  }

  for (const block of blocks) {
    if (block.label.trim()) {
      addText(toBoldRichText(block.label.trim()), 'm', accent)
      y += 4
    }
    for (const line of block.content.trim().split(/\n+/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const isBullet = /^[•\-*○]/.test(trimmed) || /^(u|dv|du|v)\s*=/.test(trimmed)
      const text = isBullet ? trimmed.replace(/^[•\-*○]\s*/, '○ ') : trimmed
      addText(toRichText(text), 'm', ink, isBullet ? 28 : 0)
    }
    y += BLOCK_GAP
  }

  if (tests.length > 0) {
    y += 8
    addText(toBoldRichText('Tests:'), 'm', accent)
    for (const test of tests) {
      addText(toRichText(`○ ${test.trim()}`), 'm', ink, 20)
    }
  }

  if (ids.length > 0) {
    const prev = editor.getSelectedShapeIds()
    editor.select(...ids)
    editor.zoomToSelection({ animation: { duration: 450 } })
    editor.setSelectedShapes(prev)
  }

  return ids
}

export function parseStemFromResponse(data: {
  explanation_blocks?: Array<{ label?: string; content?: string }>
  tests?: string[]
} | null): StemPayload | null {
  if (!data) return null
  const blocks: ExplanationBlock[] = []
  for (const b of data.explanation_blocks ?? []) {
    const label = String(b?.label ?? '').trim()
    const content = String(b?.content ?? '').trim()
    if (label || content) blocks.push({ label, content })
  }
  const tests = (data.tests ?? []).map((t) => String(t).trim()).filter(Boolean)
  if (blocks.length === 0 && tests.length === 0) return null
  return { blocks, tests }
}

/** Fallback when the LLM returns prose instead of structured explanation_blocks. */
export function buildStemFromExplanation(text: string): StemPayload | null {
  const trimmed = text.trim()
  if (trimmed.length < 40) return null
  const blocks: ExplanationBlock[] = []
  const tests: string[] = []

  const boldRe = /\*\*([^*]+)\*\*[:\s]*([^\n*]+(?:\n(?!\*\*|Step\s*\d|Tests?:)[^\n]+)*)/gi
  let m: RegExpExecArray | null
  while ((m = boldRe.exec(trimmed)) !== null) {
    const label = m[1].trim().replace(/:$/, '')
    const content = m[2].trim()
    if (label && content.length > 3) blocks.push({ label, content })
  }

  if (blocks.length === 0) {
    const stepRe = /Step\s*(\d+)\s*[:.)]\s*([^\n]*)([\s\S]*?)(?=Step\s*\d+\s*[:.)]|Final\s*Answer|Quick\s*Check|Tests?:|$)/gi
    while ((m = stepRe.exec(trimmed)) !== null) {
      const title = m[2].trim()
      const content = m[3].trim()
      const label = title ? `Step ${m[1]}: ${title}` : `Step ${m[1]}`
      if (content) blocks.push({ label, content })
    }
  }

  if (blocks.length === 0) {
    const labelRe = /(?:^|\n)([A-Za-z][A-Za-z0-9*+\-/ ]{1,28}):\s*([^\n]+(?:\n(?![A-Za-z][^:\n]{1,28}:)[^\n]+)*)/g
    while ((m = labelRe.exec(trimmed)) !== null) {
      const label = m[1].trim()
      const content = m[2].trim()
      if (!/^(tests?|notes?)$/i.test(label) && content.length > 5) {
        blocks.push({ label, content })
      }
    }
  }

  if (blocks.length === 0) {
    const chunks = trimmed.split(/\n\s*\n/).map((c) => c.trim()).filter((c) => c.length > 30)
    chunks.slice(0, 6).forEach((chunk, i) => {
      const lines = chunk.split('\n')
      const first = lines[0]?.trim() ?? ''
      const rest = lines.slice(1).join('\n').trim()
      if (rest && first.length < 60) {
        blocks.push({ label: first.replace(/:$/, ''), content: rest })
      } else {
        blocks.push({ label: `Point ${i + 1}`, content: chunk })
      }
    })
  }

  const testMatch = trimmed.match(/Tests?:\s*([\s\S]*?)$/i)
  if (testMatch) {
    for (const line of testMatch[1].split('\n')) {
      const t = line.replace(/^[\s•\-*○]+/, '').trim()
      if (t.length > 2) tests.push(t)
    }
  }

  if (blocks.length === 0) return null
  return { blocks: blocks.slice(0, 6), tests: tests.slice(0, 6) }
}
