export interface HorizontalSpan {
  left: number;
  width: number;
}

export const SEARCH_MAX_REM = 28; // matches max-w-md (448px at 16px base)
export const SEARCH_DEFAULT_MAX_WIDTH = 448;
export const SEARCH_SIDE_GAP = 8;

export interface SearchBarFrame {
  left: number;
  width: number;
}

/**
 * Computes the horizontal position and width (relative to `header.left`) for the TitleBar search bar.
 * Centers over the active `main` editor workspace when present, while clamping strictly between `left`
 * and `right` titlebar controls so it never overlaps menus, Update pill, or window buttons.
 */
export function computeSearchBarFrame(args: {
  header: HorizontalSpan;
  left: HorizontalSpan;
  right: HorizontalSpan;
  main: HorizontalSpan | null;
  maxWidth?: number;
}): SearchBarFrame {
  const { header, left, right, main, maxWidth = SEARCH_DEFAULT_MAX_WIDTH } = args;
  if (header.width <= 0) return { left: 0, width: 0 };

  const safeLeft = Math.max(0, left.left + left.width - header.left + SEARCH_SIDE_GAP);
  const safeRight = Math.min(header.width, right.left - header.left - SEARCH_SIDE_GAP);
  const available = Math.max(0, safeRight - safeLeft);
  const width = Math.min(Math.max(0, maxWidth), available);

  const desiredCenter =
    main && main.width > 0 ? main.left + main.width / 2 - header.left : header.width / 2;
  const maxLeft = Math.max(safeLeft, safeRight - width);
  const clampedLeft = Math.min(Math.max(desiredCenter - width / 2, safeLeft), maxLeft);

  return {
    left: Math.round(clampedLeft * 10) / 10,
    width: Math.round(width * 10) / 10
  };
}
