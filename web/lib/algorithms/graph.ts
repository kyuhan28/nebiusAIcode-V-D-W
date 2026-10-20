export type Graph = { labels: string[]; adj: number[][] };

export function makeGraph(labels: string[], edges: [number, number][]): Graph {
  const adj: number[][] = labels.map(() => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  adj.forEach((list) => list.sort((x, y) => x - y));
  return { labels, adj };
}

export function bfs(g: Graph, start: number) {
  const parent: (number | null)[] = g.labels.map(() => null);
  const seen = new Set([start]);
  const queue = [start];
  const order: number[] = [];
  /** Queue contents right after each node is visited and its neighbors are enqueued. */
  const queueAfter: number[][] = [];
  while (queue.length > 0) {
    const u = queue.shift() as number;
    order.push(u);
    for (const v of g.adj[u]) {
      if (seen.has(v)) continue;
      seen.add(v);
      parent[v] = u;
      queue.push(v);
    }
    queueAfter.push([...queue]);
  }
  return { order, parent, queueAfter };
}

export function dfs(g: Graph, start: number) {
  const parent: (number | null)[] = g.labels.map(() => null);
  const seen = new Set<number>();
  const order: number[] = [];
  /** The recursion stack (root to current) at the moment each node is visited. */
  const stackAt: number[][] = [];
  const stack: number[] = [];
  const visit = (u: number) => {
    seen.add(u);
    stack.push(u);
    order.push(u);
    stackAt.push([...stack]);
    for (const v of g.adj[u]) {
      if (seen.has(v)) continue;
      parent[v] = u;
      visit(v);
    }
    stack.pop();
  };
  visit(start);
  return { order, parent, stackAt };
}

/** Walks BFS parents back from the target; BFS parents give a shortest path in an unweighted graph. */
export function pathTo(parent: (number | null)[], start: number, target: number): number[] {
  const path = [target];
  let cur = parent[target];
  while (cur !== null) {
    path.push(cur);
    cur = parent[cur];
  }
  path.reverse();
  return path[0] === start ? path : [];
}
