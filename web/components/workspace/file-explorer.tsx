"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { fileTree, fileWarnings, isDirty, type Project, type TreeNode } from "@/lib/workspace/project";

type Props = {
  project: Project;
  onOpen: (path: string) => void;
  onCreate: (path: string) => string | null;
  onRename: (from: string, to: string) => string | null;
  onDelete: (path: string) => void;
  onCreateFolder: (path: string) => string | null;
  onRenameFolder: (from: string, to: string) => string | null;
  onDeleteFolder: (path: string) => void;
  onAddExamples: () => void;
};

type Mode = "new" | "rename" | "folder" | "renameFolder";
type Editing = { mode: Mode; path: string; value: string; error: string | null };
type MenuItem = { label: string; run: () => void; danger?: boolean } | "separator";
type Menu = { x: number; y: number; title: string; items: MenuItem[] };

const row = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] transition";
const DRAG = "application/x-codeviz-file";
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/**
 * Every file and folder in the project. Right-click a file, a folder, or empty space for its
 * actions (the Menu key or Shift+F10 does the same from the keyboard). Adding, importing, and
 * examples only ever add here; removing something takes an explicit Delete. Drag a file onto a
 * folder to move it.
 */
export function FileExplorer({ project, onOpen, onCreate, onRename, onDelete, onCreateFolder, onRenameFolder, onDeleteFolder, onAddExamples }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  /* The folder new files and folders go into: the one last clicked, or the clicked file's folder. */
  const [folder, setFolder] = useState("");
  const inFolder = (folder && project.files.some((f) => f.path.startsWith(folder + "/"))) || project.folders.includes(folder) ? folder : "";
  const start = inFolder ? `${inFolder}/` : "";

  const submit = () => {
    if (!editing) return;
    const v = editing.value.trim();
    const error =
      editing.mode === "new" ? onCreate(v)
        : editing.mode === "rename" ? onRename(editing.path, v)
          : editing.mode === "folder" ? onCreateFolder(v)
            : onRenameFolder(editing.path, v);
    if (error) setEditing({ ...editing, error });
    else {
      if (editing.mode !== "rename" && editing.mode !== "renameFolder") {
        /* Open the folder something was just created in. */
        const parent = parentOf(v);
        if (parent) setCollapsed((c) => { const s = new Set(c); s.delete(parent); return s; });
      }
      setEditing(null);
    }
  };

  /* ---------------- Context menus ---------------- */

  const newIn = (dir: string, mode: "new" | "folder") => {
    if (dir) setCollapsed((c) => { const s = new Set(c); s.delete(dir); return s; });
    setEditing({ mode, path: "", value: dir ? `${dir}/` : "", error: null });
  };
  const folderItems = (path: string): MenuItem[] => [
    { label: "New file here", run: () => newIn(path, "new") },
    { label: "New folder here", run: () => newIn(path, "folder") },
    "separator",
    { label: "Rename or move", run: () => setEditing({ mode: "renameFolder", path, value: path, error: null }) },
    { label: "Delete folder", danger: true, run: () => onDeleteFolder(path) },
  ];
  const fileItems = (path: string): MenuItem[] => [
    { label: "Open", run: () => onOpen(path) },
    { label: parentOf(path) ? "New file in this folder" : "New file", run: () => newIn(parentOf(path), "new") },
    "separator",
    { label: "Rename or move", run: () => setEditing({ mode: "rename", path, value: path, error: null }) },
    { label: "Delete file", danger: true, run: () => onDelete(path) },
  ];
  const rootItems: MenuItem[] = [
    { label: "New file", run: () => newIn("", "new") },
    { label: "New folder", run: () => newIn("", "folder") },
    "separator",
    { label: "Add an example", run: onAddExamples },
  ];

  const openMenu = (e: MouseEvent, title: string, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, title, items });
  };
  /* The Menu key and Shift+F10 open the same menu next to the focused row. */
  const menuKey = (e: KeyboardEvent<HTMLElement>, title: string, items: MenuItem[]) => {
    if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.left + 24, y: r.bottom, title, items });
  };

  const drop = (target: string) => (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const path = e.dataTransfer.getData(DRAG);
    if (!path) return;
    const to = (target ? target + "/" : "") + path.split("/").pop();
    if (to === path) return;
    setMoveError(onRename(path, to));
  };
  const over = (target: string) => (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(target);
  };

  const render = (nodes: TreeNode[], depth: number) =>
    nodes.map((n) => {
      const pad = { paddingLeft: 8 + depth * 14 };
      if (!n.file) {
        const open = !collapsed.has(n.path);
        if (editing?.mode === "renameFolder" && editing.path === n.path) {
          return (
            <li key={n.path} style={pad} className="px-2 py-1">
              <NameInput editing={editing} setEditing={setEditing} submit={submit} />
            </li>
          );
        }
        return (
          <li key={n.path} onDragOver={over(n.path)} onDragLeave={() => setDropTarget(null)} onDrop={drop(n.path)}>
            <button
              className={`${row} hover:bg-white/5 hover:text-zinc-200 ${inFolder === n.path ? "text-zinc-100" : "text-zinc-400"} ${dropTarget === n.path ? "bg-[#6fe9ff]/10 ring-1 ring-[#6fe9ff]/40" : ""} ${menu?.title === n.path ? "bg-white/10" : ""}`}
              style={pad}
              onClick={() => {
                setFolder(n.path);
                setCollapsed((c) => { const s = new Set(c); if (open) s.add(n.path); else s.delete(n.path); return s; });
              }}
              onContextMenu={(e) => openMenu(e, n.path, folderItems(n.path))}
              onKeyDown={(e) => menuKey(e, n.path, folderItems(n.path))}
              aria-expanded={open}
              aria-haspopup="menu"
              title={`${n.path}\nRight-click for options`}
            >
              <span className={`inline-block w-3 text-[10px] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">▸</span>
              <span className="truncate">{n.name}</span>
              {n.children.length === 0 && <span className="text-[11px] text-zinc-600">empty</span>}
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
        <li key={n.path}>
          <button
            className={`${row} ${active ? "bg-[#2f6bff]/15 text-zinc-50" : "text-zinc-300 hover:bg-white/5"} ${menu?.title === n.path && !active ? "bg-white/10" : ""}`}
            style={pad}
            onClick={() => {
              onOpen(n.path);
              setFolder(parentOf(n.path));
            }}
            onDoubleClick={() => setEditing({ mode: "rename", path: n.path, value: n.path, error: null })}
            onContextMenu={(e) => openMenu(e, n.path, fileItems(n.path))}
            onKeyDown={(e) => menuKey(e, n.path, fileItems(n.path))}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData(DRAG, n.path); e.dataTransfer.effectAllowed = "move"; setMoveError(null); }}
            title={[...warn, n.path, "Right-click for options"].join("\n")}
            aria-current={active ? "page" : undefined}
            aria-haspopup="menu"
          >
            <span className="w-3 text-[10px] text-[#6fe9ff]/70" aria-hidden="true">{n.name.endsWith(".py") ? "Py" : n.name.endsWith(".java") ? "J" : /\.c$/.test(n.name) ? "C" : /\.(cpp|cc|cxx)$/.test(n.name) ? "C+" : /\.(h|hpp|hh|hxx)$/.test(n.name) ? "H" : "D"}</span>
            <span className="truncate">{n.name}</span>
            {isDirty(file) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#6fe9ff]" aria-label="Unsaved changes" />}
            {warn.length > 0 && <span className="shrink-0 text-[11px] text-[#f2c94c]" aria-label="Has warnings">!</span>}
          </button>
        </li>
      );
    });

  const placeholder = editing?.mode === "folder" ? "animals" : "com/example/App.java";
  return (
    <nav aria-label="Project files" className="flex h-full flex-col" onContextMenu={(e) => openMenu(e, "", rootItems)}>
      <div className="flex items-center gap-1 px-3 pb-2 pt-3" onKeyDown={(e) => menuKey(e, "", rootItems)}>
        <span className="text-[11px] font-medium text-zinc-500" title="Right-click for New file and New folder">Files</span>
        <span className="text-[11px] text-zinc-600">{project.files.length}</span>
        <span className="flex-1" />
        <button className="rounded-md px-2 py-0.5 text-[12px] text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100" onClick={() => setEditing({ mode: "new", path: "", value: start, error: null })} title={inFolder ? `New file in ${inFolder}` : "New file"}>
          New file
        </button>
        <button className="rounded-md px-2 py-0.5 text-[12px] text-zinc-400 transition hover:bg-white/10 hover:text-zinc-100" onClick={() => setEditing({ mode: "folder", path: "", value: start, error: null })} title={inFolder ? `New folder in ${inFolder}` : "New folder"}>
          New folder
        </button>
      </div>
      {(editing?.mode === "new" || editing?.mode === "folder") && (
        <div className="px-3 pb-2">
          {editing.value.includes("/") && <p className="pb-1 text-[11px] text-zinc-600">In {editing.value.slice(0, editing.value.lastIndexOf("/"))}/. Clear the path to put it at the top level.</p>}
          <NameInput editing={editing} setEditing={setEditing} submit={submit} placeholder={placeholder} />
        </div>
      )}
      {moveError && <p className="px-3 pb-2 text-[11px] text-[#ff8a9a]">{moveError}</p>}
      <ul
        className={`min-h-0 flex-1 overflow-auto px-1 pb-3 ${dropTarget === "" ? "bg-[#6fe9ff]/5" : ""}`}
        onDragOver={over("")}
        onDragLeave={() => setDropTarget(null)}
        onDrop={drop("")}
        aria-label="Files and folders. Right-click for options; drag a file onto a folder to move it."
      >
        {render(fileTree(project.files, project.folders), 0)}
        <li className="px-2 pt-3">
          <button onClick={onAddExamples} className="text-[12px] text-zinc-600 transition hover:text-zinc-300">+ Add an example to this project</button>
        </li>
      </ul>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </nav>
  );
}

/**
 * A small menu at the pointer. It closes on choosing an item, Escape, a click elsewhere, scrolling,
 * or resizing, and keeps itself inside the window. Positioned with inline styles, so it works
 * without any stylesheet.
 */
function ContextMenu({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  /* Held in a ref so re-renders while the menu is open never re-run the setup below. */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ x: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)) });
      el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close.current(); };
    const shut = () => close.current();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", shut);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("blur", shut);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", shut);
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("blur", shut);
    };
  }, [menu]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={menu.title ? `Actions for ${menu.title}` : "Files"}
      onKeyDown={onKey}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 60, minWidth: 184 }}
      className="rounded-lg border border-white/10 bg-[#0a0c12] py-1 shadow-[0_12px_32px_rgba(0,0,0,0.6)]"
    >
      {menu.title && <div className="truncate px-3 pb-1 pt-0.5 text-[11px] text-zinc-600" style={{ maxWidth: 260 }}>{menu.title}</div>}
      {menu.items.map((item, i) =>
        item === "separator" ? (
          <div key={i} role="separator" className="my-1 h-px bg-white/10" />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            type="button"
            onClick={() => { onClose(); item.run(); }}
            className={`block w-full px-3 py-1.5 text-left text-[12.5px] outline-none transition ${item.danger ? "text-[#ff8a9a] hover:bg-[#ff5d73]/15 focus:bg-[#ff5d73]/15" : "text-zinc-300 hover:bg-white/10 focus:bg-white/10"}`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

function NameInput({ editing, setEditing, submit, placeholder }: { editing: Editing; setEditing: (e: Editing | null) => void; submit: () => void; placeholder?: string }) {
  const label = { new: "New file path", rename: "New file path", folder: "New folder path", renameFolder: "New folder path" }[editing.mode];
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
        aria-label={label}
      />
      {editing.error && <p className="mt-1 text-[11px] text-[#ff8a9a]">{editing.error}</p>}
    </div>
  );
}
