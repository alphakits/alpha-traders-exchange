// Vitest executes server modules in an isolated test runtime. The production
// `server-only` package intentionally throws outside Next's server compiler,
// so tests resolve it to this no-op guard while application builds keep the
// real package.
export {};
