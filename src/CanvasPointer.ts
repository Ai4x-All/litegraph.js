import type { CanvasPointerEvent } from "./types/events"
import type { LGraphCanvas } from "./LGraphCanvas"
import { dist2 } from "./measure"

/**
 * Allows click and drag actions to be declared ahead of time during a pointerdown event.
 *
 * Depending on whether the user clicks or drags the pointer, only the appropriate callbacks are called:
 * - {@link onClick}
 * - {@link onDoubleClick}
 * - {@link onDragStart}
 * - {@link onDrag}
 * - {@link onDragEnd}
 * - {@link finally}
 *
 * @seealso
 * - {@link LGraphCanvas.processMouseDown}
 * - {@link LGraphCanvas.processMouseMove}
 * - {@link LGraphCanvas.processMouseUp}
 */
export class CanvasPointer {
  /** Maximum time in milliseconds to ignore click drift */
  static bufferTime = 150

  /** Maximum gap between pointerup and pointerdown events to be considered as a double click */
  static doubleClickTime = 300

  /** Maximum offset from click location */
  static get maxClickDrift() {
    return this.#maxClickDrift
  }
  static set maxClickDrift(value) {
    this.#maxClickDrift = value
    this.#maxClickDrift2 = value * value
  }
  static #maxClickDrift = 6
  /** {@link maxClickDrift} squared.  Used to calculate click drift without `sqrt`. */
  static #maxClickDrift2 = this.#maxClickDrift ** 2

  /** The element this PointerState should capture input against when dragging. */
  element: Element
  /** Pointer ID used by drag capture. */
  pointerId: number

  /** Set to true when if the pointer moves far enough after a down event, before the corresponding up event is fired. */
  dragStarted: boolean = false

  /** The {@link eUp} from the last successful click */
  eLastDown?: CanvasPointerEvent

  /** Used downstream for touch event support. */
  isDouble: boolean = false
  /** Used downstream for touch event support. */
  isDown: boolean = false

  /**
   * If `true`, {@link eDown}, {@link eMove}, and {@link eUp} will be set to
   * `null` when {@link reset} is called.
   *
   * Default: `true`
   */
  clearEventsOnReset: boolean = true

  /** The last pointerdown event for the primary button */
  eDown: CanvasPointerEvent | null = null
  /** The last pointermove event for the primary button */
  eMove: CanvasPointerEvent | null = null
  /** The last pointerup event for the primary button */
  eUp: CanvasPointerEvent | null = null

  /**
   * If set, as soon as the mouse moves outside the click drift threshold, this action is run once.
   * @param pointer This pointer instance.  Permits actions such as late binding of the finally() callback.
   */
  onDragStart?(pointer: this): unknown

  /**
   * Called on pointermove whilst dragging.
   * @param eMove The pointermove event of this ongoing drag action
   */
  onDrag?(eMove: CanvasPointerEvent): unknown

  /**
   * Called on pointerup after dragging (i.e. not called if clicked).
   * @param upEvent The pointerup or pointermove event that triggered this callback
   */
  onDragEnd?(upEvent: CanvasPointerEvent): unknown

  /**
   * Callback that will be run once, the next time a pointerup event appears to be a normal click.
   * @param upEvent The pointerup or pointermove event that triggered this callback
   */
  onClick?(upEvent: CanvasPointerEvent): unknown

  /**
   * Callback that will be run once, the next time a pointerup event appears to be a normal click.
   * @param upEvent The pointerup or pointermove event that triggered this callback
   */
  onDoubleClick?(upEvent: CanvasPointerEvent): unknown

  /**
   * Run-once callback, called at the end of any click or drag, whether or not it was successful in any way.
   *
   * The setter of this callback will call the existing value before replacing it.
   * Therefore, simply setting this value twice will execute the first callback.
   */
  get finally() {
    return this.#finally
  }
  set finally(value) {
    try {
      this.#finally?.()
    } finally {
      this.#finally = value
    }
  }
  #finally?: () => unknown

  constructor(element: Element) {
    this.element = element
  }

  /**
   * Callback for `pointerdown` events.  To be used as the event handler (or called by it).
   * @param e The `pointerdown` event
   */
  down(e: CanvasPointerEvent): void {
    this.reset()
    this.eDown = e
    this.pointerId = e.pointerId
    this.element.setPointerCapture(e.pointerId)
  }

