import { createShapeId, toRichText, type Editor } from 'tldraw'
import { tableCellColor } from './canvasTheme'

const CELL_W = 108
const CELL_H = 44

function tableOrigin(editor: Editor, rows: number, cols: number): { x: number; y: number } {
  const vp = editor.getViewportPageBounds()
  const w = cols * CELL_W
  const h = rows * CELL_H
  return { x: vp.x + vp.w / 2 - w / 2, y: vp.y + vp.h / 2 - h / 2 }
}

/** Insert an editable rows×cols table on the canvas (grouped geo cells). */
export function insertTableOnCanvas(editor: Editor, rows: number, cols: number, isDarkUi = false): void {
  const r = Math.max(1, Math.min(rows, 20))
  const c = Math.max(1, Math.min(cols, 20))
  const { x: baseX, y: baseY } = tableOrigin(editor, r, c)
  const ids: ReturnType<typeof createShapeId>[] = []

  for (let row = 0; row < r; row += 1) {
    for (let col = 0; col < c; col += 1) {
      const id = createShapeId()
      ids.push(id)
      editor.createShape({
        id,
        type: 'geo',
        x: baseX + col * CELL_W,
        y: baseY + row * CELL_H,
        meta: { scTableCell: true, scTableRow: row, scTableCol: col },
        props: {
          geo: 'rectangle',
          w: CELL_W,
          h: CELL_H,
          richText: toRichText(''),
          color: tableCellColor(isDarkUi),
          fill: 'semi',
          size: 's',
          dash: 'draw',
        },
      })
    }
  }

  if (ids.length > 1) {
    const prevTool = editor.getCurrentToolId()
    if (prevTool !== 'select') editor.setCurrentTool('select')
    editor.groupShapes(ids, { groupId: createShapeId(), select: true })
    if (prevTool !== 'select') editor.setCurrentTool(prevTool)
  } else if (ids.length === 1) {
    editor.select(ids[0])
  }

  editor.zoomToSelection({ animation: { duration: 350 } })
}
