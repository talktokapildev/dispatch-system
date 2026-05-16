/**
 * dispatchFlags.ts
 *
 * Prevents the driver app from showing a job offer for a booking the driver
 * just cancelled. When a driver cancels, the backend immediately frees them
 * and may re-dispatch the same booking. This flag blocks that specific booking
 * from appearing as a new offer for a short window.
 */

let _blockedBookingId: string | null = null;
let _blockTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Block a specific bookingId from being dispatched to this driver.
 * Auto-clears after `ttlMs` (default 30 s).
 */
export function blockBookingDispatch(bookingId: string, ttlMs = 30_000): void {
  _blockedBookingId = bookingId;
  if (_blockTimer) clearTimeout(_blockTimer);
  _blockTimer = setTimeout(() => {
    _blockedBookingId = null;
    _blockTimer = null;
  }, ttlMs);
}

/** Returns true if this bookingId should be silently ignored. */
export function isBookingBlocked(bookingId: string): boolean {
  return _blockedBookingId === bookingId;
}
