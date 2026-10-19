"use client";

import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";

type EditorInstance = Parameters<OnMount>[0];
type MonacoInstance = Parameters<OnMount>[1];
type Decorations = ReturnType<EditorInstance["createDecorationsCollection"]>;

type Props = {
  value: string;
  onChange: (value: string) => void;
  activeLine: number | null;
  fontFamily: string;
};

const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("codeviz", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "b9a7ff" },
      { token: "number", foreground: "f2c94c" },
      { token: "string", foreground: "4fd8b0" },
      { token: "comment", foreground: "6b6b80" },
      { token: "type.identifier", foreground: "f08a4b" },
    ],
    colors: {
      "editor.background": "#000000",
      "editorGutter.background": "#000000",
      "editorLineNumber.foreground": "#3f3f50",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.selectionBackground": "#7c5cff55",
      "editorCursor.foreground": "#f4f4f5",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff24",
    },
  });
};

export function CodeEditor({ value, onChange, activeLine, fontFamily }: Props) {
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<MonacoInstance | null>(null);
  const decorations = useRef<Decorations | null>(null);
  const lineRef = useRef(activeLine);

  const highlight = (line: number | null) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !decorations.current) return;
    if (!line) {
      decorations.current.clear();
      return;
    }
    decorations.current.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "cv-active-line", linesDecorationsClassName: "cv-active-gutter" },
      },
    ]);
    editor.revealLineInCenterIfOutsideViewport(line);
  };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    decorations.current = editor.createDecorationsCollection();
    highlight(lineRef.current);
  };

  useEffect(() => {
    lineRef.current = activeLine;
    highlight(activeLine);
  }, [activeLine]);

  return (
    <Editor
      height="100%"
      defaultLanguage="java"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      theme="codeviz"
      beforeMount={defineTheme}
      onMount={onMount}
      loading={<p className="p-6 text-sm text-zinc-500">Loading editor…</p>}
      options={{
        fontFamily,
        fontSize: 14,
        lineHeight: 22,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 16, bottom: 16 },
        renderLineHighlight: "none",
        smoothScrolling: true,
        automaticLayout: true,
        tabSize: 4,
      }}
    />
  );
}
