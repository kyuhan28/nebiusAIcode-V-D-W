import Link from "next/link";
import { Journey } from "@/components/landing/journey";
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
    <svg width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 7 L7 20 M14 7 L21 20" stroke="#3a4356" strokeWidth="2" />
      <circle cx="14" cy="7" r="4.5" fill="#6fe9ff" />
      <circle cx="7" cy="21" r="4.5" fill="#2f6bff" />
      <circle cx="21" cy="21" r="4.5" fill="#8f6bff" />
    </svg>
  );
}

const pill =
  "inline-flex h-12 items-center justify-center rounded-full px-7 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-black";

export default function Home() {
  return (
    <main className={`${archivo.className} min-h-screen bg-black text-zinc-100 antialiased`}>
      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-5 sm:px-12 lg:px-24">
        <Link href="/" className="flex items-center gap-3 text-lg font-bold tracking-tight">
          <Logo />
          codeviz
        </Link>
        <nav className="flex items-center gap-8 text-[15px] text-zinc-400">
          <a href="#how" className="hidden transition hover:text-white sm:inline">
            How it works
          </a>
          <Link href="/workspace" className="text-zinc-100 transition hover:text-white">
            Open the visualizer
          </Link>
        </nav>
      </header>

      <Journey fontFamily={archivo.style.fontFamily} />

      <section id="how" className="relative border-t border-white/10 bg-black px-6 py-24 sm:px-12 sm:py-32 lg:px-24">
        <h2 className="max-w-3xl text-4xl font-bold leading-[0.95] tracking-[-0.03em] sm:text-6xl">
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
            Start with the sample: a loop that walks an array to find its largest value.
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
