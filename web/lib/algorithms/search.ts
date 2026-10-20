export type LinearStep = { index: number; value: number; found: boolean };

export function linearSearch(arr: number[], target: number): LinearStep[] {
  const steps: LinearStep[] = [];
  for (let i = 0; i < arr.length; i++) {
    const found = arr[i] === target;
    steps.push({ index: i, value: arr[i], found });
    if (found) break;
  }
  return steps;
}

export type BinaryStep = { lo: number; hi: number; mid: number; value: number; result: "found" | "right" | "left" };

/** Requires a sorted array. */
export function binarySearch(arr: number[], target: number): BinaryStep[] {
  const steps: BinaryStep[] = [];
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const value = arr[mid];
    const result = value === target ? "found" : value < target ? "right" : "left";
    steps.push({ lo, hi, mid, value, result });
    if (result === "found") break;
    if (result === "right") lo = mid + 1;
    else hi = mid - 1;
  }
  return steps;
}
