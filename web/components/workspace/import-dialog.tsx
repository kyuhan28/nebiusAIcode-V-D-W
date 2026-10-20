"use client";

import { useRef, useState } from "react";
import { previewImport, type ImportPreview } from "@/lib/workspace/zip";

type Props = {
  existing: { path: string; content: string }[];
  /** replace lists the paths whose existing file the user chose to overwrite. */
  onImport: (files: { path: string; content: string }[], replace: Set<string>) => void;
  onClose: () => void;
};

/**
 * Imported files join the project. A file identical to one already there is skipped; a different
 * file at an existing path keeps the user's version unless they choose to replace it here.
 */
export function ImportDialog({ existing, onImport, onClose }: Props) {
  const [replace, setReplace] = useState<Set<string>>(new Set());
  const statusOf = (f: { path: string; content: string }) => {
    const e = existing.find((x) => x.path === f.path);
    return !e ? "new" : e.content === f.content ? "same" : "conflict";
  };
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const uploads = await Promise.all([...list].map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
      setPreview(await previewImport(uploads, existing.map((f) => f.path)));
      setReplace(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label="Import Java files" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#05070b] p-6 shadow-[0_0_80px_rgba(47,107,255,0.12)]">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-50">Import Java files</h2>
        <p className="mt-1 text-sm text-zinc-500">Add .java files or a .zip of a project. Packages and src/main/java layouts are kept.</p>

        <button
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); read(e.dataTransfer.files); }}
          className={`mt-5 flex h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed text-sm transition ${over ? "border-[#6fe9ff] bg-[#6fe9ff]/5 text-zinc-100" : "border-white/15 text-zinc-400 hover:border-white/30"}`}
        >
          {busy ? <span className="animate-pulse text-[#6fe9ff]">Reading files…</span> : <><span className="text-zinc-200">Drop files here</span><span className="mt-1 text-zinc-500">or click to choose</span></>}
        </button>
        <input ref={input} type="file" multiple accept=".java,.zip" className="hidden" onChange={(e) => read(e.target.files)} />
        {error && <p className="mt-3 text-sm text-[#ff8a9a]">{error}</p>}

        {preview && (
          <div className="mt-5 max-h-64 overflow-auto rounded-lg border border-white/10">
            {preview.files.length > 0 && (
              <ul className="divide-y divide-white/5">
                {preview.files.map((f) => {
                  const status = statusOf(f);
                  return (
                    <li key={f.path} className="flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                      <span className="min-w-0 truncate text-zinc-200">{f.path}</span>
                      {status === "new" && <span className="shrink-0 text-zinc-600">new</span>}
                      {status === "same" && <span className="shrink-0 text-zinc-600">already in your project</span>}
                      {status === "conflict" && (
                        <label className="flex shrink-0 items-center gap-2 text-[12px] text-[#f2c94c]">
                          <span>differs from yours</span>
                          <select
                            value={replace.has(f.path) ? "replace" : "keep"}
                            onChange={(e) => setReplace((r) => { const n = new Set(r); if (e.target.value === "replace") n.add(f.path); else n.delete(f.path); return n; })}
                            className="rounded-md border border-white/15 bg-black px-1.5 py-0.5 text-[12px] text-zinc-200"
                            aria-label={`What to do with ${f.path}`}
                          >
                            <option value="keep">Keep mine</option>
                            <option value="replace">Replace mine</option>
                          </select>
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {preview.skipped.length > 0 && (
              <ul className="border-t border-white/10 px-3 py-2 text-[12px]">
                {preview.skipped.map((s) => (
                  <li key={s.path} className="py-0.5 text-zinc-500">
                    <span className="text-zinc-400">{s.path}</span> skipped: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm text-zinc-400 hover:text-zinc-100">Cancel</button>
          <button
            disabled={!preview || !preview.files.some((f) => statusOf(f) === "new" || replace.has(f.path))}
            onClick={() => preview && onImport(preview.files, replace)}
            className={`rounded-full px-5 py-2 text-sm font-semibold text-black transition disabled:opacity-30 ${replace.size ? "bg-[#ff5d73] hover:bg-[#ff7a8c]" : "bg-zinc-50 hover:bg-white"}`}
          >
            {(() => {
              const n = preview?.files.filter((f) => statusOf(f) === "new").length ?? 0;
              if (!preview) return "Import";
              if (!n && !replace.size) return "Nothing new to import";
              return `Import ${n} new${replace.size ? `, replace ${replace.size}` : ""}`;
            })()}
          </button>
        </div>
      </div>
    </div>
  );
}
