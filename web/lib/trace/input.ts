/**
 * Replays recorded input operations over the program's real stdin. The tracer recorded every
 * Scanner, BufferedReader, StringTokenizer, and parse call that user code made, in order, with
 * its actual return value or the exception that escaped it. This file only works out where in the
 * input each call read from, using Java's rules, and checks that against the real result. When the
 * two disagree, the position is marked unavailable instead of guessed.
 */
export type IoEvent = {
  seq: number;
  cls: string;
  op: string;
  receiver: number | null;
  args: (string | null)[];
  file: string | null;
  line: number;
  step: number;
  ok: boolean;
  result?: string | null;
  type?: string;
  error?: { type: string; message: string | null };
  text?: string | null;
  delimiters?: string | null;
  unfinished?: boolean;
};

export type InputOp = IoEvent & {
  /** What kind of read this was, for the parsing view. */
  kind: "line" | "token" | "peek" | "tokenizer" | "split" | "parse" | "config";
  label: string;
  /** Range of stdin this call consumed, or peeked at (for hasNext). */
  range: [number, number] | null;
  cursorAfter: number | null;
  /** For StringTokenizer reads: the tokenizer's own text and the token's range in it. */
  tokenizer?: { text: string; range: [number, number] | null };
  /** Whether the simulated read matches the value Java actually returned. */
  verified: boolean;
  /** The variable assigned on this line, read from the source line (not from the runtime). */
  variable: string | null;
  /** seq of the earlier call whose result this one used (e.g. parseInt of a token). */
  from: number | null;
  note: string | null;
};

export type InputReplay = { stdin: string; ops: InputOp[]; truncated: boolean };

const TOKEN_READS = new Set(["next", "nextInt", "nextLong", "nextDouble", "nextFloat", "nextBoolean", "nextShort", "nextByte"]);
const PEEKS = new Set(["hasNext", "hasNextInt", "hasNextLong", "hasNextDouble", "hasNextBoolean"]);
const JAVA_TYPE: Record<string, string> = { "java.lang.String": "String", null: "null" };
export const typeName = (t?: string) => (t ? JAVA_TYPE[t] ?? t.split(".").pop()! : "");

/** A Java regex usable in JS, or null if it uses syntax JS doesn't share. */
function jsRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern.replace(/\\p\{javaWhitespace\}/g, "\\s"), "y");
  } catch {
    return null;
  }
}

function sameValue(token: string, result: string, op: string) {
  if (op === "next") return token === result;
  if (op === "nextBoolean") return token.toLowerCase() === result.toLowerCase();
  const a = Number(token.replace(/^\+/, "")), b = Number(result);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.abs(b) * 1e-6;
}

