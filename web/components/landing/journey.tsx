"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CHAPTERS, FINALE_START, OPENING_END, chapterAt, chapterFocus, local, phaseAt } from "@/lib/journey/timeline";

type Scene = { setProgress: (p: number) => void; jumpTo: (p: number) => void; dispose: () => void };

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const pill =
  "inline-flex h-12 items-center justify-center rounded-full px-7 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-black";

export function Journey({ fontFamily }: { fontFamily: string }) {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const openingRef = useRef<HTMLDivElement>(null);
  const finaleRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [phaseId, setPhaseId] = useState<string | null>(null);
  const [fallback, setFallback] = useState(false);
  const reduce = useReducedMotion() ?? false;

  const progress = useCallback(() => {
    const el = sectionRef.current;
    if (!el) return 0;
    const total = el.offsetHeight - window.innerHeight;
    return total > 0 ? Math.min(1, Math.max(0, -el.getBoundingClientRect().top / total)) : 0;
  }, []);

  /* The 3D scene is loaded on the client only, so three.js never runs during server rendering. */
  useEffect(() => {
    let cancelled = false;
    import("@/lib/three/journey/journey-scene")
      .then(({ createJourneyScene }) => {
        if (cancelled || !stageRef.current) return;
        try {
          const scene = createJourneyScene(stageRef.current, {
            reducedMotion: reduce,
            onStatus: (text) => {
              if (statusRef.current) statusRef.current.textContent = text;
            },
          });
          scene.jumpTo(progress());
          sceneRef.current = scene;
        } catch {
          setFallback(true);
        }
      })
      .catch(() => setFallback(true));
    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [reduce, progress]);

  /* Native scrolling drives everything. Nothing is hijacked; we only read the position. */
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      frame = 0;
      const p = progress();
      sceneRef.current?.setProgress(p);

      const opening = 1 - local(p, OPENING_END * 0.3, OPENING_END);
      if (openingRef.current) {
        openingRef.current.style.opacity = String(opening);
        openingRef.current.style.transform = reduce ? "" : `translateY(${(1 - opening) * -24}px)`;
      }
      if (hintRef.current) hintRef.current.style.opacity = String(1 - local(p, 0, OPENING_END * 0.4));
      const finale = local(p, FINALE_START + 0.005, FINALE_START + 0.03);
      if (finaleRef.current) {
        finaleRef.current.style.opacity = String(finale);
        finaleRef.current.style.pointerEvents = finale > 0.5 ? "auto" : "none";
      }

      const chapter = chapterAt(p);
      setChapterId(chapter?.id ?? null);
      setPhaseId(chapter ? (phaseAt(chapter, p)?.id ?? null) : null);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [progress, reduce]);

  const goTo = (p: number) => {
    const el = sectionRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + p * (el.offsetHeight - window.innerHeight), behavior: reduce ? "auto" : "smooth" });
  };

  const chapter = CHAPTERS.find((c) => c.id === chapterId) ?? null;
  const chapterIndex = chapter ? CHAPTERS.indexOf(chapter) : -1;
  const phase = chapter?.phases.find((ph) => ph.id === phaseId) ?? null;
  const rise = (delay: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.6, delay: delay * 0.3 } }
      : {
          initial: { opacity: 0, y: 28, filter: "blur(10px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 1.1, delay, ease: EASE },
        };

  return (
    <section ref={sectionRef} aria-label="A tour of data structures" className="relative h-[1800vh]">
      <div className="sticky top-0 h-svh overflow-hidden" style={{ "--journey-font": fontFamily } as CSSProperties}>
        <div ref={stageRef} className="absolute inset-0" aria-hidden="true" />

        {fallback && (
          <p className="absolute inset-x-0 top-24 z-10 text-center text-sm text-zinc-500">
            3D isn&apos;t available in this browser, so the tour is text only.
          </p>
        )}

        {/* Opening */}
        <div
          ref={openingRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-20 sm:px-12 sm:pb-24 lg:px-24"
        >
          <h1 className="text-[clamp(3rem,9.5vw,9rem)] font-bold leading-[0.88] tracking-[-0.045em] text-zinc-50">
            <motion.span className="block" {...rise(2.1)}>
              STRUCTURES.
            </motion.span>
            <motion.span className="block" {...rise(2.45)}>
              IN MOTION.
            </motion.span>
          </h1>
          <motion.p className="mt-6 max-w-md text-lg text-zinc-400 sm:text-xl" {...rise(2.9)}>
            Explore the systems that power computation.
          </motion.p>
        </div>
        <div
          ref={hintRef}
          className="pointer-events-none absolute bottom-7 left-1/2 z-10 hidden -translate-x-1/2 text-xs text-zinc-500 md:block"
        >
          Scroll to begin
        </div>

        {/* Chapter caption */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-10 sm:px-12 sm:pb-14 lg:px-24">
          <AnimatePresence mode="wait">
            {chapter && (
              <motion.div
                key={chapter.id}
                initial={{ opacity: 0, y: reduce ? 0 : 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : -10 }}
                transition={{ duration: 0.45, ease: EASE }}
                className="max-w-xl"
              >
                <p className="text-sm tabular-nums text-zinc-500">
                  {chapterIndex + 1} / {CHAPTERS.length}
                </p>
                <h2 className="mt-2 text-4xl font-bold tracking-[-0.03em] text-zinc-50 sm:text-6xl">{chapter.title}</h2>
                <p className="mt-4 max-w-md text-base leading-relaxed text-zinc-400 sm:text-lg">{chapter.body}</p>
              </motion.div>
            )}
          </AnimatePresence>
          <div className={`mt-6 max-w-2xl transition-opacity duration-300 ${chapter ? "opacity-100" : "opacity-0"}`}>
            <p className="text-sm text-[#6fe9ff]">{phase?.label ?? "\u00a0"}</p>
            <p
              ref={statusRef}
              aria-live="polite"
              className="mt-1 min-h-[1.5em] text-sm text-zinc-200 sm:text-base"
              style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
            />
          </div>
        </div>

        {/* Chapter rail */}
        <nav aria-label="Chapters" className="absolute right-6 top-1/2 z-20 hidden -translate-y-1/2 lg:block">
          <ol className="space-y-3 text-right text-sm">
            {CHAPTERS.map((c) => {
              const active = c.id === chapterId;
              return (
                <li key={c.id}>
                  <button
                    onClick={() => goTo(chapterFocus(c))}
                    className={`group inline-flex items-center gap-3 rounded-full py-1 pl-3 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
                      active ? "text-zinc-50" : "text-zinc-600 hover:text-zinc-300"
                    }`}
                    aria-current={active ? "step" : undefined}
                  >
                    {c.title}
                    <span
                      className={`h-px transition-all ${active ? "w-8 bg-[#6fe9ff]" : "w-4 bg-zinc-700 group-hover:bg-zinc-500"}`}
                      aria-hidden="true"
                    />
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* Finale */}
        <div
          ref={finaleRef}
          className="absolute inset-x-0 bottom-0 z-10 px-6 pb-16 opacity-0 sm:px-12 sm:pb-20 lg:px-24"
          style={{ pointerEvents: "none" }}
        >
          <h2 className="max-w-3xl text-[clamp(2.5rem,6vw,5.5rem)] font-bold leading-[0.95] tracking-[-0.04em] text-zinc-50">
            Every program is built from these.
          </h2>
          <p className="mt-5 max-w-md text-lg text-zinc-400">Write your own in Java and watch it run, step by step.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/workspace" className={`${pill} bg-zinc-50 text-black hover:bg-white`}>
              Open the visualizer
            </Link>
            <button onClick={() => goTo(0)} className={`${pill} border border-zinc-700 text-zinc-200 hover:border-zinc-400`}>
              Replay the tour
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
