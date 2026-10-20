/**
 * Finds loops in the source and follows them through a recorded run. The source only says where
 * each loop is and what it iterates; whether it is running, which pass it is on, and what its
 * variable holds all come from the recording. An enhanced-for pass begins each time execution
 * comes back to the loop's header line and then enters its body.
 */
import type { RawTrace, Val } from "./interpret";

export type LoopDef = {
  id: string;
  file: string;
  header: number;
  end: number;
  kind: "enhanced" | "indexed" | "forEach";
  varName: string;
  typeText: string;
  /** The variable being iterated, e.g. scores for scores.keySet(). */
  iterable: string;
  mode: "elements" | "entries" | "keys" | "values";
  exprText: string;
};
export type ActiveLoop = LoopDef & { iteration: number; value: Val | null };

/** The last line of the loop body: matching braces, or the single statement after the header. */
function bodyEnd(lines: string[], h: number, afterParen: number): number {
  let i = h, col = afterParen;
  while (i < lines.length) {
    const rest = lines[i].slice(col).replace(/\/\/.*$/, "").trim();
    if (rest.startsWith("{")) break;
    if (rest.length) return rest.endsWith(";") || i > h ? i : i + 1;
    i++;
    col = 0;
  }
  if (i >= lines.length) return h;
  let depth = 0;
  for (let r = i; r < lines.length; r++) {
    const text = lines[r].slice(r === i ? col : 0).replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/.*$/g, "");
    for (const ch of text) {
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return r;
    }
  }
  return lines.length - 1;
}

export function findLoops(sources: Record<string, string>): LoopDef[] {
  const defs: LoopDef[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const lines = text.split("\n");
    lines.forEach((line, h) => {
      const code = line.replace(/\/\/.*$/, "");
      let m = /\bfor\s*\(\s*(?:final\s+)?(.+?)\s+(\w+)\s*:\s*(.+)\)/.exec(code);
      if (m) {
        let depth = 0, close = -1;
        const start = code.indexOf("(", code.search(/\bfor\b/));
        for (let c = start; c < code.length; c++) {
          if (code[c] === "(") depth++;
          else if (code[c] === ")" && --depth === 0) { close = c; break; }
        }
        const exprText = code.slice(code.indexOf(":", start) + 1, close).trim();
        const base = /^(?:this\.)?(\w+)/.exec(exprText)?.[1] ?? exprText;
        const mode = /\.entrySet\(\)/.test(exprText) ? "entries" : /\.keySet\(\)/.test(exprText) ? "keys" : /\.values\(\)/.test(exprText) ? "values" : "elements";
        defs.push({ id: `${file}:${h + 1}`, file, header: h + 1, end: bodyEnd(lines, h, close + 1) + 1, kind: "enhanced", varName: m[2], typeText: m[1].trim(), iterable: base, mode, exprText });
        return;
      }
      m = /\bfor\s*\(\s*(?:int|long)\s+(\w+)\s*=[^;]*;\s*\1\s*<=?\s*(?:this\.)?(\w+)\s*\.\s*(?:length|size\(\))\s*;/.exec(code);
      if (m) {
        const close = code.lastIndexOf(")");
        defs.push({ id: `${file}:${h + 1}`, file, header: h + 1, end: bodyEnd(lines, h, close + 1) + 1, kind: "indexed", varName: m[1], typeText: "int", iterable: m[2], mode: "elements", exprText: m[2] });
        return;
      }
      m = /\b(\w+)\s*\.\s*forEach\s*\(\s*\(?\s*(\w+)(?:\s*,\s*(\w+))?\s*\)?\s*->/.exec(code);
      if (m) defs.push({ id: `${file}:${h + 1}`, file, header: h + 1, end: h + 1, kind: "forEach", varName: m[2], typeText: "", iterable: m[1], mode: m[3] ? "keys" : "elements", exprText: m[1] });
    });
  }
  return defs;
}

const same = (a: Val | null | undefined, b: Val | null | undefined) => !!a && !!b && a.t === b.t && (a.t === "ref" ? a.id === b.id : a.v === b.v);

/** For each step, the loops running at that moment, outermost first. */
export function trackLoops(trace: RawTrace, defs: LoopDef[]): ActiveLoop[][] {
  const fileOf = new Map<string, string>();
  for (const s of trace.steps) {
    const f = s.sourcePath ? trace.sourceMap?.[s.sourcePath] ?? s.sourcePath : null;
    if (f && !fileOf.has(s.cls)) fileOf.set(s.cls, f);
  }
  const state = new Map<string, { iter: number; sawHeader: boolean; last: Val | null; first: number | null; prev: number | null }>(
    defs.map((d) => [d.id, { iter: 0, sawHeader: false, last: null, first: null, prev: null }]),
  );
  /* Lines that are themselves loop headers: jumping back to one of those is an inner loop, not a new outer pass. */
  const headers = new Set(defs.map((d) => `${d.file}:${d.header}`));
  return trace.steps.map((s) => {
    const active: ActiveLoop[] = [];
    const frames = s.stack.map((f) => ({ ...f, file: fileOf.get(f.cls) }));
    for (const d of defs) {
      const st = state.get(d.id)!;
      if (d.kind === "forEach") {
        const top = frames[0];
        const calling = frames.slice(1).some((f) => f.file === d.file && f.line === d.header);
        if (top && top.method.startsWith("lambda$") && calling) {
          const value = top.locals[d.varName] ?? null;
          if (!same(value, st.last)) { st.iter++; st.last = value; }
          active.push({ ...d, iteration: st.iter, value });
        } else if (!frames.some((f) => f.file === d.file && f.line === d.header)) { st.iter = 0; st.last = null; }
        continue;
      }
      const f = frames.find((x) => x.file === d.file && x.line >= d.header && x.line <= d.end);
      if (!f) { st.iter = 0; st.sawHeader = false; st.last = null; st.first = null; st.prev = null; continue; }
      const value = f.locals[d.varName] ?? null;
      if (d.kind === "indexed") {
        if (value && typeof value.v === "number") active.push({ ...d, iteration: (value.v as number) + 1, value });
        continue;
      }
      if (d.end === d.header) {
        /* A one-line loop never leaves its header, so count passes by the variable changing. */
        if (value && !same(value, st.last)) { st.iter++; st.last = value; }
      } else if (f.line === d.header) st.sawHeader = true;
      else {
        /*
         * A new pass shows up as any of: coming back through the header (array loops do), the loop
         * variable bound to a new value or object (next() just ran), or execution jumping back from
         * later in the body to its first line (catches repeated values like [1, 1, 2]).
         */
        if (st.first === null) st.first = f.line;
        const changed = !!value && !same(value, st.last);
        const wrapped = f.line === st.first && st.prev !== null && st.prev > st.first && !headers.has(`${d.file}:${st.first}`);
        if (st.sawHeader || changed || wrapped || st.iter === 0) st.iter++;
        st.sawHeader = false;
        st.last = value;
        st.prev = f.line;
      }
      if (st.iter > 0 && value) active.push({ ...d, iteration: st.iter, value });
    }
    return active;
  });
}
