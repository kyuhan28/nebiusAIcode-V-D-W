"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cellId, dpStateAt, type CellId, type CellView, type DpModel } from "@/lib/trace/dp";
import type { RawStep } from "@/lib/trace/interpret";
import { SpaceScrim } from "./space-scrim";
import "./dp-view.css";

type View = "triangle" | "table" | "graph";

type Props = {
  model: DpModel | null;
  steps: RawStep[] | null;
  stepIndex: number;
  onSeek: (step: number) => void;
  onJump: (file: string, line: number | null) => void;
  /** Rows currently sent as input, and a way to rebuild with a different count. */
  rows: number;
  onRows: (n: number) => void;
  /** The example's implementations in the project, to switch between them. */
  approaches: { path: string; label: string; active: boolean }[];
  onApproach: (path: string) => void;
  busy: boolean;
  fontFamily: string;
};

const APPROACH = { tabulation: "Bottom-up (tabulation)", memoized: "Top-down with a cache (memoization)", recursion: "Plain recursion, no cache" } as const;
const P = (r: number, c: number) => `P(${r}, ${c})`;

/** Cell centers for a centered triangle that fits the available width and height. */
function useTriangle(rows: number, width: number, height: number) {
  const gap = 6;
  const n = Math.max(rows, 1);
  const byWidth = Math.floor((width - 24) / n) - gap;
  const byHeight = Math.floor((height - 64) / n) - gap - 4;
  const size = Math.max(22, Math.min(50, byWidth, byHeight));
  const rowH = size + gap + 4;
  const center = Math.max(width, rows * (size + gap)) / 2;
  const at = (r: number, c: number) => ({ x: center + (c - r / 2) * (size + gap), y: 14 + r * rowH + size / 2 });
  return { size, at, height: 28 + rows * rowH, width: Math.max(width, rows * (size + gap) + 24) };
}

function Cell({ v, x, y, size, dep, selected, hit, onSelect }: { v: CellView; x: number; y: number; size: number; dep: boolean; selected: boolean; hit: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className="cvd-cell"
      data-status={v.status}
      data-dep={dep || undefined}
      data-hit={hit || undefined}
      data-selected={selected || undefined}
      style={{ left: x - size / 2, top: y - size / 2, width: size, height: size, fontSize: size > 38 ? 14 : 12 }}
      onClick={onSelect}
      aria-label={`${P(v.r, v.c)}: ${v.value ?? "not computed yet"}`}
      title={`${P(v.r, v.c)}${v.value === null ? ", not computed yet" : ` = ${v.value}`}`}
    >
      {v.value ?? "·"}
      {v.computed > 1 && <span className="cvd-count">×{v.computed}</span>}
    </button>
  );
}

/**
 * Dynamic programming as it happened in the recorded run: the triangle filling in, the table (or
 * the cache, for memoization), and which values each value was built from. Everything follows
 * the playback step; select a cell to see where its value came from.
 */
