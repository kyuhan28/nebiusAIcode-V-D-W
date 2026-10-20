"use client";

import { useEffect, useRef } from "react";
import type { createStructureScene } from "@/lib/three/structure-scene";
import type { StructureView } from "@/lib/trace/structures";

type Layer = { key: string; title: string; view: StructureView | null };
/**
 * Pass view (and its floating label, title) for one structure, or views to draw several side by
 * side in the same space, each with its own label.
 */
type Props = { view?: StructureView | null; title?: string; views?: Layer[]; resetKey: number; fontFamily: string; className?: string };

export function StructureVisualizer({ view = null, title = "", views, resetKey, fontFamily, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createStructureScene> | null>(null);
  const latest = useRef(view);
  const latestTitle = useRef(title);
  const latestMany = useRef(views);
  const apply = (s: ReturnType<typeof createStructureScene>) => {
    if (latestMany.current) s.setViews(latestMany.current);
    else s.setView(latest.current, latestTitle.current);
  };

  useEffect(() => {
    let cancelled = false;
    import("@/lib/three/structure-scene").then(({ createStructureScene }) => {
      if (cancelled || !ref.current) return;
      const s = createStructureScene(ref.current, fontFamily);
      apply(s);
      scene.current = s;
    });
    return () => {
      cancelled = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, [fontFamily]);

  useEffect(() => {
    latest.current = view;
    latestTitle.current = title;
    latestMany.current = views;
    if (scene.current) apply(scene.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, views, title]);

  useEffect(() => {
    if (resetKey > 0) scene.current?.resetView();
  }, [resetKey]);

  return <div ref={ref} className={className} />;
}