  /**
   * Callback for `pointermove` events.  To be used as the event handler (or called by it).
   * @param e The `pointermove` event
   */
  move(e: CanvasPointerEvent): void {
    const { eDown } = this
    if (!eDown) return

    // No buttons down, but eDown exists - clean up & leave
    if (!e.buttons) {
      this.reset()
      return
    }

    // Primary button released - treat as pointerup.
    if (!(e.buttons & eDown.buttons)) {
      this.#completeClick(e)
      this.reset()
      return
    }
    this.eMove = e
    this.onDrag?.(e)

    // Dragging, but no callback to run
    if (this.dragStarted) return

    const longerThanBufferTime = e.timeStamp - eDown.timeStamp > CanvasPointer.bufferTime
    if (longerThanBufferTime || !this.#hasSamePosition(e, eDown)) {
      this.#setDragStarted()
    }
  }

  /**
   * Callback for `pointerup` events.  To be used as the event handler (or called by it).
   * @param e The `pointerup` event
   */
  up(e: CanvasPointerEvent): boolean {
    if (e.button !== this.eDown?.button) return false

    this.#completeClick(e)
    const { dragStarted } = this
    this.reset()
    return !dragStarted
  }

  #completeClick(e: CanvasPointerEvent): void {
    const { eDown } = this
    if (!eDown) return

    this.eUp = e

    if (this.dragStarted) {
      // A move event already started drag
      this.onDragEnd?.(e)
    } else if (!this.#hasSamePosition(e, eDown)) {
      // Teleport without a move event (e.g. tab out, move, tab back)
      this.#setDragStarted()
      this.onDragEnd?.(e)
    } else if (this.onDoubleClick && this.#isDoubleClick()) {
      // Double-click event
      this.onDoubleClick(e)
      this.eLastDown = undefined
    } else {
      // Normal click event
      this.onClick?.(e)
      this.eLastDown = eDown
    }
  }

  /**
   * Checks if two events occurred near each other - not further apart than the maximum click drift.
   * @param a The first event to compare
   * @param b The second event to compare
   * @param tolerance2 The maximum distance (squared) before the positions are considered different
   * @returns `true` if the two events were no more than {@link maxClickDrift} apart, otherwise `false`
   */
  #hasSamePosition(
    a: PointerEvent,
    b: PointerEvent,
    tolerance2 = CanvasPointer.#maxClickDrift2,
  ): boolean {
    const drift = dist2(a.clientX, a.clientY, b.clientX, b.clientY)
    return drift <= tolerance2
  }

  /**
   * Checks whether the pointer is currently past the max click drift threshold.
   * @param e The latest pointer event
   * @returns `true` if the latest pointer event is past the the click drift threshold
   */
  #isDoubleClick(): boolean {
    const { eDown, eLastDown } = this
    if (!eDown || !eLastDown) return false

    // Use thrice the drift distance for double-click gap
    const tolerance2 = (3 * CanvasPointer.#maxClickDrift) ** 2
    const diff = eDown.timeStamp - eLastDown.timeStamp
    return diff > 0 &&
      diff < CanvasPointer.doubleClickTime &&
      this.#hasSamePosition(eDown, eLastDown, tolerance2)
  }

  #setDragStarted(): void {
    this.dragStarted = true
    this.onDragStart?.(this)
    delete this.onDragStart
  }

  /**
   * Resets the state of this {@link CanvasPointer} instance.
   *
   * The {@link finally} callback is first executed, then all callbacks and intra-click
   * state is cleared.
   */
  reset(): void {
    // The setter executes the callback before clearing it
    this.finally = undefined
    delete this.onClick
    delete this.onDoubleClick
    delete this.onDragStart
    delete this.onDrag
    delete this.onDragEnd

    this.isDown = false
    this.isDouble = false
    this.dragStarted = false

    if (this.clearEventsOnReset) {
      this.eDown = null
      this.eMove = null
      this.eUp = null
    }

    const { element, pointerId } = this
    if (element.hasPointerCapture(pointerId))
      element.releasePointerCapture(pointerId)
  }
}