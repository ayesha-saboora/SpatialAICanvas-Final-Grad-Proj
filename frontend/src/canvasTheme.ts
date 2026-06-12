import { DefaultColorStyle, type Editor } from 'tldraw'

/** Canvas board stays light so strokes/text remain visible in both UI themes. */
export const CANVAS_BOARD_COLOR = '#ffffff'

export type TldrawColor =
  | 'black' | 'blue' | 'green' | 'red' | 'orange' | 'violet' | 'yellow' | 'grey'
  | 'light-blue' | 'light-green' | 'light-red' | 'light-violet' | 'white'

const INVISIBLE_STROKE_ON_LIGHT = new Set<TldrawColor>([
  'white', 'light-violet', 'light-blue', 'light-green', 'light-red', 'yellow',
])

const NOTE_COLORS = new Set<TldrawColor>([
  'yellow', 'orange', 'light-red', 'light-blue', 'light-green', 'light-violet', 'white',
])

/** Pen and arrow strokes must be dark enough to see on the white board. */
export function ensureVisibleStrokeColor(editor: Editor): void {
  const current = editor.getStyleForNextShape(DefaultColorStyle) as TldrawColor | undefined
  if (!current || INVISIBLE_STROKE_ON_LIGHT.has(current)) {
    editor.setStyleForNextShapes(DefaultColorStyle, 'black')
  }
}

/** Sticky notes default to yellow when stroke color is not a note fill color. */
export function ensureVisibleNoteColor(editor: Editor): void {
  const current = editor.getStyleForNextShape(DefaultColorStyle) as TldrawColor | undefined
  if (!current || !NOTE_COLORS.has(current)) {
    editor.setStyleForNextShapes(DefaultColorStyle, 'yellow')
  }
}

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
