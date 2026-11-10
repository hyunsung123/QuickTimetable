export const holdDurationMs = 350;
export const pressMovementTolerance = 8;

/** One session per finger-down. A drag remains a drag after returning to origin,
 * even if snapping produces no time change. Used by native gesture callbacks. */
export class BlockPressSession {
  private dragged = false;
  reset() { this.dragged = false; }
  move(x: number, y: number) {
    this.dragged ||= Math.hypot(x, y) > pressMovementTolerance;
    return this.dragged;
  }
  releaseHold(durationMs: number, success: boolean) {
    return success && durationMs >= holdDurationMs && !this.dragged;
  }
  releaseTap(success: boolean) { return success && !this.dragged; }
}
