export type LinearOp = { kind: "push" | "pop" | "enqueue" | "dequeue"; value?: number };
export type LinearItem = { id: number; value: number };
export type LinearFrame = { items: LinearItem[]; op: LinearOp | null; removed: LinearItem | null };

/** Snapshots before the first operation and after each one. Items keep stable ids so they can be animated. */
export function runLinear(kind: "stack" | "queue", ops: LinearOp[]): LinearFrame[] {
  let items: LinearItem[] = [];
  let nextId = 0;
  const frames: LinearFrame[] = [{ items: [], op: null, removed: null }];
  for (const op of ops) {
    let removed: LinearItem | null = null;
    if (op.kind === "push" || op.kind === "enqueue") {
      items = [...items, { id: nextId++, value: op.value as number }];
    } else if (items.length > 0) {
      if (kind === "stack") {
        removed = items[items.length - 1];
        items = items.slice(0, -1);
      } else {
        removed = items[0];
        items = items.slice(1);
      }
    }
    frames.push({ items, op, removed });
  }
  return frames;
}
