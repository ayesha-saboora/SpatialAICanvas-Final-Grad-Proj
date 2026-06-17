import { DefaultColorStyle, type Editor } from 'tldraw'

export type CanvasUiTheme = 'light' | 'dark'

export const CANVAS_BOARD_LIGHT = '#f9f8f4'
export const CANVAS_BOARD_DARK = '#0e0c16'

export type TldrawColor =
  | 'black' | 'blue' | 'green' | 'red' | 'orange' | 'violet' | 'yellow' | 'grey'
  | 'light-blue' | 'light-green' | 'light-red' | 'light-violet' | 'white'

const INVISIBLE_ON_LIGHT = new Set<TldrawColor>([
  'white', 'light-violet', 'light-blue', 'light-green', 'light-red', 'yellow',
])

const INVISIBLE_ON_DARK = new Set<TldrawColor>([
  'black', 'grey',
])

const NOTE_COLORS = new Set<TldrawColor>([
  'yellow', 'orange', 'light-red', 'light-blue', 'light-green', 'light-violet', 'white',
])

const STROKE_SHAPE_TYPES = new Set(['arrow', 'line', 'draw', 'highlight', 'geo', 'text'])

const TO_DARK: Partial<Record<TldrawColor, TldrawColor>> = {
  black: 'white',
  grey: 'light-violet',
  blue: 'light-blue',
  green: 'light-green',
  red: 'light-red',
  violet: 'light-violet',
  orange: 'yellow',
}

const TO_LIGHT: Partial<Record<TldrawColor, TldrawColor>> = {
  white: 'black',
  'light-violet': 'violet',
  'light-blue': 'blue',
  'light-green': 'green',
  'light-red': 'red',
  yellow: 'orange',
}

export function defaultStrokeColor(theme: CanvasUiTheme): TldrawColor {
  return theme === 'dark' ? 'white' : 'black'
}

export function ensureVisibleStrokeColor(editor: Editor, theme: CanvasUiTheme = 'light'): void {
  const current = editor.getStyleForNextShape(DefaultColorStyle) as TldrawColor | undefined
  const invisible = theme === 'dark' ? INVISIBLE_ON_DARK : INVISIBLE_ON_LIGHT
  if (!current || invisible.has(current)) {
    editor.setStyleForNextShapes(DefaultColorStyle, defaultStrokeColor(theme))
  }
}

export function ensureVisibleNoteColor(editor: Editor): void {
  const current = editor.getStyleForNextShape(DefaultColorStyle) as TldrawColor | undefined
  if (!current || !NOTE_COLORS.has(current)) {
    editor.setStyleForNextShapes(DefaultColorStyle, 'yellow')
  }
}

export function diagramArrowColor(isDarkUi: boolean): TldrawColor {
  return isDarkUi ? 'light-blue' : 'black'
}

export function diagramTitleColor(isDarkUi: boolean): TldrawColor {
  return isDarkUi ? 'white' : 'black'
}

export function diagramEdgeLabelColor(isDarkUi: boolean): TldrawColor {
  return isDarkUi ? 'light-violet' : 'blue'
}

export function tableCellColor(isDarkUi: boolean): TldrawColor {
  return isDarkUi ? 'white' : 'black'
}

export function mathAnswerColor(isDarkUi: boolean): TldrawColor {
  return isDarkUi ? 'white' : 'black'
}

/** Remap stroke/text colors when switching light ↔ dark canvas theme. */
export function applyCanvasTheme(editor: Editor, theme: CanvasUiTheme): void {
  ensureVisibleStrokeColor(editor, theme)
  const map = theme === 'dark' ? TO_DARK : TO_LIGHT

  for (const id of editor.getCurrentPageShapeIds()) {
    const visit = (shapeId: typeof id) => {
      const shape = editor.getShape(shapeId)
      if (!shape) return
      if (shape.type === 'group') {
        for (const childId of editor.getSortedChildIdsForParent(shapeId)) visit(childId)
        return
      }
      if (!STROKE_SHAPE_TYPES.has(shape.type)) return
      const props = shape.props as { color?: TldrawColor }
      const current = props.color
      if (!current) return
      const next = map[current]
      if (!next || next === current) return
      editor.updateShape({
        id: shapeId,
        type: shape.type,
        props: { color: next },
      } as Parameters<Editor['updateShape']>[0])
    }
    visit(id)
    for (const childId of editor.getSortedChildIdsForParent(id)) visit(childId)
  }
}

/** @deprecated use applyCanvasTheme */
export function restoreCanvasContrastForLightBoard(editor: Editor): void {
  applyCanvasTheme(editor, 'light')
}
