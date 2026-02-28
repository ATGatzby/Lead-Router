/** Generate a short random ID for client-side use (not persisted). */
export function nanoid(): string {
  return Math.random().toString(36).slice(2, 10);
}
