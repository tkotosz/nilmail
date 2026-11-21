const locale = 'en-GB';
const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
const longDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

/** Time for today's mail, day and month for this year's, the full date before that. */
export function shortDate(millis: number, now = new Date()): string {
  const date = new Date(millis);
  if (date.toDateString() === now.toDateString()) return time.format(date);
  if (date.getFullYear() === now.getFullYear()) return dayMonth.format(date);
  return fullDate.format(date);
}

export const fullDateTime = (millis: number) => longDate.format(new Date(millis));

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A steady color for a sender's initial. */
export function senderHue(address: string): number {
  let hash = 0;
  for (const char of address.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}
