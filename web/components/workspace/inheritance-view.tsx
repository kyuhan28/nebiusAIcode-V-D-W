"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent } from "react";
import {
  NODE_W, buildHierarchy, callKey, dispatchAt, layout, type ClassModel, type ClassView, type Dispatch, type Hierarchy, type MethodModel,
} from "@/lib/trace/inheritance";
import type { HeapObj, RawStep } from "@/lib/trace/interpret";
import { formatType, simpleName } from "@/lib/trace/types";
import { SpaceScrim } from "./space-scrim";
import "./inheritance-view.css";

/* Class names in inheritance-view.css. */
const styles = {
  root: "cvi-root",
  bar: "cvi-bar",
  heading: "cvi-heading",
  meta: "cvi-meta",
  spacer: "cvi-spacer",
  tool: "cvi-tool",
  member: "cvi-member",
  cardHead: "cvi-cardHead",
  notice: "cvi-notice",
  dispatch: "cvi-dispatch",
  run: "cvi-run",
  body: "cvi-body",
  canvas: "cvi-canvas",
  world: "cvi-world",
  edges: "cvi-edges",
  card: "cvi-card",
  name: "cvi-name",
  badge: "cvi-badge",
  sub: "cvi-sub",
  members: "cvi-members",
  mark: "cvi-mark",
  abstractName: "cvi-abstractName",
  ran: "cvi-ran",
  more: "cvi-more",
  inspector: "cvi-inspector",
  chain: "cvi-chain",
  section: "cvi-section",
  why: "cvi-why",
  legend: "cvi-legend",
  empty: "cvi-empty",
} as const;

type Props = {
  /** javac's class model from the latest clean compile, or null. */
  classes: ClassModel[] | null;
  /** Why there is no model: never compiled, or the last compile failed. */
  status: "none" | "compile_failed" | "ready";
  /** The project changed since that compile. */
  stale: boolean;
  /** The recorded step being shown, with its heap, when a run was visualized. */
  step: RawStep | null;
  heap: Record<string, HeapObj> | null;
  stepIndex: number;
  /** First step each implementation ran on, "binary.Class#name(desc)". */
  calls: Map<string, number> | null;
  onJump: (file: string, line: number | null) => void;
  fontFamily: string;
};

const short = (name: string, h: Hierarchy) => h.classes.get(name)?.label ?? simpleName(name);
const ownerOf = (ref: string) => ref.slice(0, ref.indexOf("#"));
/** Long paths keep their last two parts on the card; the full path is in the tooltip and the inspector. */
const shortPath = (path: string | null) => {
  if (!path) return "";
  const parts = path.split("/");
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : path;
};
const signature = (m: MethodModel) => `${m.name}(${m.params.map((p) => formatType(p.split(" ")[0])).join(", ")})`;

function explain(d: Dispatch, h: Hierarchy): ReactNode {
  const impl = short(d.implementer, h);
  const obj = d.runtime ? short(d.runtime, h) : null;
  const name = d.method ? signature(d.method) : `${d.methodName}()`;
  const held = d.holders.find((x) => x.type);
  const via = held ? <><code>{held.name}</code> is declared <code>{formatType(held.type)}</code> and holds a <code>{obj}</code>. </> : null;
  switch (d.kind) {
    case "static":
      return <><code className={styles.run}>{impl}.{name}</code> is running. It is static, so no object is involved.</>;
    case "constructor":
      return <>Building a new <code>{obj}</code>: its constructor <code className={styles.run}>{impl}({d.method?.params.length ? "…" : ""})</code> runs.</>;
    case "super-constructor":
      return <>Still building the <code>{obj}</code>: the parent constructor <code className={styles.run}>{impl}(…)</code> runs through <code>super(…)</code>, so {impl}&apos;s fields are set up too.</>;
    case "super-call":
      return <><code>super.{d.methodName}()</code> runs <code className={styles.run}>{impl}.{name}</code> on the same <code>{obj}</code>, from the override below it.</>;
    case "inherited":
      return <>{via}<code>{obj}</code> does not define <code>{name}</code> itself, so the version it inherits from <code className={styles.run}>{impl}</code> runs.</>;
    case "override":
      return <>{via}The object is a <code>{obj}</code>, so its own <code className={styles.run}>{impl}.{name}</code> runs. It overrides <code>{short(ownerOf(d.replaces!), h)}.{d.methodName}</code>.</>;
    default:
      return <>{via}<code className={styles.run}>{impl}.{name}</code> runs, declared in {impl}.</>;
  }
}

