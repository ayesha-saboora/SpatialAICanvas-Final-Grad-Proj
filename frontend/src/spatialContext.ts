import {
  renderPlaintextFromRichText,
  type Editor,
  type TLAssetId,
  type TLShapeId,
} from 'tldraw'
import { compressDataUrl, resolveImageDataUrl } from './imageUtils'

export type CanvasShapeCtx = {
  id: string
  type: string
  label: string
  x: number
  y: number
  w: number
  h: number
  color?: string
  geo?: string
  isDocument?: boolean
  isTitle?: boolean
}

export type CanvasEdgeCtx = {
  label: string
  fromLabel: string
  toLabel: string
}

export type CanvasImageCtx = {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
  data_url?: string
  isPdfPage?: boolean
}

export type SpatialContext = {
  canvas_shapes: CanvasShapeCtx[]
  canvas_edges: CanvasEdgeCtx[]
  canvas_summary: string
  selected_shape_ids: string[]
  selected_labels: string[]
  document_text: string
  canvas_images: CanvasImageCtx[]
}

export type StoredDocument = {
  filename: string
  text: string
}

function richTextToPlain(editor: Editor, props: Record<string, unknown>): string {
  const rt = props.richText
  if (!rt) return ''
  try {
    return renderPlaintextFromRichText(
      editor,
      rt as Parameters<typeof renderPlaintextFromRichText>[1],
    ).trim()
  } catch {
    return ''
  }
}

function centerOf(bounds: { x: number; y: number; w: number; h: number }) {
  return { cx: bounds.x + bounds.w / 2, cy: bounds.y + bounds.h / 2 }
}

function nearestLabel(
  point: { cx: number; cy: number },
  nodes: { label: string; bounds: { x: number; y: number; w: number; h: number } }[],
): string {
  let best = ''
  let bestDist = Infinity
  for (const n of nodes) {
    if (!n.label) continue
    const c = centerOf(n.bounds)
    const d = (c.cx - point.cx) ** 2 + (c.cy - point.cy) ** 2
    if (d < bestDist) {
      bestDist = d
      best = n.label
    }
  }
  return best
}

/** Expand group selections into their labeled child shapes. */
export function resolveSelectionIds(editor: Editor, ids: string[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    const shape = editor.getShape(id as TLShapeId)
    if (!shape) continue
    if (shape.type === 'group') {
      for (const childId of editor.getSortedChildIdsForParent(id as TLShapeId)) {
        out.push(String(childId))
      }
    } else {
      out.push(String(id))
    }
  }
  return [...new Set(out)]
}

function buildCanvasSummary(
  titles: string[],
  conceptLabels: string[],
  edges: CanvasEdgeCtx[],
  docNames: string[],
  imageNames: string[],
): string {
  const parts: string[] = []
  if (titles.length) parts.push(`Main topic(s) on board: ${titles.join('; ')}`)
  if (conceptLabels.length) {
    parts.push(`Concepts/steps on board: ${conceptLabels.join(' → ')}`)
  }
  if (edges.length) {
    const flow = edges
      .filter((e) => e.fromLabel && e.toLabel)
      .slice(0, 12)
      .map((e) => `${e.fromLabel}${e.label ? ` --[${e.label}]--> ` : ' → '}${e.toLabel}`)
    if (flow.length) parts.push(`Process flow: ${flow.join('; ')}`)
  }
  if (docNames.length) parts.push(`Uploaded documents: ${docNames.join(', ')}`)
  if (imageNames.length) parts.push(`Images on board: ${imageNames.join(', ')}`)
  return parts.join('\n')
}

