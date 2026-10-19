"use client";

import { useEffect, useRef } from "react";

export function HeroCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let dispose: (() => void) | undefined;
    // Loaded on the client only, so three.js never runs during server rendering.
    import("@/lib/three/hero-scene").then(({ createHeroScene }) => {
      if (cancelled || !ref.current) return;
      dispose = createHeroScene(ref.current).dispose;
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return <div ref={ref} className={className} aria-hidden="true" />;
}
