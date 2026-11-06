export interface PlanRowSpan {
  readonly rowStart: number;
  readonly rowEnd: number;
}

/** Locate the parser's list row around one status token, or the enclosing bare line. */
export function planRowSpan(source: string, tokenStart: number, tokenEnd: number): PlanRowSpan {
  const opening = [...source.slice(0, tokenStart).matchAll(/<li\b[^>]*>/gu)].at(-1)?.index ?? -1;
  const previousClose = source.lastIndexOf("</li>", tokenStart);
  const closing = source.indexOf("</li>", tokenEnd);
  const inRow = opening > previousClose && closing !== -1;
  const rowStart = inRow ? opening : source.lastIndexOf("\n", tokenStart) + 1;
  const newline = source.indexOf("\n", tokenEnd);
  const rowEnd = inRow ? closing + "</li>".length : newline === -1 ? source.length : newline;
  return { rowStart, rowEnd };
}
