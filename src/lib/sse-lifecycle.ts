// These routes declare a 300-second Vercel duration. Leave a full minute for
// authorization, initial database reads and graceful transport shutdown.
export const SSE_ROTATION_INTERVAL_MS = 240_000;

// Older EventSource clients can reconnect after EOF using the retry hint.
// Current clients handle the named event without treating rotation as lost auth.
export const SSE_RECONNECT_FRAME = "retry: 1000\nevent: reconnect\ndata: {}\n\n";
