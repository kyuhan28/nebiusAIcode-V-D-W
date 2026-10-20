export type HashInsert = { key: number; item: number; bucket: number; slot: number };
export type HashProbe = { slot: number; key: number; match: boolean };

export const hashOf = (key: number, buckets: number) => key % buckets;

/** Separate chaining: each key is appended to the end of its bucket's chain. */
export function hashInserts(keys: number[], buckets: number): HashInsert[] {
  const sizes = new Array(buckets).fill(0);
  return keys.map((key, item) => {
    const bucket = hashOf(key, buckets);
    return { key, item, bucket, slot: sizes[bucket]++ };
  });
}

export function hashLookup(inserts: HashInsert[], buckets: number, key: number) {
  const bucket = hashOf(key, buckets);
  const chain = inserts.filter((e) => e.bucket === bucket).sort((a, b) => a.slot - b.slot);
  const probes: HashProbe[] = [];
  for (const entry of chain) {
    const match = entry.key === key;
    probes.push({ slot: entry.slot, key: entry.key, match });
    if (match) break;
  }
  return { bucket, probes, found: probes.some((p) => p.match) };
}
