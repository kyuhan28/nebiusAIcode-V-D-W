"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HeapObj, RawStep, Val } from "@/lib/trace/interpret";
import "./memory-view.css";

/* What bin/ctrace.py records per step for C and C++ (see runner/README.md). */
type MemVar = { name: string; type: string; addr: string; size: number; param?: boolean };
type MemFrame = { id: number; function: string; file: string | null; line: number | null; vars: MemVar[] };
type MemBlock = { id: number; addr: string; size: number; op: string; state: "live" | "freed"; file: string | null; line: number | null; step: number;
  freedLine?: number; freedFile?: string; freedBy?: string; from?: number; count?: number; zeroed?: boolean; elemType?: string; elemSize?: number; movedTo?: string };
type MemEvent = { op: string; size: number; file: string | null; line: number | null; step: number; block?: number; from?: number; moved?: boolean; failed?: boolean; null?: boolean; invalid?: boolean;
  /* C++ lifetime events */ kind?: string; cls?: string; object?: number; addr?: string; storage?: string; param?: string | null };
type MemObject = { id: number; cls: string; addr: string; storage: string; block: number | null; state: "alive" | "destroyed"; how: string; line: number | null; file: string | null; step: number; destroyedLine?: number; destroyedStep?: number };
type MemStep = { frames: MemFrame[]; globals: MemVar[]; blocks: MemBlock[]; events: MemEvent[]; stats: Record<string, number>; objects?: MemObject[] };
type Summary = { leakedAtExit?: { id: number; size: number; file: string | null; line: number | null }[] | null } | undefined;

