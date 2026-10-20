/**
 * Compares a program's actual output with an expected output the user supplied.
 *
 * Policy: line order, blank lines in the middle, leading spaces, and spacing between words all
 * matter. Only trailing spaces at the end of a line, line-ending style (CRLF or LF), and blank
 * lines at the very end are ignored. When outputs differ only in spacing, that is reported as a
 * mismatch with a note, never silently treated as a match.
 */
export type LineDiff = { line: number; expected: string | null; actual: string | null; same: boolean };
export type Comparison = { match: boolean; lines: LineDiff[]; firstMismatch: number | null; note: string | null };

export const COMPARISON_POLICY =
  "Compared line by line. Trailing spaces, line-ending style, and blank lines at the very end are ignored. Leading spaces, spacing between words, and blank lines in the middle count.";

export function normalizeLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function compareOutputs(actual: string, expected: string): Comparison {
  const a = normalizeLines(actual);
  const e = normalizeLines(expected);
  const lines: LineDiff[] = [];
  for (let i = 0; i < Math.max(a.length, e.length); i++) {
    const ex = i < e.length ? e[i] : null;
    const ac = i < a.length ? a[i] : null;
    lines.push({ line: i + 1, expected: ex, actual: ac, same: ex === ac });
  }
  const first = lines.find((l) => !l.same);
  const match = !first;
  let note: string | null = null;
  if (!match) {
    const tokens = (xs: string[]) => xs.join("\n").split(/\s+/).filter(Boolean).join(" ");
    if (tokens(a) === tokens(e)) note = "The values match, but spacing or line breaks differ. Those count, so check spaces between values and where lines break.";
    else if (a.length !== e.length) note = `Your program printed ${a.length} line${a.length === 1 ? "" : "s"}; the expected output has ${e.length}.`;
    else if (first && first.expected !== null && first.actual !== null && first.expected.trim() === first.actual.trim()) note = `Line ${first.line} differs only in leading spaces.`;
  }
  return { match, lines, firstMismatch: first?.line ?? null, note };
}
