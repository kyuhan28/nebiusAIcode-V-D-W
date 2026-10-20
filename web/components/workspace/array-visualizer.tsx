"use client";

import { useEffect, useRef } from "react";
import type { createArrayScene } from "@/lib/three/array-scene";
import type { ArrayVizState } from "@/lib/trace/array-demo";

type Props = {
  values: number[];
  state: ArrayVizState;
  onCellClick: (index: number) => void;
  resetKey: number;
  className?: string;
};

export function ArrayVisualizer({ values, state, onCellClick, resetKey, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createArrayScene> | null>(null);
  const latestState = useRef(state);
  const latestClick = useRef(onCellClick);

  useEffect(() => {
    latestClick.current = onCellClick;
  }, [onCellClick]);

  useEffect(() => {
    let cancelled = false;
    // Loaded on the client only, so three.js never runs during server rendering.
    import("@/lib/three/array-scene").then(({ createArrayScene }) => {
      if (cancelled || !ref.current) return;
      const s = createArrayScene(ref.current, values, (i) => latestClick.current(i));
      s.setState(latestState.current);
      scene.current = s;
    });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [values]);

  useEffect(() => {
    latestState.current = state;
    scene.current?.setState(state);
  }, [state]);

  useEffect(() => {
    if (resetKey > 0) scene.current?.resetView();
  }, [resetKey]);

  return <div ref={ref} className={className} />;
}
