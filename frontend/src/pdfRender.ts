import * as pdfjs from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export type PdfPageImage = {
  pageNum: number
  dataUrl: string
  w: number
  h: number
}

/** Render PDF pages as JPEG images for display on the canvas (and optional vision). */
export async function renderPdfPages(file: File, maxPages = 10): Promise<PdfPageImage[]> {
  const data = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data }).promise
  const limit = Math.min(pdf.numPages, maxPages)
  const pages: PdfPageImage[] = []

  for (let i = 1; i <= limit; i += 1) {
    const page = await pdf.getPage(i)
    const scale = 1.4
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvasContext: ctx, viewport, canvas }).promise
    pages.push({
      pageNum: i,
      dataUrl: canvas.toDataURL('image/jpeg', 0.88),
      w: canvas.width,
      h: canvas.height,
    })
  }
  return pages
}
