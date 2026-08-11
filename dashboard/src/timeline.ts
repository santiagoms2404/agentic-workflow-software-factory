// Minimum-width, non-overlap geometry adapted from the MIT-licensed Super Simple Software Factory visualizer.
export interface TimelineItem {
  id: string;
  start: number;
  end: number;
}

export interface TimelineRange {
  start: number;
  end: number;
  leadingZonePercent?: number;
  minimumWidthPercent?: number;
}

export interface TimelineGeometry {
  left: number;
  width: number;
}

/**
 * Gives sequential evidence readable minimum widths without allowing widened
 * blocks to overlap. Gaps shrink before blocks; widths never cross the floor
 * while the requested number of blocks can mathematically fit the track.
 */
export function layoutTimeline(
  items: readonly TimelineItem[],
  range: TimelineRange,
): Record<string, TimelineGeometry> {
  const zone = Math.max(0, Math.min(40, range.leadingZonePercent ?? 0));
  const minimum = Math.max(0.5, range.minimumWidthPercent ?? 3.5);
  const available = 100 - zone - 0.4;
  const span = Math.max(1, range.end - range.start);
  const ordered = items
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end))
    .map((item) => ({
      ...item,
      rawLeft: Math.max(0, ((item.start - range.start) / span) * available),
      rawWidth: Math.max(0, ((Math.max(item.end, item.start) - item.start) / span) * available),
    }))
    .toSorted((left, right) => left.start - right.start || left.id.localeCompare(right.id));
  if (ordered.length === 0) return {};

  const widths = ordered.map((item) => Math.max(minimum, item.rawWidth));
  const gaps: number[] = [];
  let previousRawEdge = 0;
  for (const item of ordered) {
    gaps.push(Math.max(0, item.rawLeft - previousRawEdge));
    previousRawEdge = Math.max(previousRawEdge, item.rawLeft + item.rawWidth);
  }

  const widthTotal = widths.reduce((sum, value) => sum + value, 0);
  const gapTotal = gaps.reduce((sum, value) => sum + value, 0);
  if (widthTotal > available) {
    const floorTotal = minimum * ordered.length;
    const distributable = Math.max(0, available - floorTotal);
    const excess = widths.map((width) => Math.max(0, width - minimum));
    const excessTotal = excess.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < widths.length; index += 1) {
      widths[index] = minimum + (excessTotal === 0 ? 0 : distributable * excess[index]! / excessTotal);
    }
    gaps.fill(0);
  } else if (widthTotal + gapTotal > available && gapTotal > 0) {
    const gapScale = (available - widthTotal) / gapTotal;
    for (let index = 0; index < gaps.length; index += 1) gaps[index] = gaps[index]! * gapScale;
  }

  const result: Record<string, TimelineGeometry> = {};
  let cursor = zone;
  for (let index = 0; index < ordered.length; index += 1) {
    cursor += gaps[index] ?? 0;
    const width = Math.max(0, widths[index] ?? minimum);
    result[ordered[index]!.id] = { left: cursor, width };
    cursor += width;
  }
  return result;
}
