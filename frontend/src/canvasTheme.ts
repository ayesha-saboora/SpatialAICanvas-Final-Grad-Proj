import type { Editor } from 'tldraw'

/** Canvas board stays light so strokes/text remain visible in both UI themes. */
export const CANVAS_BOARD_COLOR = '#ffffff'

export type TldrawColor =
  | 'black' | 'blue' | 'green' | 'red' | 'orange' | 'violet' | 'yellow' | 'grey'
  | 'light-blue' | 'light-green' | 'light-red' | 'light-violet' | 'white'

const LIGHT_STROKE_MAP: Partial<Record<TldrawColor, TldrawColor>> = {
  white: 'black',
  'light-violet': 'violet',
  'light-blue': 'blue',
  'light-green': 'green',
  'light-red': 'red',
  yellow: 'orange',
}

const STROKE_SHAPE_TYPES = new Set(['arrow', 'line', 'draw', 'highlight'])

export function diagramArrowColor(_isDarkUi: boolean): TldrawColor {
  return 'black'
}

export function diagramTitleColor(_isDarkUi: boolean): TldrawColor {
  return 'black'
}

export function diagramEdgeLabelColor(_isDarkUi: boolean): TldrawColor {
  return 'blue'
}

export function tableCellColor(_isDarkUi: boolean): TldrawColor {
  return 'black'
}

/** On a light canvas board, remap light strokes back to dark for visibility. */
export function restoreCanvasContrastForLightBoard(editor: Editor): void {
  const ids = [...editor.getCurrentPageShapeIds()]
  if (ids.length === 0) return

  for (const id of ids) {
    const shape = editor.getShape(id)
    if (!shape || !STROKE_SHAPE_TYPES.has(shape.type)) continue
    const props = shape.props as { color?: TldrawColor }
    const current = props.color
    if (!current) continue
    const next = LIGHT_STROKE_MAP[current]
    if (!next || next === current) continue
    editor.updateShape({
      id,
      type: shape.type,
      props: { color: next },
    } as Parameters<Editor['updateShape']>[0])
  }
}
