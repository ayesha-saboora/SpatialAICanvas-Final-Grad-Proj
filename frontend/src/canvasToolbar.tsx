import { memo, useCallback, useMemo } from 'react'
import {
  ArrowToolbarItem,
  AssetToolbarItem,
  DefaultColorStyle,
  DefaultToolbar,
  DrawToolbarItem,
  EraserToolbarItem,
  HandToolbarItem,
  NoteToolbarItem,
  SelectToolbarItem,
  TextToolbarItem,
  getColorValue,
  getDefaultColorTheme,
  useEditor,
  useValue,
  type TLDefaultColorStyle,
} from 'tldraw'

const STROKE_COLORS: TLDefaultColorStyle[] = [
  'black', 'blue', 'red', 'green', 'violet', 'orange',
]

const NOTE_COLORS: TLDefaultColorStyle[] = [
  'yellow', 'orange', 'light-red', 'light-blue', 'light-green', 'light-violet', 'white',
]

function useActiveToolId() {
  const editor = useEditor()
  return useValue('active tool', () => editor.getCurrentToolId(), [editor])
}

/** Bottom toolbar — no rectangle/geo shapes in the main strip. */
export function StudyCanvasToolbar() {
  return (
    <DefaultToolbar maxItems={9}>
      <SelectToolbarItem />
      <HandToolbarItem />
      <DrawToolbarItem />
      <EraserToolbarItem />
      <ArrowToolbarItem />
      <TextToolbarItem />
      <NoteToolbarItem />
      <AssetToolbarItem />
    </DefaultToolbar>
  )
}

/** Color swatches shown above the toolbar for pen, arrow, and sticky note. */
export const ToolColorBar = memo(function ToolColorBar() {
  const editor = useEditor()
  const activeTool = useActiveToolId()
  const theme = getDefaultColorTheme({ isDarkMode: false })

  const mode = activeTool === 'note' ? 'note' : activeTool === 'draw' || activeTool === 'arrow' ? 'stroke' : null
  const palette = mode === 'note' ? NOTE_COLORS : STROKE_COLORS

  const currentColor = useValue(
    'tool color',
    () => editor.getStyleForNextShape(DefaultColorStyle) ?? (mode === 'note' ? 'yellow' : 'black'),
    [editor, mode],
  )

  const pickColor = useCallback(
    (color: TLDefaultColorStyle) => {
      editor.setStyleForNextShapes(DefaultColorStyle, color)
    },
    [editor],
  )

  const label = useMemo(() => {
    if (mode === 'note') return 'Sticky note color'
    if (mode === 'stroke') return activeTool === 'draw' ? 'Pen color' : 'Arrow color'
    return ''
  }, [mode, activeTool])

  if (!mode) return null

  return (
    <div className="tool-color-bar" role="toolbar" aria-label={label}>
      <span className="tool-color-bar-label">{label}</span>
      <div className="tool-color-bar-swatches">
        {palette.map((color) => {
          const selected = currentColor === color
          return (
            <button
              key={color}
              type="button"
              className={`tool-color-swatch${selected ? ' tool-color-swatch-active' : ''}`}
              title={color.replace(/-/g, ' ')}
              aria-label={color.replace(/-/g, ' ')}
              aria-pressed={selected}
              style={{ background: getColorValue(theme, color, 'solid') }}
              onClick={() => pickColor(color)}
            />
          )
        })}
      </div>
    </div>
  )
})
