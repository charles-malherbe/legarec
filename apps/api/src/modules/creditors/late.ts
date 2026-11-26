/** Days after the due date; null when nothing is late. */
export function lateDays(due: Date | null, today: string): number | null {
  if (!due) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - due.getTime()) / 86_400_000);
  return days > 0 ? days : null;
}
