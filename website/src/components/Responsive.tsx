import type { ReactNode } from "react";

/**
 * Shows `short` on phones (below 640px) and `full` from 640px up.
 * Only one is displayed (the other is display:none), so screen readers read just the visible one.
 */
export function PhoneText({ full, short }: { full: ReactNode; short: ReactNode }) {
  return (
    <>
      <span className="hidden sm:inline">{full}</span>
      <span className="sm:hidden">{short}</span>
    </>
  );
}
