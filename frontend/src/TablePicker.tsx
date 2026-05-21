import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Editor } from 'tldraw'
import { insertTableOnCanvas } from './canvasTable'

const GRID_COLS = 10
const GRID_ROWS = 8

type Props = {
  editor: Editor | null
  isDark: boolean
}

export function TablePicker({ editor, isDark }: Props) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState({ rows: 0, cols: 0 })
  const [customOpen, setCustomOpen] = useState(false)
  const [customRows, setCustomRows] = useState('4')
  const [customCols, setCustomCols] = useState('5')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setCustomOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const insert = (rows: number, cols: number) => {
    if (!editor) return
    insertTableOnCanvas(editor, rows, cols, isDark)
    setOpen(false)
    setCustomOpen(false)
    setHover({ rows: 0, cols: 0 })
  }

  const onCustomSubmit = (e: FormEvent) => {
    e.preventDefault()
    const rows = parseInt(customRows, 10)
    const cols = parseInt(customCols, 10)
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) return
    insert(rows, cols)
  }

  const label =
    hover.rows > 0 && hover.cols > 0 ? `${hover.cols}×${hover.rows} Table` : 'Insert table'

  return (
    <div className="table-picker-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`ws-btn ${open ? 'ws-btn-active' : ''}`}
        onClick={() => editor && setOpen(!open)}
        disabled={!editor}
        title="Insert table"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1" />
        </svg>
        Table
      </button>

      {open && (
        <div className={`table-picker-menu ${isDark ? 'table-picker-dark' : ''}`}>
          <p className="table-picker-label">{label}</p>
          <div
            className="table-picker-grid"
            onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
          >
            {Array.from({ length: GRID_ROWS }, (_, row) =>
              Array.from({ length: GRID_COLS }, (_, col) => {
                const r = row + 1
                const c = col + 1
                const active = r <= hover.rows && c <= hover.cols
                return (
                  <button
                    key={`${row}-${col}`}
                    type="button"
                    className={`table-picker-cell ${active ? 'table-picker-cell-active' : ''}`}
                    aria-label={`${c} by ${r} table`}
                    onMouseEnter={() => setHover({ rows: r, cols: c })}
                    onClick={() => insert(r, c)}
                  />
                )
              }),
            )}
          </div>
          <button
            type="button"
            className="table-picker-custom-toggle"
            onClick={() => setCustomOpen(!customOpen)}
          >
            Insert Table…
          </button>
          {customOpen && (
            <form className="table-picker-custom" onSubmit={onCustomSubmit}>
              <label>
                Rows
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={customRows}
                  onChange={(e) => setCustomRows(e.target.value)}
                />
              </label>
              <label>
                Columns
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={customCols}
                  onChange={(e) => setCustomCols(e.target.value)}
                />
              </label>
              <button type="submit">OK</button>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
