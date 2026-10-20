"use client";

import { useState } from "react";
import { CATEGORIES, EXAMPLES } from "@/lib/examples/catalog";

type Props = {
  activeId: string | null;
  onOpenExample: (id: string) => void;
};

const VISUAL: Record<string, string> = { tree: "Tree", list: "List", graph: "Graph", map: "Map", array: "Array", stack: "Array", grid: "Table", points: "Points", input: "Input", none: "" };

export function LibraryPanel({ activeId, onOpenExample }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set(CATEGORIES));
  return (
    <div className="px-1 pb-3">
      {CATEGORIES.map((cat) => {
        const isOpen = open.has(cat);
        return (
          <section key={cat} className="mb-1">
            <button
              onClick={() => setOpen((o) => { const n = new Set(o); if (isOpen) n.delete(cat); else n.add(cat); return n; })}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-medium text-zinc-500 hover:text-zinc-300"
              aria-expanded={isOpen}
            >
              <span className={`inline-block text-[9px] transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden="true">▸</span>
              {cat}
            </button>
            {isOpen && (
              <ul>
                {EXAMPLES.filter((x) => x.category === cat).map((x) => {
                  const active = activeId === x.id;
                  return (
                    <li key={x.id}>
                      <button
                        onClick={() => onOpenExample(x.id)}
                        className={`w-full rounded-md px-2.5 py-1.5 text-left transition ${active ? "bg-[#2f6bff]/15" : "hover:bg-white/5"}`}
                        title={`${x.summary}\n${x.complexity}`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className={`truncate text-[13px] ${active ? "text-zinc-50" : "text-zinc-300"}`}>{x.title}</span>
                          {VISUAL[x.visual] && <span className="shrink-0 text-[10px] text-[#6fe9ff]/60">{VISUAL[x.visual]}</span>}
                        </span>
                        {active && <span className="mt-1 block text-[11px] leading-snug text-zinc-500">{x.summary}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
