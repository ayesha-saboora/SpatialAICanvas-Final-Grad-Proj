import {
  DefaultColorStyle,
  NoteShapeUtil,
  onDragFromToolbarToCreateShape,
  startEditingShapeWithRichText,
  type Editor,
  type TLComponents,
  type TLUiOverrides,
} from 'tldraw'
import { StudyCanvasToolbar, ToolColorBar } from './canvasToolbar'
import {
  ensureVisibleNoteColor,
  ensureVisibleStrokeColor,
  type CanvasUiTheme,
} from './canvasTheme'
import { ResizableNoteShapeTool } from './resizableNoteTool'

let canvasUiTheme: CanvasUiTheme = 'light'

export function setCanvasUiTheme(theme: CanvasUiTheme): void {
  canvasUiTheme = theme
}

export const STUDY_CANVAS_SHAPE_UTILS = [
  NoteShapeUtil.configure({ resizeMode: 'scale' }),
]

export const STUDY_CANVAS_TOOLS = [ResizableNoteShapeTool]

export const STUDY_CANVAS_COMPONENTS: TLComponents = {
  Toolbar: StudyCanvasToolbar,
  InFrontOfTheCanvas: ToolColorBar,
}

export const STUDY_CANVAS_OVERRIDES: TLUiOverrides = {
  tools(editor, tools) {
    delete tools.rectangle

    const draw = tools.draw
    if (draw) {
      const selectDraw = draw.onSelect.bind(draw)
      draw.onSelect = (source) => {
        ensureVisibleStrokeColor(editor, canvasUiTheme)
        selectDraw(source)
      }
    }

    const arrow = tools.arrow
    if (arrow) {
      const selectArrow = arrow.onSelect.bind(arrow)
      arrow.onSelect = (source) => {
        ensureVisibleStrokeColor(editor, canvasUiTheme)
        selectArrow(source)
      }
    }

    const note = tools.note
    if (note) {
      const selectNote = note.onSelect.bind(note)
      note.onSelect = (source) => {
        ensureVisibleNoteColor(editor)
        selectNote(source)
      }
      note.onDragStart = (_source, info) => {
        ensureVisibleNoteColor(editor)
        const scale = editor.getResizeScaleFactor()
        const color = editor.getStyleForNextShape(DefaultColorStyle) ?? 'yellow'
        onDragFromToolbarToCreateShape(editor, info, {
          createShape: (id) => editor.createShape({ id, type: 'note', props: { scale, color } }),
          onDragEnd: (id) => startEditingShapeWithRichText(editor, id, { selectAll: true }),
        })
      }
    }

    return tools
  },
}

export function setupStudyCanvasEditor(editor: Editor, theme: CanvasUiTheme = 'light'): void {
  canvasUiTheme = theme
  ensureVisibleStrokeColor(editor, theme)
}
