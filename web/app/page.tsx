import Link from "next/link";
import { HeroCanvas } from "@/components/landing/hero-canvas";
import { archivo } from "@/lib/fonts";

const STEPS = [
  {
    title: "Write",
    body: "Type Java in the editor, or describe what you need and let the assistant write it for you.",
    model: "Nemotron Super",
  },
  {
    title: "Watch",
    body: "Run it. Every step is recorded from the real program, then drawn as what it is: a tree, a list, a graph, an array.",
    model: "Nemotron Nano",
  },
  {
    title: "Debug",
    body: "Say what output you expected. The debugger compares it to the recorded run and shows the first step where they split.",
    model: "Nemotron Ultra",
  },
];

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 7 L7 20 M14 7 L21 20" stroke="#b9a7ff" strokeWidth="2" />
      <circle cx="14" cy="7" r="4.5" fill="#7c5cff" />
      <circle cx="7" cy="21" r="4.5" fill="#4fd8b0" />
      <circle cx="21" cy="21" r="4.5" fill="#f2c94c" />
    </svg>
  );
}

const pill =
  "inline-flex h-14 items-center justify-center rounded-full px-8 text-sm font-semibold uppercase tracking-[0.2em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-black";

export default function Home() {
  return (
    <main className={`${archivo.className} min-h-screen bg-black text-zinc-100 antialiased`}>
      <section className="relative h-svh min-h-[640px] overflow-hidden">
        <HeroCanvas className="absolute inset-0" />

        <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-6 sm:px-12 lg:px-24">
          <Link href="/" className="flex items-center gap-3 text-lg font-bold tracking-tight">
            <Logo />
            codeviz
          </Link>
          <nav className="flex items-center gap-8 text-[15px] text-zinc-300">
            <a href="#how" className="hidden transition hover:text-white sm:inline">
              How it works
            </a>
            <Link href="/workspace" className="transition hover:text-white">
              Open the app
            </Link>
          </nav>
        </header>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-16 sm:px-12 sm:pb-20 lg:px-24">
          <p className="mb-5 flex items-center gap-4 text-[11px] font-medium uppercase tracking-[0.35em] text-zinc-400 sm:text-xs">
            <span className="h-px w-12 bg-zinc-500" aria-hidden="true" />
            Java visualizer and debugger, powered by Nemotron
          </p>
          <h1 className="text-[clamp(4.5rem,15vw,13rem)] font-black leading-[0.82] tracking-[-0.05em] text-zinc-50">
            CODEVIZ
          </h1>
          <p className="mt-8 max-w-[34rem] text-lg leading-snug text-zinc-300 sm:text-2xl">
            Write Java, then watch it run. When the output looks wrong, see the exact step where it went off course.
          </p>
          <div className="pointer-events-auto mt-10 flex flex-wrap gap-4">
            <Link href="/workspace" className={`${pill} bg-zinc-50 text-black hover:bg-white`}>
              Open the visualizer
            </Link>
            <a href="#how" className={`${pill} border border-zinc-600 text-zinc-100 hover:border-zinc-300`}>
              How it works
            </a>
          </div>
        </div>

        <p className="pointer-events-none absolute bottom-8 right-6 z-10 hidden text-sm text-zinc-500 sm:right-12 md:block lg:right-24">
          Hover a structure to watch it run
        </p>

        <a
          href="#how"
          aria-label="Scroll to how it works"
          className="absolute bottom-6 left-1/2 z-10 hidden h-11 w-7 -translate-x-1/2 justify-center rounded-full border-2 border-zinc-600 pt-2 md:flex"
        >
          <span className="h-2 w-0.5 rounded-full bg-zinc-300 motion-safe:animate-bounce" />
        </a>
      </section>

      <section id="how" className="border-t border-white/10 px-6 py-24 sm:px-12 sm:py-32 lg:px-24">
        <h2 className="max-w-3xl text-4xl font-black leading-[0.95] tracking-[-0.03em] sm:text-6xl">
          From code to picture in three steps
        </h2>
        <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border-t border-white/15 pt-6">
              <span className="text-sm text-zinc-500">{i + 1}</span>
              <h3 className="mt-3 text-3xl font-bold tracking-tight">{step.title}</h3>
              <p className="mt-4 max-w-sm text-lg leading-relaxed text-zinc-400">{step.body}</p>
              <p className="mt-6 text-sm text-zinc-500">Runs on {step.model}</p>
            </li>
          ))}
        </ol>
        <div className="mt-24 flex flex-wrap items-center justify-between gap-8 border-t border-white/10 pt-12">
          <p className="max-w-xl text-2xl leading-snug text-zinc-300">
            The sample program builds a binary search tree. Run it and step through the traversal.
          </p>
          <Link href="/workspace" className={`${pill} bg-zinc-50 text-black hover:bg-white`}>
            Open the visualizer
          </Link>
        </div>
      </section>

      <footer className="flex flex-wrap justify-between gap-4 border-t border-white/10 px-6 py-8 text-sm text-zinc-500 sm:px-12 lg:px-24">
        <span>codeviz</span>
        <span>Built with Nemotron on Nebius Token Factory</span>
      </footer>
    </main>
  );
}
