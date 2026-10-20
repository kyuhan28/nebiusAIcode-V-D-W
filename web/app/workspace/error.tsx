"use client";

/**
 * Shown if the workspace itself fails to render, instead of a blank page. The message is the
 * real error, so it can be reported as is.
 */
export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-black p-8 text-center text-zinc-200">
      <h1 className="text-lg font-semibold">The workspace could not load</h1>
      <p className="max-w-xl break-words font-mono text-[13px] text-zinc-400">{error.message || "Unknown error"}</p>
      <p className="max-w-xl text-sm text-zinc-500">Your saved files are kept in this browser and are not affected. Try again, and if this keeps happening, copy the message above.</p>
      <button onClick={reset} className="rounded-full bg-zinc-50 px-5 py-2 text-sm font-semibold text-black">Try again</button>
    </main>
  );
}
