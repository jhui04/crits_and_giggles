const MINUTE_MS = 60_000;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * "just now", "5 minutes ago", then "1 hour ago" / "2 hours 5 minutes ago".
 * Never shows seconds.
 */
export function formatTimeAgo(isoTimestamp: string, now: number = Date.now()): string {
  const then = Date.parse(isoTimestamp);
  if (Number.isNaN(then)) return '';
  const totalMinutes = Math.max(0, Math.floor((now - then) / MINUTE_MS));
  if (totalMinutes < 1) return 'just now';
  if (totalMinutes < 60) return `${plural(totalMinutes, 'minute')} ago`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0
    ? `${plural(hours, 'hour')} ago`
    : `${plural(hours, 'hour')} ${plural(minutes, 'minute')} ago`;
}
