// Component tests must not open public market connections. Node's WebSocket
// also uses a different Event realm from jsdom, causing asynchronous errors.
// Stream tests install their own explicit socket fixture; hosted browser checks
// verify the real transport separately.
Object.defineProperty(globalThis, "WebSocket", {
  configurable: true,
  writable: true,
  value: undefined,
});
