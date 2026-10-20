export type BSTNode = {
  id: number;
  value: number;
  left: number | null;
  right: number | null;
  parent: number | null;
  depth: number;
};

export type TraversalKind = "preorder" | "inorder" | "postorder";

export function buildBST(values: number[]) {
  const nodes: BSTNode[] = [];
  values.forEach((value, id) => {
    const node: BSTNode = { id, value, left: null, right: null, parent: null, depth: 0 };
    nodes.push(node);
    if (id === 0) return;
    let cur = nodes[0];
    for (;;) {
      const side = value < cur.value ? "left" : "right";
      const next = cur[side];
      if (next === null) {
        cur[side] = id;
        node.parent = cur.id;
        node.depth = cur.depth + 1;
        break;
      }
      cur = nodes[next];
    }
  });
  return { nodes, root: 0 };
}

export function traverse(nodes: BSTNode[], root: number, kind: TraversalKind): number[] {
  const out: number[] = [];
  const walk = (id: number | null) => {
    if (id === null) return;
    const n = nodes[id];
    if (kind === "preorder") out.push(id);
    walk(n.left);
    if (kind === "inorder") out.push(id);
    walk(n.right);
    if (kind === "postorder") out.push(id);
  };
  walk(root);
  return out;
}

/** Node ids from a to b along tree edges: up from a to their lowest common ancestor, then down to b. */
export function pathBetween(parentOf: (id: number) => number | null, a: number, b: number): number[] {
  const ancestors = (id: number) => {
    const chain = [id];
    let p = parentOf(id);
    while (p !== null) {
      chain.push(p);
      p = parentOf(p);
    }
    return chain;
  };
  const up = ancestors(a);
  const down = ancestors(b);
  const lca = up.find((id) => down.includes(id));
  if (lca === undefined) return [a, b];
  return [...up.slice(0, up.indexOf(lca) + 1), ...down.slice(0, down.indexOf(lca)).reverse()];
}
