"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inspect, type FrameView, type InspectNode, type ScopeView, type VarView } from "@/lib/trace/scope";
import type { HeapObj } from "@/lib/trace/interpret";
import "./scope-overlay.css";

/* Class names in scope-overlay.css. */
const styles = {
  root: "cvs-root",
  panel: "cvs-panel",
  stackPanel: "cvs-stackPanel",
  head: "cvs-head",
  heading: "cvs-heading",
  headMeta: "cvs-headMeta",
  headSpacer: "cvs-headSpacer",
  toggle: "cvs-toggle",
  varButton: "cvs-varButton",
  more: "cvs-more",
  pill: "cvs-pill",
  sig: "cvs-sig",
  frames: "cvs-frames",
  frame: "cvs-frame",
  frameHead: "cvs-frameHead",
  sigName: "cvs-sigName",
  sigArgs: "cvs-sigArgs",
  sigChanged: "cvs-sigChanged",
  frameMeta: "cvs-frameMeta",
  tags: "cvs-tags",
  tag: "cvs-tag",
  summary: "cvs-summary",
  inlineLink: "cvs-inlineLink",
  received: "cvs-received",
  returning: "cvs-returning",
  flowValue: "cvs-flowValue",
  flowFrom: "cvs-flowFrom",
  hidden: "cvs-hidden",
  vars: "cvs-vars",
  name: "cvs-name",
  eq: "cvs-eq",
  value: "cvs-value",
  type: "cvs-type",
  unknown: "cvs-unknown",
  drawn: "cvs-drawn",
  detail: "cvs-detail",
  detailMeta: "cvs-detailMeta",
  tree: "cvs-tree",
  leaf: "cvs-leaf",
  key: "cvs-key",
  note: "cvs-note",
  owner: "cvs-owner",
  staticVars: "cvs-staticVars",
} as const;

type Props = {
  scope: ScopeView | null;
  /** docked: a column over the 3D scene. stage: the centerpiece, when there is no structure to draw. */
  mode: "docked" | "stage";
  step: number;
  fontFamily: string;
};