type Props = {
  steps: RawStep[] | null;
  stepIndex: number;
  summary: Summary;
  ended: boolean;
  onJump: (file: string, line: number | null) => void;
  onSeek: (step: number) => void;
  fontFamily: string;
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** A sentence for one allocation event: what the call did, in C's terms. */
function describe(e: MemEvent, blocks: Map<number, MemBlock>, names?: Map<string, string>): string {
  const b = e.block !== undefined ? blocks.get(e.block) : undefined;
  const who = (e.addr && names?.get(e.addr)) ? ` ${names.get(e.addr)}` : "";
  const where = e.storage === "heap" ? `on the heap (block #${e.block})` : e.storage === "stack" ? "on the stack" : "in static storage";
  if (e.op === "construct") {
    if (e.kind === "copy constructor") return `Copy-constructed ${e.cls}${who} ${where} from ${e.param ?? "another object"}: a separate copy; changing one does not change the other.`;
    if (e.kind === "move constructor") return `Move-constructed ${e.cls}${who} ${where} from ${e.param ?? "another object"}: it took over the source's contents, leaving the source valid but unspecified (a moved-from object).`;
    return `Constructed ${e.cls}${who} ${where} with its ${e.kind}.`;
  }
  if (e.op === "destroy") return `Destroyed ${e.cls}${who} ${where}: its destructor runs ${e.storage === "stack" ? "automatically at the end of its scope, in reverse order of construction (RAII)" : e.storage === "heap" ? "because delete (or a smart pointer letting go) destroys it before freeing its memory" : "at program end"}.`;
  if (e.op === "assign") return `${e.kind === "move assignment" ? "Move-assigned" : "Copy-assigned"} into ${e.cls}${who}: an existing object is overwritten (no new object is constructed).`;
  if (e.op === "malloc") return e.failed ? `malloc(${e.size}) failed and returned NULL.` : `malloc(${e.size}) reserved ${plural(e.size, "byte")} as block #${e.block}. Its contents are not set: they show as ? until the program writes them.`;
  if (e.op === "calloc") return e.failed ? `calloc failed and returned NULL.` : `calloc reserved ${plural(e.size, "byte")}${b?.count ? ` (${b.count} elements)` : ""} as block #${e.block}, every byte set to zero.`;
  if (e.op === "realloc") {
    if (e.failed) return `realloc(${e.size}) failed and returned NULL; block #${e.block ?? "?"} is unchanged and still owned by the program.`;
    if (e.from === undefined) return `realloc(NULL, ${e.size}) behaves like malloc: block #${e.block}.`;
    return e.moved ? `realloc moved block #${e.from} to a new block #${e.block} (${e.size} bytes): the old contents were copied and the old block released. Pointers to the old block are now dangling.`
      : `realloc resized block #${e.block} to ${plural(e.size, "byte")} in place: it did not move this time, but it may move on another run or another call.`;
  }
  if (e.op === "new" || e.op === "new[]") return `${e.op} reserved ${plural(e.size, "byte")} as block #${e.block}${e.op === "new[]" ? " for an array" : ""}; constructors then set the object's members.`;
  if (e.op === "free" || e.op === "delete" || e.op === "delete[]") {
    if (e.null) return `${e.op}(NULL) does nothing.`;
    if (e.invalid) return `${e.op} was given an address that is not the start of an allocated block (an invalid free).`;
    return `${e.op} released block #${e.block}. Pointers that held its address still hold it: they are now dangling, and using them is undefined behavior.`;
  }
  return `${e.op}`;
}

function Value({ v, heap, depth, blocks }: { v: Val | undefined; heap: Record<string, HeapObj>; depth: number; blocks: Map<number, MemBlock> }): ReactNode {
  if (!v) return <span className="cvm-uninit">—</span>;
  if (v.t === "null") return <span className="cvm-null">NULL</span>;
  if (v.t === "uninit") return <span className="cvm-uninit" title="Never written since it was allocated">?</span>;
  if (v.t === "unknown") return <span className="cvm-uninit" title="Could not be read">?</span>;
  if (v.t === "String") return <span title={`std::string, ${(v as unknown as { len?: number }).len ?? ""} characters`}>&quot;{String(v.v)}&quot;</span>;
  if (v.t === "container") {
    const c = v as unknown as { cls: string; size: number | null };
    return <span className="cvm-null" title="A node-based container: its size is read from the library's own count; its elements are not decoded.">{c.cls} (size {c.size ?? "?"}, elements not shown)</span>;
  }
  if (v.t === "smart") {
    const sp = v as unknown as { kind: string; target: Val; useCount?: number; weakCount?: number; expired?: boolean };
    const tgt = sp.target;
    if (tgt.t === "null") return <span className="cvm-null">{sp.kind} (empty)</span>;
    const block = tgt.block;
    const counts = sp.kind === "unique_ptr" ? "sole owner" : sp.kind === "shared_ptr" ? `${sp.useCount} owner${sp.useCount === 1 ? "" : "s"}${sp.weakCount ? ` · ${sp.weakCount} weak` : ""}` : sp.expired ? "expired: the object is gone" : `watching, ${sp.useCount} owner${sp.useCount === 1 ? "" : "s"}`;
    const why = sp.kind === "unique_ptr" ? "Owns the object alone: it is deleted when this unique_ptr goes away. It can be moved, never copied."
      : sp.kind === "shared_ptr" ? "Shares ownership: the object is deleted when the last shared_ptr goes away. The counts are read from the control block."
        : "Watches without owning: it does not keep the object alive.";
    return <span className="cvm-ptr" data-ptr={block !== undefined && !sp.expired ? `b${block}` : ""} data-state={sp.expired ? "dangling" : "live"} title={why}>{sp.kind} → #{block ?? "?"} · {counts}</span>;
  }
  if ((v.ptr || v.t === "ptr") && v.type?.endsWith("&") && (v.state === "stack" || v.state === "global")) {
    return <span className="cvm-ptr" data-ptr={v.state === "stack" ? `v:${v.frameVar}` : `g:${v.var}`} data-state="stack" title="A reference: another name for an existing object, not a separate pointer variable.">refers to {v.var}</span>;
  }
  if (v.ptr || v.t === "ptr") {
    const state = v.state ?? "live";
    const target = state === "stack" ? `v:${v.frameVar}` : state === "global" ? `g:${v.var}` : v.block !== undefined ? `b${v.block}` : "";
    const b = v.block !== undefined ? blocks.get(v.block) : undefined;
    const esize = b?.elemSize ?? 0;
    const label = state === "dangling" ? `dangling → #${v.block} (freed)`
      : state === "stack" || state === "global" ? `→ &${v.var}${v.offset ? ` + ${v.offset} B` : ""}`
        : state === "static" ? `→ "${v.string}"`
          : state === "unknown" ? `? ${String(v.v)}`
            : `→ #${v.block}${v.offset ? ` + ${v.offset} B` : ""}${v.offset && v.index !== null && v.index !== undefined ? ` = [${v.index}]` : ""}`;
    const why = state === "dangling" ? `Holds the address of block #${v.block}, which was freed: using it is undefined behavior.`
      : state === "past-end" ? `Points ${v.offset} bytes into block #${v.block}, which is only ${b?.size} bytes: past its end. Forming it is allowed, using it is not.`
        : state === "unknown" ? "This address is in no known block or variable: often an uninitialized pointer. The visualizer never reads through it."
          : state === "static" ? "Points at a string the compiler stored with the program (static storage)."
            : v.offset && esize ? `block #${v.block} + ${v.offset} bytes = element [${(v.offset / esize).toFixed(0)}] (each ${b?.elemType} is ${esize} bytes)` : v.addr ?? String(v.v ?? "");
    return <span className="cvm-ptr" data-ptr={target} data-state={state} title={`${v.type ?? "pointer"}: ${why}`}>{label}</span>;
  }
  if (v.t === "ref" && v.id) {
    const o = heap[v.id];
    if (!o || depth > 3) return <span className="cvm-null">…</span>;
    return <Obj o={o} heap={heap} depth={depth + 1} blocks={blocks} />;
  }
  if (v.t === "char") return <span>&apos;{String(v.v)}&apos;</span>;
  if (v.t === "boolean") return <span>{v.v ? "true" : "false"}</span>;
  if (v.t === "double" || v.t === "float") return <span>{v.v === null ? "NaN/∞" : Number.isInteger(v.v) ? `${v.v}.0` : String(v.v)}</span>;
  return <span>{String(v.v ?? "")}</span>;
}

function Obj({ o, heap, depth, blocks }: { o: HeapObj; heap: Record<string, HeapObj>; depth: number; blocks: Map<number, MemBlock> }): ReactNode {
  if (o.t === "array") {
    const vec = o as unknown as { cls?: string; capacity?: number };
    return (
      <span className="cvm-cells">
        {vec.cls && <span className="cvm-null" style={{ width: "100%" }}>{vec.cls}: size {o.len}, capacity {vec.capacity}{vec.capacity !== undefined && vec.capacity > o.len ? ` (${vec.capacity - o.len} spare before it must reallocate)` : ""}</span>}
        {o.items.map((x, i) => (
          <span key={i} className="cvm-cell"><small>[{i}]</small><Value v={x} heap={heap} depth={depth} blocks={blocks} /></span>
        ))}
        {o.len > o.items.length && <span className="cvm-null">… {o.len} total</span>}
      </span>
    );
  }
  if (o.t === "object") {
    return (
      <span className="cvm-fields">
        {Object.entries(o.fields).map(([k, x]) => [<span key={`${k}:n`}>{k}</span>, <span key={`${k}:v`}><Value v={x} heap={heap} depth={depth} blocks={blocks} /></span>])}
      </span>
    );
  }
  return <span className="cvm-null">…</span>;
}

/**
 * C and C++ memory, as the recording saw it at this step: stack frames and their variables, heap
 * blocks from the program's own allocation log, and an arrow from every pointer to what it points at.
 * Addresses and contents were read from the stopped program; nothing is simulated.
 */
export function MemoryView({ steps, stepIndex, summary, ended, onJump, onSeek, fontFamily }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<{ d: string; state: string }[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const step = steps?.[stepIndex];
  const mem = (step as unknown as { memory?: MemStep } | undefined)?.memory;
  const blocks = useMemo(() => new Map((mem?.blocks ?? []).map((b) => [b.id, b])), [mem]);
  const history = useMemo(() => {
    const out: MemEvent[] = [];
    for (let k = 0; k <= stepIndex && steps; k++) out.push(...(((steps[k] as unknown as { memory?: MemStep }).memory?.events) ?? []));
    return out;
  }, [steps, stepIndex]);
  const leaked = new Set(ended && stepIndex === (steps?.length ?? 0) - 1 ? (summary?.leakedAtExit ?? []).map((b) => b.id) : []);
  /* Which stack or global variable sits at an address: to name objects in the lifetime view. */
  const names = useMemo(() => {
    const m = new Map<string, string>();
    (mem?.frames ?? []).forEach((f) => f.vars.forEach((v) => { if (!m.has(v.addr)) m.set(v.addr, v.name); }));
    (mem?.globals ?? []).forEach((v) => { if (!m.has(v.addr)) m.set(v.addr, v.name); });
    return m;
  }, [mem]);
  /* Blocks holding a std::vector's elements, named by the variable that owns them. */
  const owners = useMemo(() => {
    const m = new Map<number, string>();
    if (!step) return m;
    step.stack.forEach((f) => Object.entries(f.locals).forEach(([n, v]) => {
      const o = v.t === "ref" && v.id ? (step.heap as Record<string, HeapObj> | undefined)?.[v.id] as unknown as { buffer?: number } | undefined : undefined;
      if (o?.buffer !== undefined && o.buffer !== null) m.set(o.buffer, `storage of ${n}`);
    }));
    return m;
  }, [step]);
  const heap = (step?.heap ?? {}) as Record<string, HeapObj>;

  /* Arrows from each pointer to its target, measured after the cards are laid out. */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !mem) return;
    const measure = () => {
      const box = root.getBoundingClientRect();
      const at = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left + root.scrollLeft, y: r.top - box.top + root.scrollTop, w: r.width, h: r.height }; };
      const out: { d: string; state: string }[] = [];
      root.querySelectorAll<HTMLElement>("[data-ptr]").forEach((src) => {
        const key = src.dataset.ptr;
        if (!key) return;
        const dst = root.querySelector(key.startsWith("b") ? `[data-block="${key.slice(1)}"]` : `[data-var="${key.slice(2)}"]`);
        if (!dst) return;
        const a = at(src), b = at(dst);
        const sx = a.x + a.w, sy = a.y + a.h / 2;
        const back = b.x + b.w / 2 < sx;
        const tx = back ? b.x + b.w : b.x, ty = b.y + Math.min(14, b.h / 2);
        const bend = Math.max(40, Math.abs(tx - sx) / 2);
        out.push({ d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${back ? tx + bend : tx - bend} ${ty}, ${tx} ${ty}`, state: src.dataset.state ?? "live" });
      });
      setArrows(out);
      setSize({ w: root.scrollWidth, h: root.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [mem, stepIndex]);

  if (!steps || !mem) {
    return (
      <div className="cvm-root" style={{ ["--cv-mono" as string]: fontFamily }}>
        <div className="cvm-empty"><div><strong>Memory: stack, heap, and pointers</strong>Visualize a C or C++ program to see its stack frames, the blocks it allocates and frees, and where every pointer points, step by step.</div></div>
      </div>
    );
  }
  const now = new Set(mem.events.map((e) => `${e.op}:${e.block}:${e.step}`));
  const live = mem.blocks.filter((b) => b.state === "live");
  const freed = mem.blocks.filter((b) => b.state === "freed").slice(-6);
  const dangling = mem.frames.reduce((n, f, k) => n + f.vars.filter((v) => (step!.stack[k]?.locals[v.name] as Val | undefined)?.state === "dangling").length, 0);
  const color = (s: string) => (s === "dangling" ? "#ff6b81" : s === "past-end" ? "#f2c94c" : s === "stack" || s === "global" ? "#a996ff" : "#6fe9ff");

  return (
    <div ref={rootRef} className="cvm-root" style={{ ["--cv-mono" as string]: fontFamily }}>
      <svg className="cvm-arrows" width={size.w} height={size.h} aria-hidden="true">
        <defs>
          {["live", "dangling", "past-end", "stack"].map((s) => (
            <marker key={s} id={`cvm-a-${s}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill={color(s)} /></marker>
          ))}
        </defs>
        {arrows.map((a, i) => (
          <path key={i} d={a.d} fill="none" stroke={color(a.state)} strokeWidth={1.4} strokeDasharray={a.state === "dangling" ? "4 3" : undefined} markerEnd={`url(#cvm-a-${a.state === "global" ? "stack" : a.state === "unknown" ? "live" : a.state})`} opacity={0.85} />
        ))}
      </svg>
      <div className="cvm-grid">
        <section className="cvm-col" aria-label="Stack">
          <h3>Stack: function calls and their local variables</h3>
          <p className="cvm-note">Automatic storage: each call gets these variables, and they end when it returns. Addresses are real for this run.</p>
          {mem.frames.map((f, k) => (
            <div key={f.id} className="cvm-card" data-current={k === 0}>
              <div className="cvm-head"><b>{f.function}()</b><span>{f.file}:{f.line}</span></div>
              {f.vars.length === 0 && <p className="cvm-note">No variables yet.</p>}
              {f.vars.map((v) => (
                <div key={v.name} className="cvm-row" data-var={`${k}:${v.name}`}>
                  <span><span className="cvm-name">{v.name}</span><span className="cvm-type">{v.type}{v.param ? " (param)" : ""}</span><span className="cvm-addr">{v.addr}</span></span>
                  <span className="cvm-val"><Value v={step!.stack[k]?.locals[v.name] as Val} heap={heap} depth={0} blocks={blocks} /></span>
                </div>
              ))}
            </div>
          ))}
          {mem.globals.length > 0 && (
            <div className="cvm-card">
              <div className="cvm-head"><b>globals</b><span>static storage: they last the whole program</span></div>
              {mem.globals.map((v) => (
                <div key={v.name} className="cvm-row" data-var={`g:${v.name}`}>
                  <span><span className="cvm-name">{v.name}</span><span className="cvm-type">{v.type}</span><span className="cvm-addr">{v.addr}</span></span>
                  <span className="cvm-val"><Value v={(step!.statics ?? {})[`globals.${v.name}`] as Val} heap={heap} depth={0} blocks={blocks} /></span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="cvm-col" aria-label="Heap">
          <h3>Heap: blocks from malloc, calloc, realloc, and new</h3>
          {live.length === 0 && freed.length === 0 && <p className="cvm-note">Nothing allocated yet.</p>}
          {[...live, ...freed].map((b) => {
            const state = leaked.has(b.id) ? "leaked" : b.state;
            const obj = heap[`b${b.id}`];
            return (
              <div key={b.id} className="cvm-card" data-block={b.id} data-state={state}>
                <div className="cvm-head">
                  <b>#{b.id}</b>
                  <span>{b.op}({b.size}){b.elemType ? ` · ${b.elemType}${b.elemSize && b.size / b.elemSize > 1 ? ` × ${Math.floor(b.size / b.elemSize)}` : ""}` : ""} · {b.addr}</span>
                  <span className="cvm-badge" data-kind={state}>{state === "leaked" ? "leaked: never freed" : state}</span>
                </div>
                {owners.get(b.id) && <p className="cvm-note" style={{ color: "#9aa3b5" }}>{owners.get(b.id)}: the vector&apos;s elements live here; growing past its capacity allocates a new block and frees this one.</p>}
                {(obj as unknown as { note?: string } | undefined)?.note && <p className="cvm-note" style={{ color: "#9aa3b5" }}>{(obj as unknown as { note: string }).note}; the object starts {(obj as unknown as { inplace: number }).inplace} bytes in.</p>}
                <p className="cvm-note">
                  allocated at <button className="cvm-link" onClick={() => b.file && onJump(b.file, b.line)}>line {b.line ?? "?"}</button>
                  {b.from ? `, moved here from block #${b.from} by realloc` : ""}
                  {b.state === "freed" && <> · released by {b.freedBy} at <button className="cvm-link" onClick={() => b.freedFile && onJump(b.freedFile, b.freedLine ?? null)}>line {b.freedLine ?? "?"}</button>{b.movedTo ? " (moved)" : ""}</>}
                </p>
                {b.state === "live" && (obj ? <div className="cvm-val" style={{ marginTop: 4 }}><Obj o={obj} heap={heap} depth={0} blocks={blocks} /></div> : <p className="cvm-note">Contents not shown.</p>)}
                {b.state === "freed" && <p className="cvm-note">Its contents are no longer the program&apos;s, so they are not shown.</p>}
                {!b.elemType && b.state === "live" && <p className="cvm-note">No pointer to it says what it holds, so its bytes are shown.</p>}
              </div>
            );
          })}
        </section>

        <aside className="cvm-col" aria-label="Memory details">
          <div className="cvm-card">
            <h3>This step</h3>
            {mem.events.length === 0 ? <p className="cvm-note">No allocation, release, construction, or destruction since the last step.</p> : mem.events.map((e, i) => <p key={i} className="cvm-event" data-now="true">{describe(e, blocks, names)} {e.line && <button className="cvm-link" onClick={() => e.file && onJump(e.file, e.line)}>line {e.line}</button>}</p>)}
            {dangling > 0 && <p className="cvm-event" style={{ color: "#ff6b81" }}>{plural(dangling, "dangling pointer")} on the stack now: {dangling === 1 ? "it holds" : "they hold"} the address of freed memory.</p>}
          </div>
          {(mem.objects?.length ?? 0) > 0 && (
            <div className="cvm-card" aria-label="Objects">
              <h3>Objects: construction and destruction</h3>
              {mem.objects!.slice(-12).map((o) => (
                <p key={o.id} className="cvm-event" style={{ opacity: o.state === "destroyed" ? 0.55 : 1 }}>
                  <b>{o.cls}</b> {names.get(o.addr) ?? (o.block ? `in block #${o.block}` : o.addr)} · {o.storage} · {o.how} at <button className="cvm-link" onClick={() => o.file && onJump(o.file, o.line)}>line {o.line}</button>
                  {o.state === "destroyed" ? <> · destroyed at <button className="cvm-link" onClick={() => onSeek(o.destroyedStep ?? 0)}>step {(o.destroyedStep ?? 0) + 1}</button></> : " · alive"}
                </p>
              ))}
              <p className="cvm-note" style={{ marginTop: 4 }}>Seen when the program&apos;s own constructors, destructors, and assignment operators run. Compiler-generated ones that are trivial (or inlined) and those inside the standard library are not visible.</p>
            </div>
          )}
          <div className="cvm-card">
            <h3>Lifecycle so far</h3>
            {history.length === 0 && <p className="cvm-note">No allocations yet.</p>}
            {history.slice(-14).map((e, i) => (
              <p key={i} className="cvm-event" data-now={now.has(`${e.op}:${e.block}:${e.step}`)}>
                <button className="cvm-link" onClick={() => onSeek(e.step)}>step {e.step + 1}</button> {e.cls ? `${e.kind} ${e.cls}${e.addr && names.get(e.addr) ? ` ${names.get(e.addr)}` : ""}` : `${e.op}${e.block !== undefined ? ` #${e.block}` : ""}${e.size ? ` (${e.size} B)` : ""}`}{e.line ? ` at line ${e.line}` : ""}
              </p>
            ))}
          </div>
          <div className="cvm-card">
            <h3>Statistics</h3>
            <dl className="cvm-stats">
              <dt>live blocks</dt><dd>{mem.stats.live} ({mem.stats.liveBytes} B)</dd>
              <dt>freed blocks</dt><dd>{mem.stats.freed}</dd>
              <dt>allocations</dt><dd>{mem.stats.allocations} ({mem.stats.requestedBytes} B requested)</dd>
              <dt>peak live</dt><dd>{mem.stats.peakBytes} B</dd>
              {ended && stepIndex === steps.length - 1 && <><dt>leaked at exit</dt><dd>{(summary?.leakedAtExit ?? []).length} block(s), {(summary?.leakedAtExit ?? []).reduce((n, b) => n + b.size, 0)} B</dd></>}
            </dl>
            <p className="cvm-note" style={{ marginTop: 6 }}>Counted from the program&apos;s allocation log: the sizes it asked for. The allocator&apos;s own bookkeeping and padding are not visible. Run checks the same program with AddressSanitizer for invalid accesses.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
