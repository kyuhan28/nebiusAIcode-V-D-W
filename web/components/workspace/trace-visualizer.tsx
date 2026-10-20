"use client";

import { useEffect, useRef } from "react";
import type { createTraceArrayScene } from "@/lib/three/trace-array-scene";
import type { ArrayView } from "@/lib/trace/interpret";

type Props = { length: number; view: ArrayView | null; resetKey: number; fontFamily: string; className?: string };

export function TraceVisualizer({ length, view, resetKey, fontFamily, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createTraceArrayScene> | null>(null);
  const latest = useRef(view);

  useEffect(() => {
    let cancelled = false;
    /* Client only: three.js never runs during server rendering. Rebuilt when the length changes. */
    import("@/lib/three/trace-array-scene").then(({ createTraceArrayScene }) => {
      if (cancelled || !ref.current) return;
      const s = createTraceArrayScene(ref.current, length, fontFamily);
      s.setState(latest.current);
      scene.current = s;
    });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [length, fontFamily]);

  useEffect(() => {
    latest.current = view;
    scene.current?.setState(view);
  }, [view]);

  useEffect(() => {
    if (resetKey > 0) scene.current?.resetView();
  }, [resetKey]);

  return <div ref={ref} className={className} />;
}