export function replayInput(trace: { io?: IoEvent[]; ioTruncated?: boolean; stdin?: string }, sources: Record<string, string>): InputReplay | null {
  const events = trace.io ?? [];
  if (!events.length) return null;
  const stdin = trace.stdin ?? "";
  const lineText = (e: IoEvent) => {
    const file = Object.keys(sources).find((k) => e.file && (k === e.file || k.endsWith("/" + e.file) || e.file.endsWith(k)));
    return file ? sources[file].split("\n")[e.line - 1] ?? "" : "";
  };
  let cursor = 0;
  let delim: RegExp = /\s+/y;
  let lost = false;
  const tokenizers = new Map<number, { text: string; delims: string; pos: number; from: number | null }>();
  const ops: InputOp[] = [];
  const lastOnLine = new Map<string, number>();
  events.forEach((e, i) => lastOnLine.set(`${e.step}:${e.line}`, i));

  const skip = (from: number) => {
    let at = from;
    for (;;) {
      delim.lastIndex = at;
      const m = delim.exec(stdin);
      if (!m || m[0].length === 0) return at;
      at += m[0].length;
    }
  };
  const tokenAt = (start: number) => {
    let end = start;
    while (end < stdin.length) {
      delim.lastIndex = end;
      const m = delim.exec(stdin);
      if (m && m[0].length) break;
      end++;
    }
    return end;
  };

  events.forEach((e, i) => {
    const src = lineText(e);
    const call = new RegExp(`([\\w.\\]\\)]+)\\s*\\.\\s*${e.op}\\s*\\(`).exec(src);
    const shownArgs = e.args.map((a) => (a === null ? "null" : /parse|valueOf|<init>|useDelimiter/.test(e.op) ? JSON.stringify(a) : a)).join(", ");
    const label = e.op === "<init>" ? `new StringTokenizer(${shownArgs})` : `${call ? call[1] : e.cls.split(".").pop()}.${e.op}(${shownArgs})`;
    const assign = /^\s*(?:final\s+)?(?:[\w.<>[\]]+\s+)?([A-Za-z_]\w*)\s*(\+=|-=|\*=|=)(?!=)/.exec(src);
    const variable = assign && lastOnLine.get(`${e.step}:${e.line}`) === i && e.op !== "<init>" ? (assign[2] === "=" ? assign[1] : `${assign[1]} ${assign[2]}`) : null;
    const base = { ...e, label, variable, from: null as number | null, note: null as string | null, tokenizer: undefined as InputOp["tokenizer"] };
    const prev = ops.at(-1);

    if (e.cls === "java.util.Scanner" && e.op === "useDelimiter") {
      const re = e.args[0] ? jsRegex(e.args[0]) : null;
      if (re) delim = re; else lost = true;
      ops.push({ ...base, kind: "config", range: null, cursorAfter: cursor, verified: !!re, note: re ? `From now on, tokens are separated by ${JSON.stringify(e.args[0])} instead of whitespace.` : "This delimiter can't be replayed here, so later positions are unavailable." });
      return;
    }
    if ((e.cls === "java.util.Scanner" && (e.op === "nextLine" || e.op === "hasNextLine")) || (e.cls === "java.io.BufferedReader" && e.op === "readLine")) {
      const peek = e.op === "hasNextLine";
      const start = cursor;
      const nl = stdin.indexOf("\n", start);
      const end = nl === -1 ? stdin.length : nl + 1;
      const text = stdin.slice(start, nl === -1 ? stdin.length : nl).replace(/\r$/, "");
      const atEnd = start >= stdin.length;
      let verified: boolean;
      let note: string | null = null;
      if (peek) verified = (e.result === "true") === !atEnd;
      else if (!e.ok) { verified = atEnd; note = atEnd ? "There is no more input, so there is no line to read." : null; }
      else if (e.result === null || e.result === undefined) { verified = atEnd; note = "readLine() returns null at the end of the input."; }
      else verified = !lost && e.result === text;
      if (!peek && e.ok && e.result === "" && prev && prev.kind === "token" && prev.cursorAfter === start && stdin[start] === "\n" && prev.ok) {
        note = variable
          ? `nextLine() returned an empty string. The previous ${prev.op}() stopped right after its token and left the newline behind, so nextLine() only read the rest of that line. Call nextLine() once more after ${prev.op}() to skip it.`
          : `This nextLine() reads just the newline that ${prev.op}() left behind and discards it, so the next nextLine() starts on the following line.`;
      }
      if (verified && !peek && e.ok && !atEnd) cursor = end;
      ops.push({ ...base, kind: peek ? "peek" : "line", range: verified && !atEnd ? [start, peek ? (nl === -1 ? stdin.length : nl) : end] : null, cursorAfter: verified ? cursor : null, verified, note });
      if (!verified) lost = true;
      return;
    }
    if (e.cls === "java.util.Scanner" && (TOKEN_READS.has(e.op) || PEEKS.has(e.op))) {
      const start = skip(cursor);
      const end = tokenAt(start);
      const token = stdin.slice(start, end);
      const atEnd = start >= stdin.length;
      const peek = PEEKS.has(e.op);
      let verified: boolean;
      let note: string | null = null;
      if (peek) {
        verified = !lost;
        note = e.result === "true" ? null : atEnd ? "No more tokens: the input is used up." : `The next token, ${JSON.stringify(token)}, isn't a valid ${e.op.replace("hasNext", "").toLowerCase() || "token"}, so ${e.op}() is false.`;
      } else if (!e.ok) {
        verified = !lost;
        note = e.error?.type.endsWith("InputMismatchException")
          ? `The next token, ${JSON.stringify(token)}, isn't a valid ${typeName(e.op.replace("next", "").toLowerCase()) || "value"}. Scanner throws and leaves it unread.`
          : atEnd ? "There is no more input to read." : null;
      } else verified = !lost && !atEnd && sameValue(token, e.result ?? "", e.op);
      if (verified && e.ok && !peek) cursor = end;
      ops.push({ ...base, kind: peek ? "peek" : "token", range: verified && !atEnd ? [start, end] : null, cursorAfter: verified ? cursor : null, verified, note });
      if (!verified) lost = true;
      return;
    }
    if (e.cls === "java.util.StringTokenizer") {
      if (e.op === "<init>") {
        const text = e.text ?? e.args[0] ?? "";
        const from = [...ops].reverse().find((o) => o.result === text && (o.kind === "line" || o.kind === "token"))?.seq ?? null;
        tokenizers.set(e.receiver ?? -1, { text, delims: e.delimiters ?? e.args[1] ?? " \t\n\r\f", pos: 0, from });
        ops.push({ ...base, kind: "tokenizer", from, range: null, cursorAfter: cursor, verified: true, tokenizer: { text, range: null }, note: "A StringTokenizer splits this text into tokens. The tokens are still strings; converting them is a separate step." });
        return;
      }
      const tz = tokenizers.get(e.receiver ?? -1);
      if (!tz) { ops.push({ ...base, kind: "split", range: null, cursorAfter: cursor, verified: false }); return; }
      let at = tz.pos;
      while (at < tz.text.length && tz.delims.includes(tz.text[at])) at++;
      let end = at;
      while (end < tz.text.length && !tz.delims.includes(tz.text[end])) end++;
      const token = tz.text.slice(at, end);
      const peek = e.op !== "nextToken";
      const verified = peek || (e.ok ? token === e.result : at >= tz.text.length);
      if (!peek && e.ok && verified) tz.pos = end;
      ops.push({ ...base, kind: peek ? "peek" : "split", from: tz.from, range: null, cursorAfter: cursor, verified, tokenizer: { text: tz.text, range: !peek && e.ok && verified ? [at, end] : null }, note: !e.ok ? "There are no tokens left, so nextToken() throws." : null });
      return;
    }
    /* Integer.parseInt and friends: a string in, a number out, or a NumberFormatException. */
    const arg = e.args[0];
    const from = [...ops].reverse().find((o) => o.result === arg && o.kind !== "parse")?.seq ?? null;
    const target = e.op === "parseBoolean" ? "boolean" : e.cls === "java.lang.Integer" ? "int" : e.cls === "java.lang.Long" ? "long" : e.cls === "java.lang.Double" ? "double" : "float";
    ops.push({ ...base, kind: "parse", from, range: null, cursorAfter: cursor, verified: true, note: e.ok ? null : `${JSON.stringify(arg)} can't be converted to ${target === "int" ? "an int" : `a ${target}`}, so ${e.cls.split(".").pop()}.${e.op} throws.` });
  });
  return { stdin, ops, truncated: !!trace.ioTruncated };
}
