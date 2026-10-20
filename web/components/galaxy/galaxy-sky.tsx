"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { renderSky, renderTwinkle } from "@/lib/galaxy/sky";
import "./galaxy-sky.css";

const TWINKLE = [
  { period: "6s", delay: "-1s" },
  { period: "8.5s", delay: "-5s" },
  { period: "11s", delay: "-3s" },
];

/* Layout is inline so the sky can never end up in the page flow, whatever happens to the CSS. */
const fill: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" };
const SKY: CSSProperties = { position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", pointerEvents: "none", background: "#04050d" };
const FALLBACK: CSSProperties = {
  ...fill,
  background: [
    "radial-gradient(ellipse 14% 7% at 56% 57%, rgba(255, 196, 150, 0.32), transparent 72%)",
    "radial-gradient(ellipse 34% 13% at 58% 56%, rgba(200, 120, 130, 0.2), transparent 75%)",
    "radial-gradient(ellipse 75% 20% at 50% 58%, rgba(120, 125, 200, 0.14), transparent 78%)",
    "radial-gradient(ellipse 30% 14% at 88% 82%, rgba(170, 100, 120, 0.12), transparent 75%)",
    "linear-gradient(180deg, #02030a 0%, #060818 42%, #0d0b20 72%, #080612 92%, #030308 100%)",
  ].join(", "),
};
const GLOW: CSSProperties = {
  position: "absolute", left: "56%", top: "57%", width: "46vmax", height: "18vmax", pointerEvents: "none",
  transform: "translate(-50%, -50%) rotate(-9deg)",
  background: "radial-gradient(ellipse at center, rgba(255, 190, 150, 0.2), rgba(210, 120, 140, 0.1) 40%, transparent 72%)",
};
const HAZE: CSSProperties = {
  position: "absolute", inset: "-20%", pointerEvents: "none",
  background: [
    "radial-gradient(ellipse 30% 10% at 30% 52%, rgba(140, 130, 210, 0.08), transparent 70%)",
    "radial-gradient(ellipse 26% 9% at 74% 47%, rgba(200, 140, 190, 0.07), transparent 70%)",
    "radial-gradient(ellipse 40% 14% at 55% 60%, rgba(120, 110, 190, 0.06), transparent 72%)",
  ].join(", "),
};

/**
 * The galaxy behind the whole app. It is painted once after the page first shows (the gradient
 * version stands in until then, and stays if WebGL is unavailable), and again only when the window
 * changes size noticeably. The motion is CSS on the finished image: nothing is redrawn per frame.
 */
export function GalaxySky() {
  const ref = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current, into = slot.current;
    if (!host || !into) return;
    let drawn = { w: 0, h: 0, dpr: 0 };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const clear = () => {
      for (const c of [...into.querySelectorAll("canvas")]) {
        /* Shrinking a canvas releases its pixels right away instead of waiting for collection. */
        c.width = 0;
        c.height = 0;
        c.remove();
      }
    };
    const draw = () => {
      if (cancelled) return;
      const w = window.innerWidth, h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const close = drawn.w && Math.abs(w - drawn.w) / drawn.w < 0.08 && Math.abs(h - drawn.h) / drawn.h < 0.08 && dpr === drawn.dpr;
      if (close) return;
      drawn = { w, h, dpr };
      try {
        const { canvas, stars, nebula } = renderSky(w, h, dpr);
        const twinkles = renderTwinkle(w, h, stars, TWINKLE.length);
        clear();
        canvas.className = "cvg-layer";
        Object.assign(canvas.style, fill);
        into.appendChild(canvas);
        twinkles.forEach((c, i) => {
          c.className = "cvg-twinkle";
          Object.assign(c.style, fill);
          c.style.setProperty("--period", TWINKLE[i].period);
          c.style.setProperty("--delay", TWINKLE[i].delay);
          into.appendChild(c);
        });
        host.dataset.webgl = String(nebula);
        requestAnimationFrame(() => (host.dataset.ready = "true"));
      } catch {
        /* The gradient version stays. */
        host.dataset.webgl = "false";
      }
    };
    /* After first paint, so the page itself never waits for the sky. */
    timer = setTimeout(draw, 60);
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(draw, 300);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      clear();
    };
  }, []);

  return (
    <div ref={ref} className="cvg-sky" style={SKY} aria-hidden="true" data-ready="false" data-webgl="unknown">
      {/* Everything drifts together: the stars, the band, and its glow. */}
      <div className="cvg-drift" style={{ ...fill, transform: "scale(1.1)" }}>
        <div className="cvg-fallback" style={FALLBACK} />
        <div ref={slot} style={fill} />
        <div className="cvg-glow" style={GLOW} />
      </div>
      <div className="cvg-haze" style={HAZE} />
    </div>
  );
}
