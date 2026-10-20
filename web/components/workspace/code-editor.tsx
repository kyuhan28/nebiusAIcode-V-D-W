"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { basicSetup } from "codemirror";
import { EditorView, Decoration, keymap, type DecorationSet } from "@codemirror/view";
import { Compartment, EditorSelection, EditorState, StateEffect, StateField } from "@codemirror/state";
import { indentLess, indentMore } from "@codemirror/commands";
import { HighlightStyle, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { java } from "@codemirror/lang-java";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";

export type EditorMarker = { line: number; column: number | null; severity: "error" | "warning" | "info"; message: string };

type Props = {
  path: string | null;
  value: string;
  onChange: (path: string, value: string) => void;
  activeLine: number | null;
  markers: EditorMarker[];
  fontSize: number;
  fontFamily: string;
  /** The selected text, so the code writer can focus on it. */
  onSelection?: (text: string) => void;
  /** Put the cursor on this line and scroll to it, e.g. a method picked in the Inheritance view. */
  reveal?: { line: number; nonce: number } | null;
};

/* The line the recorded execution is on. */
const setActiveLine = StateEffect.define<number | null>();
const activeLineMark = Decoration.line({ class: "cv-active-line" });
const activeLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setActiveLine)) {
        next = e.value && e.value <= tr.state.doc.lines ? Decoration.set([activeLineMark.range(tr.state.doc.line(e.value).from)]) : Decoration.none;
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const sizing = new Compartment();
const sizeTheme = (px: number) => EditorView.theme({ "&": { fontSize: `${px}px` }, ".cm-scroller": { lineHeight: `${Math.round(px * 1.6)}px` } });

const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "#000000", color: "#e4e4e7" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { fontFamily: "var(--cv-mono), ui-monospace, monospace" },
    ".cm-content": { padding: "14px 0", caretColor: "#f4f4f5" },
    ".cm-gutters": { backgroundColor: "#000000", color: "#3f4556", border: "none", paddingLeft: "6px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#9aa3b5" },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.025)" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#6fe9ff" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "rgba(47,107,255,0.32)" },
    ".cm-matchingBracket": { backgroundColor: "rgba(111,233,255,0.14)", outline: "none" },
    ".cm-foldPlaceholder": { backgroundColor: "#11141c", border: "1px solid #2a3040", color: "#9aa3b5" },
    ".cm-panels": { backgroundColor: "#0a0c12", color: "#e4e4e7", borderTop: "1px solid rgba(255,255,255,0.08)" },
    ".cm-panels input, .cm-panels button": { color: "#e4e4e7" },
    ".cm-textfield": { backgroundColor: "#000", border: "1px solid #2a3040", borderRadius: "6px" },
    ".cm-button": { backgroundImage: "none", backgroundColor: "#141824", border: "1px solid #2a3040", borderRadius: "6px" },
    ".cm-searchMatch": { backgroundColor: "rgba(143,107,255,0.28)" },
    ".cm-tooltip": { backgroundColor: "#0a0c12", border: "1px solid #2a3040", color: "#e4e4e7" },
    ".cm-diagnostic-error": { borderLeft: "3px solid #ff5d73" },
    ".cm-diagnostic-warning": { borderLeft: "3px solid #f2c94c" },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #ff5d73 1px", textUnderlineOffset: "3px" },
    ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy #f2c94c 1px", textUnderlineOffset: "3px" },
    ".cv-active-line": { backgroundColor: "rgba(111,233,255,0.09)", boxShadow: "inset 2px 0 0 #6fe9ff", animation: "cv-line-in 380ms ease-out" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.definitionKeyword, t.controlKeyword], color: "#a995ff" },
  { tag: [t.number, t.bool, t.null], color: "#f2c94c" },
  { tag: t.string, color: "#5fd9c0" },
  { tag: [t.lineComment, t.blockComment], color: "#5c6478", fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.standard(t.typeName)], color: "#7fb4ff" },
  { tag: t.function(t.variableName), color: "#9ee8ff" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#8a93a6" },
]);

/*
 * Tab indents instead of moving focus to the next control: with no selection it inserts four
 * spaces at the cursor; with a selection it shifts the selected lines right. Shift+Tab outdents.
 */
