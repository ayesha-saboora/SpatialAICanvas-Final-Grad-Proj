import {
  StateNode,
  Vec,
  createShapeId,
  DefaultColorStyle,
  maybeSnapToGrid,
  NoteShapeTool,
  startEditingShapeWithRichText,
  type TLPointerEventInfo,
  type TLStateNodeConstructor,
} from 'tldraw'

class ResizableNoteIdle extends StateNode {
  static override id = 'idle'

  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition('pointing', info)
  }

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  override onCancel() {
    this.editor.setCurrentTool('select')
  }
}

class ResizableNotePointing extends StateNode {
  static override id = 'pointing'

  info = {} as TLPointerEventInfo

  override onEnter(info: TLPointerEventInfo) {
    this.info = info
  }

  override onPointerMove(info: TLPointerEventInfo) {
    if (!this.editor.inputs.getIsDragging()) return

    const originPagePoint = this.editor.inputs.getOriginPagePoint()
    const id = createShapeId()
    const creatingMarkId = this.editor.markHistoryStoppingPoint(`creating_note:${id}`)
    const color = this.editor.getStyleForNextShape(DefaultColorStyle) ?? 'yellow'
    const scale = 0.05 * this.editor.getResizeScaleFactor()
    const newPoint = maybeSnapToGrid(originPagePoint, this.editor)

    this.editor.createShape({
      id,
      type: 'note',
      x: newPoint.x,
      y: newPoint.y,
      props: { scale, color },
    })
    this.editor.select(id)

    this.editor.setCurrentTool('select.resizing', {
      ...info,
      target: 'selection',
      handle: 'bottom_right',
      isCreating: true,
      creatingMarkId,
      creationCursorOffset: { x: 1, y: 1 },
      onInteractionEnd: 'note',
      onCreate: () => {
        startEditingShapeWithRichText(this.editor, id, { selectAll: true })
      },
    })
  }

  override onPointerUp() {
    this.complete()
  }

  override onCancel() {
    this.parent.transition('idle')
  }

  override onComplete() {
    this.complete()
  }

  override onInterrupt() {
    this.parent.transition('idle')
  }

  private complete() {
    const originPagePoint = this.editor.inputs.getOriginPagePoint()
    const id = createShapeId()
    this.editor.markHistoryStoppingPoint(`creating_note:${id}`)
    const scale = this.editor.getResizeScaleFactor()
    const color = this.editor.getStyleForNextShape(DefaultColorStyle) ?? 'yellow'

    this.editor.createShape({
      id,
      type: 'note',
      x: originPagePoint.x,
      y: originPagePoint.y,
      props: { scale, color },
    })

    const shape = this.editor.getShape(id)
    if (!shape) {
      this.parent.transition('idle')
      return
    }

    this.editor.select(id)
    const bounds = this.editor.getShapeGeometry(shape).bounds
    const newPoint = maybeSnapToGrid(
      new Vec(shape.x - bounds.width / 2, shape.y - bounds.height / 2),
      this.editor,
    )
    this.editor.updateShape({ id, type: 'note', x: newPoint.x, y: newPoint.y })

    if (this.editor.getInstanceState().isToolLocked) {
      this.parent.transition('idle')
    } else {
      startEditingShapeWithRichText(this.editor, id, { info: this.info })
    }
  }
}

/** Note tool with drag-to-resize on canvas (replaces default note pointing). */
export class ResizableNoteShapeTool extends NoteShapeTool {
  static override children(): TLStateNodeConstructor[] {
    return [ResizableNoteIdle, ResizableNotePointing]
  }
}