export function DpView({ model, steps, stepIndex, onSeek, onJump, rows, onRows, approaches, onApproach, busy, fontFamily }: Props) {
  const [view, setView] = useState<View>("triangle");
  const [pinned, setPinned] = useState<CellId | null>(null);
  const [rowsDraft, setRowsDraft] = useState(String(rows));
  const [width, setWidth] = useState(480);
  const [height, setHeight] = useState(420);
  const [narrow, setNarrow] = useState(false);
  const [zoom, setZoom] = useState(1);
  const mainRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setRowsDraft(String(rows)), [rows]);
  useEffect(() => setPinned(null), [model]);
  useEffect(() => {
    const el = mainRef.current, root = rootRef.current;
    if (!el || !root) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setHeight(el.clientHeight);
      setNarrow(root.clientWidth < 680);
    });
    ro.observe(el);
    ro.observe(root);
    return () => ro.disconnect();
  }, [model]);

  const state = useMemo(() => (model && steps ? dpStateAt(model, Math.min(stepIndex, steps.length - 1), steps) : null), [model, steps, stepIndex]);
  const tri = useTriangle(model?.rows ?? 1, width * (view === "graph" ? zoom : 1), view === "graph" ? height * zoom : height);
  const style = { ["--cv-mono" as string]: fontFamily };

  if (!model || !state || !steps) {
    return (
      <div ref={rootRef} className="cvd-root" style={style}>
        <SpaceScrim />
        <div className="cvd-empty">
          <strong>Watch a dynamic programming run</strong>
          Visualize a dynamic programming program and its subproblems appear here as they are computed. Try the Pascal&apos;s triangle example under Recursion and dynamic programming.
          <div ref={mainRef} />
        </div>
      </div>
    );
  }
  if (!model.spec) {
    return (
      <div ref={rootRef} className="cvd-root" style={style}>
        <SpaceScrim />
        <div className="cvd-empty">
          <strong>Not a recurrence this view knows yet</strong>
          This run {model.approach === "tabulation" ? `fills the table ${model.table?.name}` : `recurses through ${model.method}`}, but its values do not follow a recurrence the Dynamic programming view understands. It knows Pascal&apos;s triangle so far; more will follow. The Visualize tab still shows this run.
          <div ref={mainRef} />
        </div>
      </div>
    );
  }

  const spec = model.spec;
  const inspectId = pinned ?? state.focus;
  const inspected = inspectId ? state.cells.get(inspectId) ?? null : null;
  const depIds = new Set((inspected?.deps ?? []).map((d) => cellId(d.r, d.c)));
  const cells = [...state.cells.values()];
  const select = (id: CellId) => setPinned(id === pinned ? null : id);
  const cacheHit = state.cacheHit;

  const links = inspected && inspected.deps.length ? (
    <svg className="cvd-links" width={tri.width} height={tri.height} aria-hidden="true">
      <defs>
        <marker id="cvd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 Z" fill="#a996ff" />
        </marker>
      </defs>
      {inspected.deps.map((d) => {
        const a = tri.at(d.r, d.c), b = tri.at(inspected.r, inspected.c);
        const k = tri.size / 2 / Math.hypot(b.x - a.x, b.y - a.y);
        return <line key={`${d.r},${d.c}`} x1={a.x + (b.x - a.x) * k} y1={a.y + (b.y - a.y) * k} x2={b.x - (b.x - a.x) * k} y2={b.y - (b.y - a.y) * k} stroke="#a996ff" strokeWidth={1.6} markerEnd="url(#cvd-arrow)" />;
      })}
    </svg>
  ) : null;

  const triangle = (
    <div style={{ position: "relative", width: tri.width, height: tri.height, margin: "0 auto" }}>
      {links}
      {cells.map((v) => {
        const p = tri.at(v.r, v.c);
        const id = cellId(v.r, v.c);
        return <Cell key={id} v={v} x={p.x} y={p.y} size={tri.size} dep={depIds.has(id)} selected={id === inspectId} hit={id === cacheHit} onSelect={() => select(id)} />;
      })}
    </div>
  );

  /* The table: the triangle's own array for tabulation; for memoization, the cache as it stood. */
  const tableSource = model.approach === "memoized" ? "cache" : "values";
  const tSize = Math.max(22, Math.min(44, Math.floor((width - 40) / (model.rows + 1)) - 4, Math.floor((height - 90) / (model.rows + 1)) - 4));
  const table = (
    <div style={{ padding: 8 }}>
      <p className="cvd-muted" style={{ margin: "0 0 8px" }}>
        {tableSource === "cache"
          ? `The cache ${model.table?.name ?? ""}[r][c] as it stood at this step. Base cases are never stored: they are 1 by definition. Amber: the entry just read instead of recomputing.`
          : model.approach === "tabulation" ? `The array ${model.table?.name}[r][c], filled row by row from the top: every row needs only the row before it.` : "Values as they were computed; ×n marks a value computed n times."}
      </p>
      <div style={{ position: "relative", width: (model.rows + 1) * (tSize + 4), height: (model.rows + 1) * (tSize + 4) }}>
        {Array.from({ length: model.rows }, (_, i) => (
          <span key={`h${i}`} className="cvd-muted cvd-mono" style={{ position: "absolute", left: (i + 1) * (tSize + 4) + tSize / 2 - 4, top: 2, fontSize: 10 }}>{i}</span>
        ))}
        {Array.from({ length: model.rows }, (_, i) => (
          <span key={`v${i}`} className="cvd-muted cvd-mono" style={{ position: "absolute", left: 4, top: (i + 1) * (tSize + 4) + tSize / 2 - 7, fontSize: 10 }}>{i}</span>
        ))}
        {cells.map((v) => {
          const id = cellId(v.r, v.c);
          const shown: CellView = tableSource === "cache"
            ? { ...v, value: state.cache.get(id) ?? null, status: state.cache.has(id) ? (id === cacheHit ? "current" : "computed") : "pending", computed: 0 }
            : v;
          return <Cell key={id} v={shown} x={(v.c + 1) * (tSize + 4) + tSize / 2} y={(v.r + 1) * (tSize + 4) + tSize / 2} size={tSize} dep={depIds.has(id)} selected={id === inspectId} hit={id === cacheHit} onSelect={() => select(id)} />;
        })}
      </div>
    </div>
  );

  /* The dependency graph: one node per value, an arrow from each value it was built from. */
  const graph = (
    <div style={{ position: "relative", width: tri.width, height: tri.height, margin: "0 auto" }}>
      <svg className="cvd-links" width={tri.width} height={tri.height} aria-hidden="true">
        <defs>
          <marker id="cvd-garrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L10 5 L0 10 Z" fill="currentColor" />
          </marker>
        </defs>
        {cells.filter((v) => v.value !== null).flatMap((v) => v.deps.map((d) => {
          const a = tri.at(d.r, d.c), b = tri.at(v.r, v.c);
          const k = tri.size / 2 / Math.hypot(b.x - a.x, b.y - a.y);
          const into = cellId(v.r, v.c) === inspectId;
          return (
            <line key={`${d.r},${d.c}>${v.r},${v.c}`} x1={a.x + (b.x - a.x) * k} y1={a.y + (b.y - a.y) * k} x2={b.x - (b.x - a.x) * k} y2={b.y - (b.y - a.y) * k}
              stroke={into ? "#a996ff" : "rgba(160,175,205,0.35)"} strokeWidth={into ? 1.8 : 1} markerEnd="url(#cvd-garrow)" style={{ color: into ? "#a996ff" : "rgba(160,175,205,0.5)" }} />
          );
        }))}
      </svg>
      {cells.map((v) => {
        const p = tri.at(v.r, v.c);
        const id = cellId(v.r, v.c);
        return <Cell key={id} v={v} x={p.x} y={p.y} size={tri.size * 0.82} dep={depIds.has(id)} selected={id === inspectId} hit={id === cacheHit} onSelect={() => select(id)} />;
      })}
    </div>
  );

  const c = state.counters;
  const total = model.rows * (model.rows + 1) / 2;
  const at = inspected?.at;
  const fn = model.method ?? "pascal";

  return (
    <div ref={rootRef} className="cvd-root" style={style} data-narrow={narrow}>
      <SpaceScrim />
      <div className="cvd-bar">
        <h3 className="cvd-heading">Dynamic programming</h3>
        <span className="cvd-chip">{APPROACH[model.approach]}</span>
        <span className="cvd-spacer" />
        <div className="cvd-seg" role="group" aria-label="View">
          {(["triangle", "table", "graph"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v === "triangle" ? "Triangle" : v === "table" ? (model.approach === "memoized" ? "Cache" : "Table") : "Dependencies"}</button>
          ))}
        </div>
      </div>
      <div className="cvd-bar" style={{ paddingTop: 0 }}>
        {approaches.length > 1 && (
          <div className="cvd-seg" role="group" aria-label="Implementation">
            {approaches.map((a) => (
              <button key={a.path} type="button" aria-pressed={a.active} disabled={busy} onClick={() => onApproach(a.path)} title={`Open ${a.path} and visualize it`}>{a.label}</button>
            ))}
          </div>
        )}
        <span className="cvd-spacer" />
        <label className="cvd-rows">
          Rows
          <input type="number" min={1} max={12} value={rowsDraft} onChange={(e) => setRowsDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.nextElementSibling as HTMLButtonElement | null)?.click()} aria-label="Number of rows" />
          <button type="button" className="cvd-btn" disabled={busy || !/^\d+$/.test(rowsDraft) || +rowsDraft < 1 || +rowsDraft > 12} onClick={() => onRows(Number(rowsDraft))} title="Sends the row count as the program's input and visualizes again">Rebuild</button>
        </label>
        {view === "graph" && (
          <span className="cvd-seg" role="group" aria-label="Zoom">
            <button type="button" onClick={() => setZoom((z) => Math.max(0.6, z / 1.25))} aria-label="Zoom out">−</button>
            <button type="button" onClick={() => setZoom(1)}>Fit</button>
            <button type="button" onClick={() => setZoom((z) => Math.min(3, z * 1.25))} aria-label="Zoom in">+</button>
          </span>
        )}
      </div>
      <div className="cvd-event" aria-live="polite">{state.event ?? `Step ${stepIndex + 1}: ${c.distinct} of ${total} values known so far.`}</div>

      <div className="cvd-body">
        <div ref={mainRef} className="cvd-main" role="region" aria-label={view === "graph" ? "Dependency graph" : view === "table" ? "Table" : "Triangle"}>
          {view === "triangle" ? triangle : view === "table" ? table : graph}
          <div className="cvd-legend" style={{ padding: "0 8px 8px" }}>
            <span><i style={{ borderColor: "rgba(255,255,255,0.2)", borderStyle: "dashed" }} />not computed yet</span>
            <span><i style={{ borderColor: "#6fe9ff" }} />being computed</span>
            {model.approach !== "tabulation" && <span><i style={{ borderColor: "#a996ff", borderStyle: "dashed" }} />waiting for its calls</span>}
            <span><i style={{ borderColor: "rgba(160,175,205,0.5)" }} />computed</span>
            <span><i style={{ borderColor: "#a996ff" }} />a value the selected one depends on</span>
            {model.approach === "memoized" && <span><i style={{ borderColor: "#f2c94c" }} />answered from the cache</span>}
          </div>
        </div>

        <aside className="cvd-side" aria-label="Details">
          <section className="cvd-panel" aria-label="Selected value">
            {inspected ? (
              <>
                <div className="cvd-title">{P(inspected.r, inspected.c)}</div>
                <div className="cvd-muted">row {inspected.r}, position {inspected.c}{pinned ? "" : " (follows playback; click a cell to pin)"}</div>
                {inspected.value === null ? (
                  <p className="cvd-muted">Not computed yet at this step.</p>
                ) : inspected.base ? (
                  <>
                    <div className="cvd-sum"><b>1</b></div>
                    <p className="cvd-muted" style={{ margin: 0 }}>A base case: it sits at the {inspected.c === 0 ? "start" : "end"} of row {inspected.r}, so it is 1 by definition and needs no values above it.</p>
                  </>
                ) : (
                  <>
                    <div className="cvd-sum">
                      {inspected.deps.map((d, i) => (
                        <span key={i}>{i > 0 && " + "}<button type="button" className="cvd-dep" onClick={() => select(cellId(d.r, d.c))} title={`Select ${P(d.r, d.c)}`}>{d.value ?? "?"}</button></span>
                      ))}
                      {" = "}<b>{inspected.value}</b>
                    </div>
                    <p className="cvd-muted" style={{ margin: 0 }}>
                      {inspected.depsFrom === "calls"
                        ? `From the recorded calls ${inspected.deps.map((d) => `${fn}(${d.r}, ${d.c})`).join(" and ")}.`
                        : `The values above it, ${inspected.deps.map((d) => P(d.r, d.c)).join(" and ")}, as they were in the recording when this value was written.`}
                    </p>
                  </>
                )}
                {(inspected.hits > 0 || inspected.computed > 1) && (
                  <p style={{ margin: "6px 0 0" }}>
                    {inspected.hits > 0 && <span style={{ color: "#f2c94c" }}>Answered from the cache {inspected.hits} time{inspected.hits === 1 ? "" : "s"}. </span>}
                    {inspected.computed > 1 && <span style={{ color: "#f2c94c" }}>Computed {inspected.computed} times: no cache, so the same work is repeated.</span>}
                  </p>
                )}
                {at && (
                  <div className="cvd-actions">
                    <button type="button" className="cvd-link" onClick={() => onSeek(at.step)}>Show step {at.step + 1}</button>
                    {at.file && <button type="button" className="cvd-link" onClick={() => onJump(at.file!, at.line)}>Open line {at.line}</button>}
                  </div>
                )}
              </>
            ) : (
              <p className="cvd-muted" style={{ margin: 0 }}>Click a cell to see where its value came from.</p>
            )}
          </section>

          <section className="cvd-panel" aria-label="Recurrence">
            <h4>The recurrence</h4>
            {spec.formula.map((f) => (
              <div key={f.text} className="cvd-formula" data-on={!!inspected && inspected.base === f.base}>
                {f.text}
                <span>{f.when}</span>
              </div>
            ))}
            {inspected && <div className="cvd-formula" data-on="true" style={{ marginTop: 6 }}>{spec.instance(inspected.r, inspected.c)}{!inspected.base && inspected.value !== null && ` = ${inspected.deps.map((d) => d.value).join(" + ")} = ${inspected.value}`}</div>}
            <ul className="cvd-plain">{spec.plain.map((t) => <li key={t}>{t}</li>)}</ul>
          </section>

          <section className="cvd-panel" aria-label="Cost">
            <h4>Cost</h4>
            <p className="cvd-muted" style={{ margin: 0 }}>{spec.complexity[model.approach]}</p>
            <h4 style={{ marginTop: 10 }}>Counted in this recording, up to this step</h4>
            <dl className="cvd-stats">
              <dt>values known</dt><dd>{c.distinct} of {total}</dd>
              {model.approach === "tabulation" ? (
                <><dt>cells written</dt><dd>{c.writes}</dd></>
              ) : (
                <>
                  <dt>calls</dt><dd>{c.calls}</dd>
                  <dt>base cases</dt><dd>{c.base}</dd>
                  <dt>computed</dt><dd>{c.computed}</dd>
                  {model.approach === "memoized" && <><dt>cache answers</dt><dd>{c.hits}</dd><dt>cache entries</dt><dd>{state.cache.size}</dd></>}
                  {model.approach === "recursion" && <><dt>repeated work</dt><dd>{c.repeats} recomputations</dd></>}
                </>
              )}
            </dl>
            <p className="cvd-muted" style={{ margin: "8px 0 0", fontSize: 11 }}>Every value here was checked against the recurrence: {model.checks.matched} recorded {model.approach === "tabulation" ? "writes" : "calls"} agree with it.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