const TAB = "    ";
const tabKeys = keymap.of([
  {
    key: "Tab",
    run: (view) => {
      if (view.state.selection.ranges.some((r) => !r.empty)) return indentMore(view);
      view.dispatch(
        view.state.changeByRange((r) => ({ changes: { from: r.from, insert: TAB }, range: EditorSelection.cursor(r.from + TAB.length) })),
        { scrollIntoView: true, userEvent: "input" },
      );
      return true;
    },
    shift: indentLess,
  },
]);

export function CodeEditor({ path, value, onChange, activeLine, markers, fontSize, fontFamily, onSelection, reveal }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const current = useRef<string | null>(null);
  const latest = useRef({ onChange, fontSize, onSelection });

  useEffect(() => {
    latest.current = { onChange, fontSize, onSelection };
  }, [onChange, fontSize, onSelection]);

  const makeState = (p: string, doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        tabKeys,
        indentUnit.of(TAB),
        basicSetup,
        /* Highlighting follows the file: Python, Java, C and C++, or plain text for data files. */
        p.endsWith(".py") ? python() : p.endsWith(".java") ? java() : /\.(c|h|cpp|cc|cxx|hpp|hh|hxx)$/.test(p) ? cpp() : [],
        syntaxHighlighting(highlight),
        theme,
        sizing.of(sizeTheme(latest.current.fontSize)),
        activeLineField,
        lintGutter(),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) latest.current.onChange(p, u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const sel = u.state.selection.main;
            latest.current.onSelection?.(u.state.sliceDoc(sel.from, sel.to));
          }
        }),
      ],
    });

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({ parent: host.current, state: EditorState.create({ doc: "" }) });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
      current.current = null;
    };
  }, []);

  /* Switch documents, keeping each file's own undo history. */
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (current.current) states.current.set(current.current, v.state);
    if (!path) {
      current.current = null;
      v.setState(EditorState.create({ doc: "", extensions: [theme, EditorState.readOnly.of(true)] }));
      return;
    }
    const cached = states.current.get(path);
    v.setState(cached && cached.doc.toString() === value ? cached : makeState(path, value));
    v.dispatch({ effects: sizing.reconfigure(sizeTheme(latest.current.fontSize)) });
    current.current = path;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  /* Outside changes to the text (imports, reverts) replace the document. */
  useEffect(() => {
    const v = view.current;
    if (!v || !path || current.current !== path) return;
    const doc = v.state.doc.toString();
    if (doc !== value) v.dispatch({ changes: { from: 0, to: doc.length, insert: value } });
  }, [value, path]);

  useEffect(() => {
    view.current?.dispatch({ effects: sizing.reconfigure(sizeTheme(fontSize)) });
  }, [fontSize]);

  /* Runs after the document switch above, so the line exists in the file just opened. */
  useEffect(() => {
    const v = view.current;
    if (!v || !reveal || reveal.line > v.state.doc.lines) return;
    const at = v.state.doc.line(reveal.line).from;
    v.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
    v.focus();
  }, [reveal?.nonce, path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = view.current;
    if (!v || !path) return;
    const effects: StateEffect<unknown>[] = [setActiveLine.of(activeLine)];
    if (activeLine && activeLine <= v.state.doc.lines) effects.push(EditorView.scrollIntoView(v.state.doc.line(activeLine).from, { y: "center" }));
    v.dispatch({ effects });
  }, [activeLine, path]);

  useEffect(() => {
    const v = view.current;
    if (!v || !path) return;
    const doc = v.state.doc;
    const diags: CmDiagnostic[] = markers
      .filter((m) => m.line >= 1 && m.line <= doc.lines)
      .map((m) => {
        const line = doc.line(m.line);
        const from = Math.min(line.from + Math.max((m.column ?? 1) - 1, 0), line.to);
        return { from, to: Math.max(from, Math.min(line.to, from + 1)), severity: m.severity, message: m.message };
      });
    v.dispatch(setDiagnostics(v.state, diags));
  }, [markers, path]);

  return <div ref={host} className="h-full" style={{ "--cv-mono": fontFamily } as CSSProperties} />;
}