/** Snapshot canvas for AI — topics & flow, not raw shape inventory. */
export async function collectSpatialContext(
  editor: Editor,
  options: {
    pinnedSelectionIds?: string[]
    storedDocuments?: StoredDocument[]
  } = {},
): Promise<SpatialContext> {
  const canvas_shapes: CanvasShapeCtx[] = []
  const canvas_images: CanvasImageCtx[] = []
  const conceptNodes: {
    id: string
    label: string
    bounds: { x: number; y: number; w: number; h: number }
  }[] = []
  const titles: string[] = []
  const docNames: string[] = []
  const imageNames: string[] = []

  const currentSel = editor.getSelectedShapeIds().map(String)
  const selected_shape_ids = resolveSelectionIds(
    editor,
    currentSel.length > 0 ? currentSel : (options.pinnedSelectionIds ?? []),
  )

  const visitShape = (id: TLShapeId) => {
    const shape = editor.getShape(id)
    if (!shape || shape.type === 'group') return

    const bounds = editor.getShapePageBounds(id)
    if (!bounds) return

    const base = {
      id: String(id),
      type: shape.type,
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      w: Math.round(bounds.w),
      h: Math.round(bounds.h),
    }

    if (shape.type === 'geo' || shape.type === 'text') {
      const props = shape.props as unknown as Record<string, unknown>
      const label = richTextToPlain(editor, props)
      const meta = (shape.meta ?? {}) as Record<string, unknown>
      const isDocument = Boolean(meta.scDocument)
      const size = props.size as string | undefined
      const isTitle = size === 'xl' || size === 'l'

      if (isTitle && label) titles.push(label)
      if (label && !isDocument) {
        conceptNodes.push({ id: String(id), label, bounds })
      }
      if (isDocument && meta.scFilename) docNames.push(String(meta.scFilename))

      canvas_shapes.push({
        ...base,
        label: label.slice(0, 500),
        color: typeof props.color === 'string' ? props.color : undefined,
        geo: typeof props.geo === 'string' ? props.geo : undefined,
        isDocument,
        isTitle,
      })
    } else if (shape.type === 'arrow') {
      const props = shape.props as unknown as Record<string, unknown>
      const start = props.start as { x: number; y: number } | undefined
      const end = props.end as { x: number; y: number } | undefined
      if (start && end) {
        const ax = base.x + start.x
        const ay = base.y + start.y
        const bx = base.x + end.x
        const by = base.y + end.y
        canvas_shapes.push({
          ...base,
          label: `[arrow ${Math.round(ax)},${Math.round(ay)} → ${Math.round(bx)},${Math.round(by)}]`,
        })
      }
    } else if (shape.type === 'image') {
      const props = shape.props as unknown as Record<string, unknown>
      const meta = (shape.meta ?? {}) as Record<string, unknown>
      let name = 'image'
      let data_url: string | undefined
      const assetId = props.assetId
      if (assetId && typeof assetId === 'string') {
        const asset = editor.getAsset(assetId as TLAssetId)
        if (asset?.type === 'image') {
          name = asset.props.name || name
          const src = asset.props.src
          if (typeof src === 'string') {
            data_url = src.startsWith('data:') ? src : undefined
          }
        }
      }
      imageNames.push(name)
      canvas_images.push({
        ...base,
        name,
        isPdfPage: Boolean(meta.scPdfPage),
        ...(data_url ? { data_url } : {}),
      })
      canvas_shapes.push({ ...base, type: 'image', label: `[image: ${name}]` })
    }
  }

  for (const id of editor.getCurrentPageShapeIds()) {
    visitShape(id)
    for (const childId of editor.getSortedChildIdsForParent(id)) {
      visitShape(childId)
    }
  }

  const canvas_edges: CanvasEdgeCtx[] = []
  for (const s of canvas_shapes) {
    if (s.type !== 'arrow' || !s.label.startsWith('[arrow ')) continue
    const m = s.label.match(/\[arrow ([\d.-]+),([\d.-]+) → ([\d.-]+),([\d.-]+)\]/)
    if (!m) continue
    canvas_edges.push({
      label: '',
      fromLabel: nearestLabel(
        { cx: parseFloat(m[1]), cy: parseFloat(m[2]) },
        conceptNodes,
      ),
      toLabel: nearestLabel(
        { cx: parseFloat(m[3]), cy: parseFloat(m[4]) },
        conceptNodes,
      ),
    })
  }

  const conceptLabels = conceptNodes
    .filter((n) => !titles.includes(n.label))
    .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
    .map((n) => n.label)
    .slice(0, 20)

  const selected_labels = [
    ...conceptNodes
      .filter((n) => selected_shape_ids.includes(n.id))
      .map((n) => n.label),
    ...canvas_images
      .filter((img) => selected_shape_ids.includes(img.id))
      .map((img) => `[image: ${img.name}]`),
  ]

  const storedText = (options.storedDocuments ?? [])
    .map((d) => `--- ${d.filename} ---\n${d.text}`)
    .join('\n\n')

  const selected = new Set(selected_shape_ids)
  let visionImages = canvas_images.filter((img) => img.data_url || selected.has(img.id))
  visionImages.sort((a, b) => (selected.has(b.id) ? 1 : 0) - (selected.has(a.id) ? 1 : 0))
  visionImages = visionImages.slice(0, 3)

  const compressed: CanvasImageCtx[] = []
  for (const img of visionImages) {
    let src = img.data_url
    if (!src) {
      const shape = editor.getShape(img.id as TLShapeId)
      if (shape?.type === 'image') {
        const props = shape.props as unknown as { assetId?: string }
        if (props.assetId) {
          const asset = editor.getAsset(props.assetId as TLAssetId)
          if (asset?.type === 'image' && typeof asset.props.src === 'string') {
            src = await resolveImageDataUrl(asset.props.src)
          }
        }
      }
    }
    if (!src) continue
    try {
      compressed.push({ ...img, data_url: await compressDataUrl(src) })
    } catch {
      compressed.push({ ...img, data_url: src })
    }
  }

  return {
    canvas_shapes: canvas_shapes.filter((s) => s.type !== 'arrow').slice(0, 60),
    canvas_edges: canvas_edges.slice(0, 30),
    canvas_summary: buildCanvasSummary(titles, conceptLabels, canvas_edges, docNames, imageNames),
    selected_shape_ids,
    selected_labels,
    document_text: storedText.slice(0, 20000),
    canvas_images: compressed,
  }
}
