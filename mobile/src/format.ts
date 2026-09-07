/** Display helpers. All API instants are UTC; JS Date renders them locally. */

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "Today 6:30 PM" / "Tomorrow 8:00 AM" / "Mon, Sep 7 at 8:00 AM". */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const time = date.toLocaleTimeString([], TIME);
  if (isSameDay(date, now)) return `Today ${time}`;
  if (isSameDay(date, tomorrow)) return `Tomorrow ${time}`;

  const withinAWeek = date.getTime() - now.getTime() < 7 * 24 * 3600 * 1000;
  return withinAWeek
    ? `${date.toLocaleDateString([], { weekday: 'long' })} ${time}`
    : `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${time}`;
}

/** "in 2h 14m" — the countdown on the Home card. */
export function formatCountdown(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'now';

  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem ? `in ${hours}h ${rem}m` : `in ${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}
