// Academy administration uses both a session cookie and an optional admin key.
// Apply this to success, export and denial responses so neither browser nor
// intermediary caches retain private content or reuse an anonymous denial.
export function privateAdminResponse<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  const vary = new Set((response.headers.get("Vary") ?? "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!vary.has("*")) {
    vary.add("cookie");
    vary.add("x-admin-key");
    response.headers.set("Vary", [...vary].join(", "));
  }
  return response;
}
