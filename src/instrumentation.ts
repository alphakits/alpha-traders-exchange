export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeDiscordForRuntime } = await import("@/lib/discord");
    await initializeDiscordForRuntime();
  }
}
