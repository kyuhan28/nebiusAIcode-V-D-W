export type TreeNode = { id: string; value: number; left?: string; right?: string };

export type TraceStep = {
  line: number;
  event: "enter" | "visit" | "goRight" | "done";
  nodeId: string | null;
  note: string;
  stack: string[];
  output: number[];
};

export const SAMPLE_CODE = `import java.util.*;

public class Main {
    static class Node {
        int value;
        Node left, right;
        Node(int value) { this.value = value; }
    }

    static Node insert(Node root, int value) {
        if (root == null) return new Node(value);
        if (value < root.value) root.left = insert(root.left, value);
        else root.right = insert(root.right, value);
        return root;
    }

    static void inorder(Node n, List<Integer> out) {
        if (n == null) return;
        inorder(n.left, out);
        out.add(n.value);
        inorder(n.right, out);
    }

    public static void main(String[] args) {
        Node root = null;
        for (int v : new int[]{8, 3, 10, 1, 6, 14, 4, 7, 13}) {
            root = insert(root, v);
        }
        List<Integer> out = new ArrayList<>();
        inorder(root, out);
        System.out.println(out);
    }
}
`;

const VALUES = [8, 3, 10, 1, 6, 14, 4, 7, 13];

function lineOf(snippet: string) {
  return SAMPLE_CODE.split("\n").findIndex((l) => l.includes(snippet)) + 1;
}

function buildTree() {
  const nodes: Record<string, TreeNode> = {};
  let root: string | undefined;
  for (const value of VALUES) {
    const id = `n${value}`;
    nodes[id] = { id, value };
    if (!root) {
      root = id;
      continue;
    }
    let cur = nodes[root];
    for (;;) {
      const side = value < cur.value ? "left" : "right";
      const next = cur[side];
      if (!next) {
        cur[side] = id;
        break;
      }
      cur = nodes[next];
    }
  }
  return { nodes, rootId: root as string };
}

function buildTrace(nodes: Record<string, TreeNode>, rootId: string): TraceStep[] {
  const steps: TraceStep[] = [];
  const output: number[] = [];
  const stack: string[] = [];
  const LEFT = lineOf("inorder(n.left, out);");
  const VISIT = lineOf("out.add(n.value);");
  const RIGHT = lineOf("inorder(n.right, out);");

  const walk = (id: string) => {
    const n = nodes[id];
    stack.push(id);
    const left = n.left ? nodes[n.left] : null;
    steps.push({
      line: LEFT,
      event: "enter",
      nodeId: id,
      note: left ? `At ${n.value}. Go left to ${left.value} first.` : `At ${n.value}. It has no left child.`,
      stack: [...stack],
      output: [...output],
    });
    if (n.left) walk(n.left);
    output.push(n.value);
    steps.push({
      line: VISIT,
      event: "visit",
      nodeId: id,
      note: `Visit ${n.value} and add it to the output.`,
      stack: [...stack],
      output: [...output],
    });
    if (n.right) {
      steps.push({
        line: RIGHT,
        event: "goRight",
        nodeId: id,
        note: n.left
          ? `Left side of ${n.value} is done. Go right to ${nodes[n.right].value}.`
          : `Nothing on the left of ${n.value}. Go right to ${nodes[n.right].value}.`,
        stack: [...stack],
        output: [...output],
      });
      walk(n.right);
    }
    stack.pop();
  };
  walk(rootId);

  steps.push({
    line: lineOf("System.out.println(out);"),
    event: "done",
    nodeId: null,
    note: `Done. The output is sorted: [${output.join(", ")}].`,
    stack: [],
    output: [...output],
  });
  return steps;
}

const built = buildTree();
export const DEMO_TREE = built.nodes;
export const DEMO_ROOT = built.rootId;
export const DEMO_TRACE = buildTrace(built.nodes, built.rootId);

export type VizState = { currentId: string | null; visited: Set<string>; onStack: Set<string> };

export function stateAt(steps: TraceStep[] | null, index: number): VizState {
  if (!steps) return { currentId: null, visited: new Set(), onStack: new Set() };
  const visited = new Set<string>();
  for (let i = 0; i <= index; i++) {
    const s = steps[i];
    if (s.event === "visit" && s.nodeId) visited.add(s.nodeId);
  }
  const step = steps[index];
  return { currentId: step.nodeId, visited, onStack: new Set(step.stack) };
}