function Card({ c, h, open, selected, state, running, calls, stepIndex, onSelect, onToggle, onJump }: {
  c: ClassView; h: Hierarchy; open: boolean; selected: boolean; state: { running: boolean; object: boolean; dim: boolean };
  running: MethodModel | null; calls: Map<string, number> | null; stepIndex: number;
  onSelect: () => void; onToggle: () => void; onJump: (m: MethodModel) => void;
}) {
  const m = c.model;
  const parents = [m.superclass && h.classes.has(m.superclass) ? `extends ${short(m.superclass, h)}` : c.externalParent ? `extends ${simpleName(c.externalParent)}` : "",
    m.interfaces.length ? `${m.kind === "interface" ? "extends" : "implements"} ${m.interfaces.map((i) => (h.classes.has(i) ? short(i, h) : simpleName(i))).join(", ")}` : ""].filter(Boolean).join(", ");
  const shown = c.declared.slice(0, 6);
  return (
    <div className={styles.card} data-selected={selected} data-running={state.running} data-object={state.object} data-dim={state.dim}>
      <button type="button" className={styles.cardHead} onClick={onSelect} onDoubleClick={onToggle} aria-pressed={selected} title={`${m.name}\n${m.file ?? ""}`}>
        <div className={styles.name}>
          {c.label}
          {m.kind !== "class" ? <span className={styles.badge}>{m.kind}</span> : m.abstract ? <span className={styles.badge}>abstract</span> : null}
        </div>
        <div className={styles.sub}>{parents || shortPath(m.file)}</div>
        <div className={styles.sub}>{parents ? shortPath(m.file) : ""}</div>
      </button>
      {open && shown.length > 0 && (
        <ul className={styles.members}>
          {shown.map((x) => {
            const ran = calls && (calls.get(callKey(m.name, x)) ?? Infinity) <= stepIndex;
            return (
              <li key={x.name + x.descriptor}>
                <button type="button" className={styles.member} data-override={!!x.overrides} data-running={running === x} onClick={() => onJump(x)} title={x.overrides ? `Overrides ${short(ownerOf(x.overrides), h)}.${x.name}` : "Declared here"}>
                  <span className={styles.mark} aria-hidden="true">{x.overrides ? "↻" : "•"}</span>
                  <span className={x.modifiers.includes("abstract") ? styles.abstractName : undefined}>{signature(x)}</span>
                  {ran && <span className={styles.ran} role="img" aria-label="ran in this recording" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {open && (c.declared.length > 6 || c.inherited.length > 0) && (
        <div className={styles.more}>
          {c.declared.length > 6 ? `${c.declared.length - 6} more declared` : ""}
          {c.declared.length > 6 && c.inherited.length ? ", " : ""}
          {c.inherited.length ? `${c.inherited.length} inherited` : ""}
        </div>
      )}
    </div>
  );
}

/**
 * The project's classes as javac resolved them, parents above children, synced with playback:
 * the class whose code is running is lit, the object's own class is outlined, and a sentence
 * says why that implementation was chosen.
 */
export function InheritanceView({ classes, status, stale, step, heap, stepIndex, calls, onJump, fontFamily }: Props) {
  const h = useMemo(() => (classes ? buildHierarchy(classes) : null), [classes]);
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [view, setView] = useState({ x: 20, y: 10, k: 1 });
  const [dragging, setDragging] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  /* Once the user pans or zooms, the view stays where they put it. */
  const moved = useRef(false);

  const placed = useMemo(() => (h ? layout(h, (n) => !closed.has(n)) : null), [h, closed]);
  const dispatch = useMemo(() => (h && step && heap ? dispatchAt(h, step, heap) : null), [h, step, heap]);

  const fit = () => {
    const el = canvas.current;
    if (!el || !placed) return;
    const k = Math.min(1.1, (el.clientWidth - 40) / placed.width, (el.clientHeight - 40) / Math.max(placed.height, 1));
    const kk = Math.max(0.3, k);
    setView({ k: kk, x: (el.clientWidth - placed.width * kk) / 2, y: Math.max(16, (el.clientHeight - placed.height * kk) / 2) });
  };
  /* Fit when a new class model arrives, and whenever the drawing area changes size (the inspector
     opening, the panel resizing) until the user moves the view themselves. */
  useEffect(() => {
    moved.current = false;
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes]);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => !moved.current && fit());
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /* Follow execution: select the class whose code is running. */
  useEffect(() => {
    if (dispatch) setSelected(dispatch.implementer);
  }, [dispatch?.implementer]); // eslint-disable-line react-hooks/exhaustive-deps

  const onWheel = (e: WheelEvent) => {
    const el = canvas.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    moved.current = true;
    setView((v) => {
      const k = Math.min(2, Math.max(0.3, v.k * Math.exp(-e.deltaY * 0.0015)));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };

  const empty = (title: string, body: string) => (
    <div ref={rootRef} className={styles.root} style={{ ["--cv-mono" as string]: fontFamily }}>
      <SpaceScrim />
      <div className={styles.empty}>
        <strong>{title}</strong>
        {body}
      </div>
    </div>
  );
  if (status === "compile_failed" && !h) return empty("The class model needs a clean compile", "Fix the errors listed in Problems, then run or visualize again. The hierarchy comes from javac, so it is only shown when everything compiles.");
  if (!h || !placed) return empty("Run your code to see its classes", "Compile, run, or visualize, and every class in the project appears here with what it extends, what it overrides, and what it inherits.");

  const sel = selected && h.classes.has(selected) ? h.classes.get(selected)! : null;
  const chainOf = (n: string | null) => (n && h.classes.has(n) ? [n, ...h.classes.get(n)!.ancestors] : []);
  const objectChain = chainOf(dispatch?.runtime ?? null);
  const running = dispatch?.method ?? null;
  const pos = new Map(placed.nodes.map((n) => [n.name, n]));
  const jumpTo = (owner: string, m: MethodModel | null) => {
    const file = h.classes.get(owner)?.model.file;
    if (file) onJump(file, m?.line ?? h.classes.get(owner)!.model.line);
  };
  const ranAt = (owner: string, m: MethodModel) => !!calls && (calls.get(callKey(owner, m)) ?? Infinity) <= stepIndex;

  return (
    <div ref={rootRef} className={styles.root} style={{ ["--cv-mono" as string]: fontFamily }}>
      <SpaceScrim />
      <div className={styles.bar}>
        <h3 className={styles.heading}>Inheritance</h3>
        <span className={styles.meta}>{h.classes.size} type{h.classes.size === 1 ? "" : "s"}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.tool} onClick={() => { moved.current = true; setView((v) => ({ ...v, k: Math.max(0.3, v.k / 1.2) })); }} aria-label="Zoom out">−</button>
        <button type="button" className={styles.tool} onClick={() => { moved.current = true; setView((v) => ({ ...v, k: Math.min(2, v.k * 1.2) })); }} aria-label="Zoom in">+</button>
        <button type="button" className={styles.tool} onClick={() => { moved.current = false; fit(); }}>Fit</button>
      </div>
      {stale && <div className={styles.notice}>The code changed after this class model was built. Run again to refresh it.</div>}
      {dispatch && <div className={styles.dispatch} aria-live="polite">{explain(dispatch, h)}</div>}

      <div className={styles.body} style={narrow ? { flexDirection: "column" } : undefined}>
        <div
          ref={canvas}
          className={styles.canvas}
          data-dragging={dragging}
          onWheel={onWheel}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            setDragging(true);
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (d) {
              moved.current = true;
              setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
            }
          }}
          onPointerUp={() => { drag.current = null; setDragging(false); }}
          aria-label="Class hierarchy. Drag to pan, scroll to zoom."
          role="region"
        >
          <div className={styles.world} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, width: placed.width, height: placed.height }}>
            <svg className={styles.edges} width={placed.width} height={placed.height} aria-hidden="true">
              <defs>
                {/* UML's hollow triangle, tip pointing along the line toward the parent. */}
                <marker id="cv-ext" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11" markerHeight="11" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M1 1 L11 6 L1 11 Z" fill="#05070b" stroke="currentColor" strokeWidth="1.2" />
                </marker>
              </defs>
              {placed.edges.map((e) => {
                const a = pos.get(e.from)!, b = pos.get(e.to)!;
                const x1 = a.x + NODE_W / 2, y1 = a.y, x2 = b.x + NODE_W / 2, y2 = b.y + b.h + 6;
                const lit = objectChain.includes(e.from) && objectChain.includes(e.to);
                const mid = (y1 + y2) / 2;
                return (
                  <path key={`${e.from}>${e.to}`} d={`M${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`} fill="none"
                    stroke={lit ? "rgba(111,233,255,0.75)" : "rgba(160,175,205,0.32)"} strokeWidth={lit ? 1.6 : 1.2}
                    strokeDasharray={e.kind === "implements" ? "5 5" : undefined} markerEnd="url(#cv-ext)" style={{ color: lit ? "rgba(111,233,255,0.75)" : "rgba(160,175,205,0.45)" }} />
                );
              })}
            </svg>
            {placed.nodes.map((n) => {
              const c = h.classes.get(n.name)!;
              return (
                <div key={n.name} style={{ position: "absolute", left: n.x, top: n.y, width: n.w, height: n.h }}>
                  <Card
                    c={c} h={h} open={!closed.has(n.name)} selected={selected === n.name}
                    state={{ running: dispatch?.implementer === n.name, object: dispatch?.runtime === n.name, dim: !!dispatch && objectChain.length > 0 && !objectChain.includes(n.name) && dispatch.implementer !== n.name }}
                    running={dispatch?.implementer === n.name ? running : null} calls={calls} stepIndex={stepIndex}
                    onSelect={() => setSelected(n.name)}
                    onToggle={() => setClosed((s) => { const x = new Set(s); if (x.has(n.name)) x.delete(n.name); else x.add(n.name); return x; })}
                    onJump={(m) => { setSelected(n.name); jumpTo(n.name, m); }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {sel && (
          <aside className={styles.inspector} aria-label={`Details of ${sel.label}`} style={narrow ? { width: "auto", maxHeight: "45%", margin: "0 12px 12px" } : undefined}>
            <h3>
              {sel.label}
              {sel.model.kind !== "class" ? <span className={styles.badge}>{sel.model.kind}</span> : sel.model.abstract ? <span className={styles.badge}>abstract</span> : null}
            </h3>
            <div className={styles.chain}>
              {[sel.model.name, ...sel.ancestors].map((n, i) => (
                <span key={n}>
                  {i > 0 && " → "}
                  {i === 0 ? short(n, h) : <button type="button" onClick={() => setSelected(n)}>{short(n, h)}</button>}
                </span>
              ))}
              {sel.externalParent && <> → {simpleName(sel.externalParent)}</>}
              <div>
                <button type="button" onClick={() => jumpTo(sel.model.name, null)}>{sel.model.file}</button>
                {sel.model.line ? `, line ${sel.model.line}` : ""}
              </div>
            </div>
            {sel.constructors.length > 0 && (
              <details className={styles.section} open>
                <summary>Constructors</summary>
                <ul className={styles.members}>
                  {sel.constructors.map((m) => (
                    <li key={m.descriptor}>
                      <button type="button" className={styles.member} onClick={() => jumpTo(sel.model.name, m)} data-running={running === m}>
                        <span className={styles.mark}>•</span>
                        <span>{sel.label}({m.params.map((p) => formatType(p.split(" ")[0])).join(", ")}){m.implicit && <span className={styles.why}> written by the compiler</span>}</span>
                        {ranAt(sel.model.name, m) && <span className={styles.ran} role="img" aria-label="ran" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <details className={styles.section} open>
              <summary>Declared here ({sel.declared.length})</summary>
              <ul className={styles.members}>
                {sel.declared.map((m) => (
                  <li key={m.name + m.descriptor}>
                    <button type="button" className={styles.member} data-override={!!m.overrides} data-running={running === m} onClick={() => jumpTo(sel.model.name, m)}>
                      <span className={styles.mark}>{m.overrides ? "↻" : "•"}</span>
                      <span>
                        <span className={m.modifiers.includes("abstract") ? styles.abstractName : undefined}>{signature(m)}</span>
                        {m.overrides && <span className={styles.why}> overrides {short(ownerOf(m.overrides), h)}</span>}
                        {m.modifiers.includes("abstract") && <span className={styles.why}> abstract</span>}
                      </span>
                      {ranAt(sel.model.name, m) && <span className={styles.ran} role="img" aria-label="ran" />}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
            {sel.inherited.length > 0 && (
              <details className={styles.section} open>
                <summary>Inherited ({sel.inherited.length})</summary>
                <ul className={styles.members}>
                  {sel.inherited.map(({ owner, method }) => (
                    <li key={owner + method.name + method.descriptor}>
                      <button type="button" className={styles.member} data-running={dispatch?.implementer === owner && running === method && dispatch?.runtime === sel.model.name} onClick={() => jumpTo(owner, method)}>
                        <span className={styles.mark}>↑</span>
                        <span>{signature(method)}<span className={styles.why}> from {short(owner, h)}</span></span>
                        {ranAt(owner, method) && <span className={styles.ran} role="img" aria-label="ran" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {(sel.model.fields.length > 0 || sel.inheritedFields.length > 0) && (
              <details className={styles.section}>
                <summary>Fields ({sel.model.fields.length + sel.inheritedFields.length})</summary>
                <ul className={styles.members}>
                  {sel.model.fields.map((f) => (
                    <li key={f.name}><span className={styles.member}><span className={styles.mark}>•</span>{f.name} : {formatType(f.type)}</span></li>
                  ))}
                  {sel.inheritedFields.map(({ owner, field }) => (
                    <li key={owner + field.name}>
                      <span className={styles.member}>
                        <span className={styles.mark}>↑</span>
                        <span>{field.name} : {formatType(field.type)}<span className={styles.why}> from {short(owner, h)}{field.modifiers.includes("private") ? ", private there" : ""}</span></span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className={styles.legend}>• declared here, ↻ overrides a parent, ↑ inherited. A dot on the right means it ran by this step.</div>
          </aside>
        )}
      </div>
    </div>
  );
}
