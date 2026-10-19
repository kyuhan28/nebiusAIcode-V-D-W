"use client";

import { useEffect, useRef } from "react";
import type { createTreeScene } from "@/lib/three/tree-scene";
import { DEMO_ROOT, DEMO_TREE, type VizState } from "@/lib/trace/inorder-demo";

type Props = {
  state: VizState;
  onNodeClick: (id: string) => void;
  resetKey: number;
  className?: string;
};

export function TreeVisualizer({ state, onNodeClick, resetKey, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createTreeScene> | null>(null);
  const latestState = useRef(state);
  const latestClick = useRef(onNodeClick);

  useEffect(() => {
    latestClick.current = onNodeClick;
  }, [onNodeClick]);

  useEffect(() => {
    let cancelled = false;
    // Loaded on the client only, so three.js never runs during server rendering.
    import("@/lib/three/tree-scene").then(({ createTreeScene }) => {
      if (cancelled || !ref.current) return;
      const s = createTreeScene(ref.current, DEMO_TREE, DEMO_ROOT, (id) => latestClick.current(id));
      s.setState(latestState.current);
      scene.current = s;
    });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    latestState.current = state;
    scene.current?.setState(state);
  }, [state]);

  useEffect(() => {
    if (resetKey > 0) scene.current?.resetView();
  }, [resetKey]);

  return <div ref={ref} className={className} />;
}
