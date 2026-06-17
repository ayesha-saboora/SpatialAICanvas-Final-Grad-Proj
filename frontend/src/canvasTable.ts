import { createShapeId, toRichText, type Editor, type TLShapeId } from 'tldraw'
import { tableCellColor } from './canvasTheme'

const CELL_W = 108
const CELL_H = 44

function tableOrigin(editor: Editor, rows: number, cols: number): { x: number; y: number } {
  const vp = editor.getViewportPageBounds()
  const w = cols * CELL_W
  const h = rows * CELL_H
  return { x: vp.x + vp.w / 2 - w / 2, y: vp.y + vp.h / 2 - h / 2 }
}

/** Insert an editable rows×cols table on the canvas (ungrouped cells in a frame). */
export function insertTableOnCanvas(editor: Editor, rows: number, cols: number, isDarkUi = false): void {
  const r = Math.max(1, Math.min(rows, 20))
  const c = Math.max(1, Math.min(cols, 20))
  const { x: baseX, y: baseY } = tableOrigin(editor, r, c)
  const tableId = `tbl_${Date.now()}`
  const cellIds: TLShapeId[] = []

  const prevTool = editor.getCurrentToolId()
  if (prevTool !== 'select') editor.setCurrentTool('select')

  for (let row = 0; row < r; row += 1) {
    for (let col = 0; col < c; col += 1) {
      const id = createShapeId()
      cellIds.push(id)
      const isHeader = row === 0
      editor.createShape({
        id,
        type: 'geo',
        x: baseX + col * CELL_W,
        y: baseY + row * CELL_H,
        meta: {
          scTableCell: true,
          scTableId: tableId,
          scTableRow: row,
          scTableCol: col,
          scTableRows: r,
          scTableCols: c,
        },
        props: {
          geo: 'rectangle',
          w: CELL_W,
          h: CELL_H,
          richText: toRichText(isHeader ? `Col ${col + 1}` : ''),
          color: tableCellColor(isDarkUi),
          fill: isHeader ? 'solid' : 'semi',
          size: 's',
          dash: 'draw',
          font: isHeader ? 'draw' : 'draw',
        },
      })
    }
  }

  const frameId = createShapeId()
  editor.createShape({
    id: frameId,
    type: 'frame',
    x: baseX - 8,
    y: baseY - 28,
    props: {
      w: c * CELL_W + 16,
      h: r * CELL_H + 36,
      name: `${c}×${r} Table`,
    },
    meta: { scTableFrame: true, scTableId: tableId },
  })

  editor.reparentShapes(cellIds, frameId)
  editor.select(frameId)
  editor.zoomToSelection({ animation: { duration: 250 } })

  // Open first data cell for immediate typing (row 1 if header row exists, else row 0).
  const editCell = cellIds[r > 1 ? c : 0]
  if (editCell) {
    window.setTimeout(() => {
      editor.select(editCell)
      editor.setEditingShape(editCell)
    }, 280)
  }

  if (prevTool !== 'select') editor.setCurrentTool(prevTool)
}
