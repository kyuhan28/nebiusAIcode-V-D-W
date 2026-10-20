"use client";

import { useRef, useState } from "react";
import { previewImport, type ImportPreview } from "@/lib/workspace/zip";

type Props = { existing: string[]; onImport: (files: { path: string; content: string }[]) => void; onClose: () => void };

export function ImportDialog({ existing, onImport, onClose }: Props) {
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
      setPreview(await previewImport(uploads, existing));
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
                {preview.files.map((f) => (
                  <li key={f.path} className="flex items-center justify-between px-3 py-2 text-[13px]">
                    <span className="text-zinc-200">{f.path}</span>
                    <span className={existing.includes(f.path) ? "text-[#f2c94c]" : "text-zinc-600"}>{existing.includes(f.path) ? "replaces existing" : "new"}</span>
                  </li>
                ))}
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
            disabled={!preview || preview.files.length === 0}
            onClick={() => preview && onImport(preview.files)}
            className="rounded-full bg-zinc-50 px-5 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-30"
          >
            {preview?.files.length ? `Import ${preview.files.length} file${preview.files.length === 1 ? "" : "s"}` : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
