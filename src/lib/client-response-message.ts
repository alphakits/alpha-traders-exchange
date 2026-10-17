/** Web response copy must be text; an upstream error envelope is not renderable. */
export function clientResponseMessage(value: unknown, fallback: string): string {
  // Do not stringify unexpected provider objects or expose their internal fields.
  return typeof value === "string" && value.trim() ? value : fallback;
}
