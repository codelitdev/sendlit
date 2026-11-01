/** The tallest an insert menu gets. */
const MENU_HEIGHT = 400;
const EDGE_GAP = 32;
/** The editor's own top bar and mode switch sit above the canvas. */
const TOP_CHROME = 60;

export interface MenuPlacement {
  up: boolean;
  /** Room on the chosen side, so the menu scrolls instead of leaving the window. */
  maxHeight: number;
}

/** Open a menu on whichever side of its anchor has more room, and cap its
 * height to that room. */
export function placeMenu(anchor: Element | null | undefined): MenuPlacement {
  if (!anchor || typeof window === "undefined") {
    return { up: false, maxHeight: MENU_HEIGHT };
  }
  const rect = anchor.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - EDGE_GAP;
  const above = rect.top - TOP_CHROME;
  const up = below < MENU_HEIGHT && above > below;
  return { up, maxHeight: Math.max(160, Math.min(MENU_HEIGHT, up ? above : below)) };
}