/** Frames always shown at the top of a deep stack, plus the outermost one at the bottom. */
const HEAD = 3;
const DEEP = 6;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Tree({ nodes }: { nodes: InspectNode[] }) {
  return (
    <ul className={styles.tree}>
      {nodes.map((n, i) => (
        <li key={i}>
          {n.children?.length ? (
            <details>
              <summary>
                <span className={styles.key}>{n.label}</span> {n.value}
              </summary>
              <Tree nodes={n.children} />
            </details>
          ) : (
            <div className={styles.leaf}>
              {n.label && <span className={styles.key}>{n.label} </span>}
              {n.value}
              {n.note && <span className={styles.note}> {n.note}</span>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Detail({ v, heap }: { v: VarView; heap: Record<string, HeapObj> }) {
  const nodes = useMemo(() => inspect(v.raw, heap), [v.raw, heap]);
  return (
    <div className={styles.detail}>
      {v.runtime && <div className={styles.detailMeta}>The object is a {v.runtime}.</div>}
      {v.drawnAs && <div className={styles.detailMeta}>Drawn in the scene as {v.drawnAs}.</div>}
      {v.note && <div className={styles.note}>{v.note}</div>}
      {nodes.length ? <Tree nodes={nodes} /> : <div>{v.value}</div>}
    </div>
  );
}

function VarRow({ v, open, onToggle, heap }: { v: VarView; open: boolean; onToggle: () => void; heap: Record<string, HeapObj> }) {
  const can = v.expandable || !!v.note;
  const tip = [
    v.type ? `${v.name} : ${v.type}` : `${v.name} (type not recorded)`,
    v.changed === "value" && v.previous ? `changed from ${v.previous}` : v.changed === "contents" ? "contents changed" : "",
  ].filter(Boolean).join(", ");
  const inner = (
    <>
      <span className={styles.name}>{v.name}</span>
      <span className={styles.eq}>=</span>
      {/* Keyed by value so a new value replays its arrival; unchanged values never re-render. */}
      <span key={v.value} className={`${styles.value} ${v.note ? styles.unknown : ""}`}>
        {v.value}
        {v.drawnAs && <span className={styles.drawn} role="img" aria-label={`drawn in the scene as ${v.drawnAs}`} title={`Drawn in the scene as ${v.drawnAs}`} />}
      </span>
      <span className={styles.type}>{v.type ?? "?"}</span>
    </>
  );
  return (
    <li>
      {can ? (
        <button type="button" className={styles.varButton} data-changed={v.changed ?? undefined} data-fresh={v.fresh || undefined} aria-expanded={open} onClick={onToggle} title={tip}>
          {inner}
        </button>
      ) : (
        <div className={styles.varButton} data-changed={v.changed ?? undefined} data-fresh={v.fresh || undefined} title={tip}>
          {inner}
        </div>
      )}
      {open && can && <Detail v={v} heap={heap} />}
    </li>
  );
}

type FrameProps = {
  f: FrameView;
  step: number;
  heap: Record<string, HeapObj>;
  expanded: Set<string>;
  toggle: (key: string) => void;
  leaving?: boolean;
};

function Frame({ f, step, heap, expanded, toggle, leaving }: FrameProps) {
  const openKey = `frame:${f.key}`;
  const showRows = f.active || expanded.has(openKey);
  /* Primitive parameters already read in the header; references get a row so they can be opened. */
  const refArgs = f.args.filter((a) => a.refId && !(f.method === "main" && a.name === "args"));
  const rows = f.active ? [...refArgs, ...f.locals] : f.locals;
  const self = f.self;
  return (
    <li className={styles.frame} data-active={f.active} data-new={f.isNew && !leaving} data-leaving={leaving || undefined} aria-current={f.active ? "step" : undefined}>
      <div className={styles.frameHead}>
        <span className={styles.sig} title={f.signature}>
          <span className={styles.sigName}>{f.title}</span>
          <span className={styles.sigArgs}>
            (
            {f.args.map((a, i) => (
              <span key={a.key} className={a.changed ? styles.sigChanged : undefined}>
                {i > 0 ? ", " : ""}
                {a.name} = {a.value}
              </span>
            ))}
            )
          </span>
        </span>
      </div>

      {/* Depth and line on their own line, so the signature keeps the full width. */}
      <div className={styles.tags}>
        <span className={styles.frameMeta}>
          depth {f.depth}, line {f.line}
        </span>
        {f.active && f.isNew && !leaving && <span className={styles.tag} data-tone="call">{f.recursive ? "recursive call" : "new call"}</span>}
        {f.active && !f.isNew && f.recursive && <span className={styles.tag}>recursive</span>}
      </div>

      {f.received && (
        <div key={`r${step}`} className={styles.received}>
          <span aria-hidden="true">↓</span>
          <span className={styles.flowFrom}>{f.received.from}</span>
          <span>returned</span>
          <span className={styles.flowValue}>{f.received.value}</span>
        </div>
      )}

      {showRows ? (
        (rows.length > 0 || self) && (
          <ul className={styles.vars} aria-label={`Variables in ${f.title}`}>
            {self && <VarRow v={self} heap={heap} open={expanded.has(self.key)} onToggle={() => toggle(self.key)} />}
            {rows.map((v) => (
              <VarRow key={v.key} v={v} heap={heap} open={expanded.has(v.key)} onToggle={() => toggle(v.key)} />
            ))}
          </ul>
        )
      ) : (
        f.locals.length > 0 && (
          <button type="button" className={styles.summary} onClick={() => toggle(openKey)} aria-expanded={false} title="Show this frame's variables">
            {f.locals.map((v) => `${v.name} = ${v.value}`).join(", ")}
          </button>
        )
      )}
      {!f.active && expanded.has(openKey) && (
        <button type="button" className={styles.inlineLink} onClick={() => toggle(openKey)} aria-expanded={true}>
          Hide variables
        </button>
      )}

      {f.returning && (
        <div key={`ret${step}`} className={styles.returning}>
          <span aria-hidden="true">↓</span>
          {f.returning.isVoid ? <span>returns, no value (void)</span> : (
            <>
              <span>returns</span>
              <span className={styles.flowValue}>{f.returning.value}</span>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The program's variables as they are at the current step: static fields, then one frame per
 * active call, innermost on top. A returning frame shows its value, and on the next step that
 * value appears in the caller underneath. Click a value to see all of it.
 */
export function ScopeOverlay({ scope, mode, step, fontFamily }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [ghost, setGhost] = useState<FrameView | null>(null);
  const previous = useRef<{ scope: ScopeView | null; step: number }>({ scope: null, step: -1 });

  /* Narrow visualizers start with the stack folded into one line, so the scene stays visible. */
  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) return;
    const ro = new ResizeObserver(() => setNarrow(host.clientWidth < 520));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /* A frame that just returned slides off the top of the stack, only when playing forward one step. */
  useEffect(() => {
    const prev = previous.current;
    previous.current = { scope, step };
    const top = prev.scope?.frames[0];
    if (step === prev.step + 1 && top?.returning && scope && !scope.frames.some((f) => f.key === top.key) && !reducedMotion()) {
      setGhost({ ...top, active: false, isNew: false });
      const t = setTimeout(() => setGhost(null), 340);
      return () => clearTimeout(t);
    }
    setGhost(null);
  }, [scope, step]);

  if (!scope || (!scope.frames.length && !scope.statics.length)) return null;

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const open = mode === "stage" || (userOpen ?? !narrow);
  const frames = scope.frames;
  const deep = frames.length > DEEP && !showAll;
  const head = deep ? frames.slice(0, HEAD) : frames;
  const tail = deep ? frames.slice(-1) : [];
  const folded = frames.length - head.length - tail.length;
  const top = frames[0];
  const statics = scope.statics.filter((g) => g.vars.length);

  return (
    <div ref={rootRef} className={styles.root} data-mode={mode} data-open={open} style={{ ["--cv-mono" as string]: fontFamily }}>
      {open && statics.length > 0 && (
        <section className={styles.panel} aria-label={scope.language === "python" ? "Module globals" : "Static fields"} style={mode === "docked" ? { maxHeight: "32%", overflowY: "auto", flexShrink: 0 } : undefined}>
          <div className={styles.head}>
            <h3 className={styles.heading}>{scope.language === "python" ? "Module globals" : "Static fields"}</h3>
          </div>
          {statics.map((g) => (
            <div key={g.owner}>
              <div className={styles.owner}>{g.owner}</div>
              <ul className={`${styles.vars} ${styles.staticVars}`}>
                {g.vars.map((v) => (
                  <VarRow key={v.key} v={v} heap={scope.heap} open={expanded.has(v.key)} onToggle={() => toggle(v.key)} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {!open ? (
        <button type="button" className={styles.pill} onClick={() => setUserOpen(true)} aria-expanded={false} title="Show the call stack and variables">
          <span>Call stack</span>
          {top && <span className={styles.sig}>{top.signature}</span>}
        </button>
      ) : frames.length > 0 && (
        <section className={`${styles.panel} ${styles.stackPanel}`} aria-label="Call stack">
          <div className={styles.head}>
            <h3 className={styles.heading}>Call stack</h3>
            <span className={styles.headMeta}>
              {scope.depth} frame{scope.depth === 1 ? "" : "s"}
            </span>
            <span className={styles.headSpacer} />
            {mode === "docked" && (
              <button type="button" className={styles.toggle} onClick={() => setUserOpen(false)} aria-expanded={true}>
                Hide
              </button>
            )}
          </div>
          <ol className={styles.frames}>
            {ghost && <Frame key={`ghost:${ghost.key}`} f={ghost} step={step} heap={scope.heap} expanded={expanded} toggle={toggle} leaving />}
            {head.map((f) => (
              <Frame key={f.key} f={f} step={step} heap={scope.heap} expanded={expanded} toggle={toggle} />
            ))}
            {deep && (
              <li>
                <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
                  Show {folded} more suspended frame{folded === 1 ? "" : "s"}
                </button>
              </li>
            )}
            {tail.map((f) => (
              <Frame key={f.key} f={f} step={step} heap={scope.heap} expanded={expanded} toggle={toggle} />
            ))}
            {showAll && frames.length > DEEP && (
              <li>
                <button type="button" className={styles.more} onClick={() => setShowAll(false)}>
                  Fold the middle frames
                </button>
              </li>
            )}
          </ol>
          {scope.hidden > 0 && (
            <p className={styles.hidden}>
              {scope.hidden} outer frame{scope.hidden === 1 ? " was" : "s were"} not recorded. The recorder keeps the innermost 16.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
