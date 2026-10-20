"use client";

import { useState } from "react";
import { fileTree, fileWarnings, isDirty, type Project, type TreeNode } from "@/lib/workspace/project";

type Props = {
  project: Project;
  onOpen: (path: string) => void;
  onCreate: (path: string) => string | null;
  onRename: (from: string, to: string) => string | null;
  onDelete: (path: string) => void;
};

const row = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition";

export function FileExplorer({ project, onOpen, onCreate, onRename, onDelete }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ mode: "new" | "rename"; path: string; value: string; error: string | null } | null>(null);

  const submit = () => {
    if (!editing) return;
    const error = editing.mode === "new" ? onCreate(editing.value.trim()) : onRename(editing.path, editing.value.trim());
    if (error) setEditing({ ...editing, error });
    else setEditing(null);
  };

  const render = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) => {
      const pad = { paddingLeft: 8 + depth * 14 };
      if (!n.file) {
        const open = !collapsed.has(n.path);
        return (
          <li key={n.path}>
            <button
              className={`${row} text-zinc-400 hover:bg-white/5 hover:text-zinc-200`}
              style={pad}
              onClick={() => setCollapsed((c) => { const s = new Set(c); if (open) s.add(n.path); else s.delete(n.path); return s; })}
              aria-expanded={open}
            >
              <span className={`inline-block w-3 text-[10px] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">▸</span>
              {n.name}
            </button>
            {open && <ul>{render(n.children, depth + 1)}</ul>}
          </li>
        );
      }
      const file = project.files.find((f) => f.path === n.path)!;
      const active = project.active === n.path;
      const warn = fileWarnings(file);
      if (editing?.mode === "rename" && editing.path === n.path) {
        return (
          <li key={n.path} style={pad} className="px-2 py-1">
            <NameInput editing={editing} setEditing={setEditing} submit={submit} />
          </li>
        );
      }
      return (
        <li key={n.path} className="group relative">
          <button
            className={`${row} ${active ? "bg-[#2f6bff]/15 text-zinc-50" : "text-zinc-300 hover:bg-white/5"}`}
            style={pad}
            onClick={() => onOpen(n.path)}
            onDoubleClick={() => setEditing({ mode: "rename", path: n.path, value: n.path, error: null })}
            title={warn.join("\n") || n.path}
          >
            <span className="w-3 text-[10px] text-[#6fe9ff]/70" aria-hidden="true">J</span>
            <span className="truncate">{n.name}</span>
            {isDirty(file) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#6fe9ff]" aria-label="Unsaved changes" />}
            {warn.length > 0 && <span className="shrink-0 text-[11px] text-[#f2c94c]" aria-label="Has warnings">!</span>}
          </button>
          <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 gap-1 bg-black/80 group-focus-within:flex group-hover:flex">
            <button className="rounded px-1.5 text-[11px] text-zinc-500 hover:bg-white/10 hover:text-zinc-200" onClick={() => setEditing({ mode: "rename", path: n.path, value: n.path, error: null })} aria-label={`Rename ${n.path}`}>Rename</button>
            <button className="rounded px-1.5 text-[11px] text-zinc-500 hover:bg-[#ff5d73]/15 hover:text-[#ff8a9a]" onClick={() => onDelete(n.path)} aria-label={`Delete ${n.path}`}>Delete</button>
          </span>
        </li>
      );
    });

  return (
    <nav aria-label="Project files" className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-[11px] font-medium text-zinc-500">Files</span>
        <button
          className="rounded-md px-2 py-0.5 text-[12px] text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100"
          onClick={() => setEditing({ mode: "new", path: "", value: "", error: null })}
        >
          New file
        </button>
      </div>
      {editing?.mode === "new" && (
        <div className="px-3 pb-2">
          <NameInput editing={editing} setEditing={setEditing} submit={submit} placeholder="com/example/App.java" />
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-auto px-1 pb-3">{render(fileTree(project.files), 0)}</ul>
    </nav>
  );
}

function NameInput({
  editing,
  setEditing,
  submit,
  placeholder,
}: {
  editing: { mode: "new" | "rename"; path: string; value: string; error: string | null };
  setEditing: (e: null | { mode: "new" | "rename"; path: string; value: string; error: string | null }) => void;
  submit: () => void;
  placeholder?: string;
}) {
  return (
    <div>
      <input
        autoFocus
        value={editing.value}
        placeholder={placeholder}
        onChange={(e) => setEditing({ ...editing, value: e.target.value, error: null })}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") setEditing(null);
        }}
        onBlur={() => !editing.value.trim() && setEditing(null)}
        className="w-full rounded-md border border-white/15 bg-black px-2 py-1 text-[13px] text-zinc-100 outline-none focus:border-[#6fe9ff]/60"
        aria-label={editing.mode === "new" ? "New file path" : "New file name"}
      />
      {editing.error && <p className="mt-1 text-[11px] text-[#ff8a9a]">{editing.error}</p>}
    </div>
  );
}
