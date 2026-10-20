export type ArrayStep = {
  line: number;
  event: "init" | "compare" | "update" | "done";
  /** The cell `i` points at, or null when the loop is over. */
  index: number | null;
  /** The cell holding the largest value found so far. */
  best: number;
  vars: { i: number | null; max: number };
  note: string;
  output: string;
};

export const DEMO_VALUES = [5, 2, 8, 1, 9, 3, 7];

export const SAMPLE_CODE = `public class Main {
    public static void main(String[] args) {
        int[] arr = {${DEMO_VALUES.join(", ")}};
        int max = arr[0];

        for (int i = 1; i < arr.length; i++) {
            if (arr[i] > max) {
                max = arr[i];
            }
        }

        System.out.println("Max: " + max);
    }
}
`;

function lineOf(snippet: string) {
  return SAMPLE_CODE.split("\n").findIndex((l) => l.includes(snippet)) + 1;
}

function buildTrace(arr: number[]): ArrayStep[] {
  const INIT = lineOf("int max = arr[0];");
  const COMPARE = lineOf("if (arr[i] > max)");
  const UPDATE = lineOf("max = arr[i];");
  const PRINT = lineOf("System.out.println");
  const steps: ArrayStep[] = [];
  let best = 0;
  let max = arr[0];

  steps.push({
    line: INIT,
    event: "init",
    index: 0,
    best,
    vars: { i: null, max },
    note: `Start with max = arr[0], which is ${max}.`,
    output: "",
  });

  for (let i = 1; i < arr.length; i++) {
    const bigger = arr[i] > max;
    steps.push({
      line: COMPARE,
      event: "compare",
      index: i,
      best,
      vars: { i, max },
      note: `i = ${i}. Is ${arr[i]} bigger than max (${max})? ${bigger ? "Yes." : `No, keep ${max}.`}`,
      output: "",
    });
    if (bigger) {
      max = arr[i];
      best = i;
      steps.push({
        line: UPDATE,
        event: "update",
        index: i,
        best,
        vars: { i, max },
        note: `max becomes ${max}.`,
        output: "",
      });
    }
  }

  steps.push({
    line: PRINT,
    event: "done",
    index: null,
    best,
    vars: { i: null, max },
    note: `Done. The largest value is ${max}, at index ${best}.`,
    output: `Max: ${max}`,
  });
  return steps;
}

export const DEMO_TRACE = buildTrace(DEMO_VALUES);

export type ArrayVizState = { current: number | null; visited: Set<number>; best: number | null };

export function arrayStateAt(steps: ArrayStep[] | null, index: number): ArrayVizState {
  if (!steps) return { current: null, visited: new Set(), best: null };
  const visited = new Set<number>();
  for (let k = 0; k <= index; k++) {
    const cell = steps[k].index;
    if (cell !== null) visited.add(cell);
  }
  const step = steps[index];
  return { current: step.index, visited, best: step.best };
}

/** The step where the loop first looks at a given cell. */
export function stepForCell(steps: ArrayStep[], cell: number) {
  return steps.findIndex((s) => s.index === cell && (s.event === "compare" || s.event === "init"));
}
