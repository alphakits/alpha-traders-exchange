import { logEvent } from "@/lib/structured-logging";

type RequestErrorContext = {
  routePath: string;
  routeType: "render" | "route" | "action" | "middleware";
  routerKind: "Pages Router" | "App Router";
  renderSource?: string;
  revalidateReason?: string;
};

type RequestSummary = Readonly<{
  path: string;
  method: string;
}>;

/**
 * Next.js calls this for unhandled request and rendering errors. Keep the
 * payload deliberately small and free of request headers, query values,
 * messages, stacks, or user content; Vercel logs can then alert on the stable
 * event name without leaking marketplace data.
 */
export function onRequestError(
  error: unknown,
  request: RequestSummary,
  context: RequestErrorContext,
) {
  logEvent("error", {
    event: "unhandled_request_error",
    outcome: "failed",
    reason: "unhandled_runtime_exception",
    metadata: {
      errorName: error instanceof Error ? error.name : typeof error,
      method: request.method.toUpperCase().slice(0, 12),
      routePath: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
      release: (process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown").slice(0, 12),
    },
  });
}
