export function startOfUtcDay(now = new Date()): Date {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function daysAgoUtc(days: number, now = new Date()): Date {
  const start = startOfUtcDay(now);
  start.setUTCDate(start.getUTCDate() - days);
  return start;
}
