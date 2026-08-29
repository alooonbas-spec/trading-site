export type StatusCount<T extends string> = {
  status: T;
  count: number;
};

export function tallyByStatus<T extends string>(
  statuses: readonly T[],
  values: readonly T[],
): StatusCount<T>[] {
  const counts = new Map<T, number>(statuses.map((status) => [status, 0]));
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return statuses.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

export function statusCount(counts: readonly StatusCount<string>[], status: string): number {
  return counts.find((item) => item.status === status)?.count ?? 0;
}

export function sumCounts(counts: readonly StatusCount<string>[]): number {
  return counts.reduce((total, item) => total + item.count, 0);
}
