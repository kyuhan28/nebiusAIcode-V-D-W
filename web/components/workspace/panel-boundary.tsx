"use client";

import { Component, type ReactNode } from "react";

type Props = { name: string; children: ReactNode; quiet?: boolean };
type State = { error: Error | null };

/**
 * Keeps one panel's failure inside that panel. Without it, an error while drawing a visualization
 * would take the whole page down with it; with it, the editor, files, and runs keep working and
 * the panel says what went wrong.
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[codeviz] ${this.props.name} stopped:`, error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div role="alert" className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-semibold text-zinc-200">The {this.props.name} hit an error</p>
        <p className="max-w-md break-words font-mono text-[12px] text-zinc-500">{error.message}</p>
        <p className="max-w-md text-[12px] text-zinc-500">The editor, your files, and runs still work.</p>
        <button onClick={() => this.setState({ error: null })} className="rounded-full border border-white/15 px-4 py-1.5 text-[12px] text-zinc-300 hover:border-white/30">
          Try again
        </button>
      </div>
    );
  }
}
