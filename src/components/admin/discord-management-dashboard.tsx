"use client";

import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Command,
  Database,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DiscordManagementDiagnostics } from "@/lib/discord/management";

const HEALTHY_POLL_MS = 30_000;
const MIN_ERROR_POLL_MS = 15_000;
const MAX_ERROR_POLL_MS = 120_000;

type LoadState = "loading" | "ready" | "error";
type ActionState =
  | { status: "idle" }
  | { status: "confirming" }
  | { status: "submitting" }
  | { status: "accepted"; message: string }
  | { status: "error"; message: string };

function statusClasses(status: DiscordManagementDiagnostics["status"]) {
  if (status === "healthy") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-200";
  if (status === "degraded") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  if (status === "blocked") return "border-red-400/35 bg-red-500/10 text-red-100";
  return "border-slate-400/35 bg-slate-500/10 text-slate-200";
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return "Not available";
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
      <dt className="text-xs font-medium uppercase tracking-[0.12em] text-[#9CA3AF]">
        {label}
      </dt>
      <dd className="mt-1 break-words text-lg font-semibold text-white">{value}</dd>
    </div>
  );
}

function StatusIcon({ status }: { status: DiscordManagementDiagnostics["status"] }) {
  if (status === "healthy") return <CheckCircle2 aria-hidden className="h-5 w-5" />;
  if (status === "degraded") return <AlertTriangle aria-hidden className="h-5 w-5" />;
  if (status === "blocked") return <XCircle aria-hidden className="h-5 w-5" />;
  return <Server aria-hidden className="h-5 w-5" />;
}

export function DiscordManagementDashboard() {
  const [diagnostics, setDiagnostics] =
    useState<DiscordManagementDiagnostics | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const failureCount = useRef(0);
  const diagnosticsRef = useRef<DiscordManagementDiagnostics | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const reconcileTrigger = useRef<HTMLButtonElement>(null);
  const confirmationDialog = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const schedule = useCallback((delay: number, callback: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    if (document.visibilityState !== "visible") return;
    timer.current = setTimeout(callback, delay);
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    try {
      const response = await fetch("/api/admin/discord/diagnostics", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as
        | DiscordManagementDiagnostics
        | { error?: string; code?: string };
      if (!("status" in payload)) {
        throw new Error(payload.error ?? "Diagnostics are unavailable.");
      }
      if (!mounted.current) return;
      diagnosticsRef.current = payload;
      setDiagnostics(payload);
      setLoadState("ready");
      setLoadError(null);
      failureCount.current = 0;
      schedule(HEALTHY_POLL_MS, () => void load());
    } catch {
      if (!mounted.current) return;
      failureCount.current += 1;
      setLoadState(diagnosticsRef.current ? "ready" : "error");
      setLoadError("Diagnostics could not be refreshed. The last confirmed state is preserved.");
      const delay = Math.min(
        MAX_ERROR_POLL_MS,
        MIN_ERROR_POLL_MS * (2 ** (failureCount.current - 1)),
      );
      schedule(delay, () => void load());
    } finally {
      inFlight.current = false;
    }
  }, [schedule]);

  useEffect(() => {
    mounted.current = true;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void load();
      else if (timer.current) clearTimeout(timer.current);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void load();
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  useEffect(() => {
    if (action.status === "confirming") confirmButton.current?.focus();
  }, [action.status]);

  const closeConfirmation = () => {
    setAction({ status: "idle" });
    queueMicrotask(() => reconcileTrigger.current?.focus());
  };

  const handleConfirmationKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = confirmationDialog.current?.querySelectorAll<HTMLButtonElement>(
      "button:not([disabled])",
    );
    if (!controls || controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const requestReconciliation = async () => {
    setAction({ status: "submitting" });
    queueMicrotask(() => reconcileTrigger.current?.focus());
    try {
      const response = await fetch("/api/admin/discord/reconcile", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          confirmation: "reconcile_managed_integration",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = await response.json() as {
        disposition?: "accepted" | "coalesced" | "replayed";
        status?: "pending" | "processing" | "completed" | "dead";
        resultCode?: string | null;
        error?: string;
      };
      if (!response.ok || !payload.disposition || !payload.status) {
        throw new Error(payload.error ?? "The request was not accepted.");
      }
      setAction({
        status: "accepted",
        message: payload.disposition === "replayed"
          ? `The original request is ${payload.status}${
              payload.resultCode ? ` (${payload.resultCode})` : ""
            }.`
          : payload.disposition === "coalesced"
          ? `An active reconciliation already exists (${payload.status}).`
          : "Reconciliation was accepted and is pending Railway processing.",
      });
      schedule(1_000, () => void load());
    } catch (error) {
      setAction({
        status: "error",
        message: error instanceof Error
          ? error.message
          : "The request could not be persisted.",
      });
    }
  };

  if (loadState === "loading") {
    return (
      <main className="section-container min-h-[70vh] py-10" aria-busy="true">
        <div className="animate-pulse rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="h-8 w-64 max-w-full rounded bg-white/10" />
          <div className="mt-4 h-4 w-full rounded bg-white/5" />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-36 rounded-2xl bg-white/5" />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (!diagnostics) {
    return (
      <main className="section-container min-h-[70vh] py-10">
        <Card className="border-red-400/30 bg-red-500/5">
          <CardHeader>
            <CardTitle>Discord Management is unavailable</CardTitle>
            <CardDescription>
              {loadError ?? "No verified diagnostic state was returned."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="min-h-11" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const db = diagnostics.database;
  const latestOperator = db.operatorRequests.latest;

  return (
    <main className="section-container min-h-screen overflow-x-clip py-8 sm:py-10">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="rounded-3xl border border-[#C9A227]/30 bg-gradient-to-br from-[#C9A227]/10 via-black/65 to-black p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#D4AF37]">
                Private operator surface
              </p>
              <h1 className="mt-2 break-words text-3xl font-semibold text-white sm:text-4xl">
                Discord Management
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#B8BDC8]">
                Aggregate health only. Discord mutations remain Railway-owned and no
                Discord IDs, account data, raw payloads, or secrets are shown.
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#D8C98B]">
                Monitoring and reconciliation only. Seller approvals, role decisions,
                listings, payments, and trades stay in the authoritative website workflows.
              </p>
            </div>
            <div
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 self-start rounded-full border px-4 py-2 text-sm font-semibold ${statusClasses(diagnostics.status)}`}
              role="status"
              aria-label={`Integration status: ${diagnostics.status}`}
            >
              <StatusIcon status={diagnostics.status} />
              <span className="capitalize">{diagnostics.status}</span>
            </div>
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-[#8E96A3]">
            <Clock3 aria-hidden className="h-4 w-4" />
            Verified {formatTimestamp(diagnostics.generatedAt)}
          </p>
          {loadError ? (
            <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">
              {loadError}
            </p>
          ) : null}
        </div>

        <section aria-labelledby="worker-health-heading" className="grid gap-4 lg:grid-cols-2">
          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle id="worker-health-heading" className="flex items-center gap-2">
                <Bot aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                Railway worker
              </CardTitle>
              <CardDescription>Signed readiness response and gateway state.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label="Ready" value={diagnostics.worker.ready ? "Yes" : "No"} />
                <Stat label="Gateway" value={diagnostics.worker.readyState} />
                <Stat label="Latency" value={
                  diagnostics.worker.apiLatencyMs === null
                    ? "Not available"
                    : `${Math.round(diagnostics.worker.apiLatencyMs)} ms`
                } />
                <Stat label="Connection uptime" value={
                  formatDuration(diagnostics.worker.connectionUptimeMs)
                } />
                <Stat label="Environment" value={
                  diagnostics.worker.deployment.environment ?? "Not injected"
                } />
                <Stat label="Source revision" value={
                  diagnostics.worker.deployment.revision?.slice(0, 12) ?? "Not injected"
                } />
              </dl>
              {diagnostics.worker.error ? (
                <p className="mt-3 break-words rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                  {diagnostics.worker.error.code}: {diagnostics.worker.error.message}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                Managed resources
              </CardTitle>
              <CardDescription>Integration-owned categories, channels, and permissions.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-3">
                <Stat label="Ready" value={diagnostics.resources.ready ?? "Unknown"} />
                <Stat label="Total" value={diagnostics.resources.total ?? "Unknown"} />
                <Stat label="Missing" value={diagnostics.resources.missing ?? "Unknown"} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {diagnostics.topology.map((resource) => (
                  <span key={resource.key} className="max-w-full break-words rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[#D1D5DB]">
                    {resource.name} · {resource.type}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section aria-label="Discord aggregate health" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                Identities and seller roles
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label="Connected identities" value={db.identities.connected} />
                <Stat label="Approved synced" value={db.approvedSellerRoleSync.synced} />
                <Stat label="Role pending" value={db.approvedSellerRoleSync.pending} />
                <Stat label="Role failed" value={db.approvedSellerRoleSync.failed} />
              </dl>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                Listings and jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label="Active posts" value={db.listings.activePosts} />
                <Stat label="Cooldown claims" value={db.listings.cooldownClaims} />
                <Stat label="Jobs pending" value={db.listings.jobs.pending} />
                <Stat label="Jobs processing" value={db.listings.jobs.processing} />
                <Stat label="Jobs dead" value={db.listings.jobs.dead} />
                <Stat label="Stale leases" value={db.listings.jobs.staleLeases} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {Object.entries(db.listings.lifecycle).map(([state, value]) => (
                  <span key={state} className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-[#D1D5DB]">
                    {state.replaceAll("_", " ")}: {value}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                Market singletons
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {db.marketContent.map((content) => (
                <div key={content.key} className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="break-words text-sm font-semibold text-white">
                    {content.key.replaceAll("_", " ")}
                  </p>
                  <p className="mt-1 text-xs capitalize text-[#B8BDC8]">
                    {content.state} · Last success {formatTimestamp(content.lastSuccessAt)}
                  </p>
                  {content.errorCode ? (
                    <p className="mt-1 break-words text-xs text-amber-200">{content.errorCode}</p>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                Welcome and approval delivery
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label="Pending" value={db.notifications.pending} />
                <Stat label="Processing" value={db.notifications.processing} />
                <Stat label="Completed" value={db.notifications.completed} />
                <Stat label="Suppressed" value={db.notifications.suppressed} />
                <Stat label="Dead" value={db.notifications.dead} />
              </dl>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Command aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                Commands and interactions
              </CardTitle>
              <CardDescription>
                Guild Members intent is mandatory. Registered commands never mutate listings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 min-[390px]:grid-cols-2">
                <Stat label="Registered" value={`${diagnostics.commands.registered ?? "?"}/${diagnostics.commands.expected}`} />
                <Stat label="Accepted 24h" value={db.interactions.accepted24h} />
                <Stat label="Rate limited 24h" value={db.interactions.rateLimited24h} />
                <Stat label="Replayed 24h" value={db.interactions.replayed24h} />
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                {diagnostics.commands.names.map((name) => (
                  <code key={name} className="rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 px-3 py-1.5 text-xs text-[#F4D87A]">
                    /{name}
                  </code>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 border-white/10 bg-[#0A0A0A]/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle aria-hidden className="h-5 w-5 text-[#D4AF37]" />
                Recent safe errors
              </CardTitle>
              <CardDescription>Codes and timestamps only; no raw provider payloads.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {db.recentErrors.length === 0 ? (
                <p className="text-sm text-emerald-200">No current safe error codes.</p>
              ) : db.recentErrors.map((error, index) => (
                <div key={`${error.source}-${error.occurredAt}-${index}`} className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
                  <p className="break-words text-sm font-medium text-white">
                    {error.source}: {error.code}
                  </p>
                  <p className="mt-1 text-xs text-[#9CA3AF]">{formatTimestamp(error.occurredAt)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <Card className="min-w-0 border-[#C9A227]/30 bg-gradient-to-br from-[#C9A227]/8 to-black">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw aria-hidden className="h-5 w-5 text-[#D4AF37]" />
              Safe operator control
            </CardTitle>
            <CardDescription>
              Requests are audited, coalesced, and processed by Railway. There are no
              cooldown resets, role overrides, SOLD recreation, raw deletes, or arbitrary targets.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Pending" value={db.operatorRequests.pending} />
              <Stat label="Processing" value={db.operatorRequests.processing} />
              <Stat label="Dead" value={db.operatorRequests.dead} />
              <Stat label="Stale leases" value={db.operatorRequests.staleLeases} />
            </div>
            {latestOperator ? (
              <p className="mt-4 break-words text-sm text-[#B8BDC8]">
                Latest request: <strong className="text-white">{latestOperator.status}</strong>
                {latestOperator.resultCode ? ` · ${latestOperator.resultCode}` : ""}
                {" · "}{formatTimestamp(latestOperator.updatedAt)}
              </p>
            ) : null}
            <div className="mt-5">
              {action.status === "confirming" ? (
                <div
                  ref={confirmationDialog}
                  className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4"
                  role="alertdialog"
                  aria-modal="true"
                  aria-labelledby="reconcile-confirm-title"
                  aria-describedby="reconcile-confirm-description"
                  onKeyDown={handleConfirmationKeyDown}
                >
                  <h2 id="reconcile-confirm-title" className="font-semibold text-white">
                    Confirm managed reconciliation
                  </h2>
                  <p id="reconcile-confirm-description" className="mt-2 text-sm leading-6 text-amber-50">
                    Railway will verify integration-owned resources, commands, active listing
                    content, and market singletons. Existing active work is reused.
                  </p>
                  <div className="mt-4 flex flex-col gap-2 min-[390px]:flex-row">
                    <Button
                      ref={confirmButton}
                      className="min-h-11"
                      onClick={() => void requestReconciliation()}
                    >
                      Confirm and enqueue
                    </Button>
                    <Button
                      className="min-h-11"
                      variant="secondary"
                      onClick={closeConfirmation}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  ref={reconcileTrigger}
                  className="min-h-11 w-full sm:w-auto"
                  disabled={action.status === "submitting"}
                  onClick={() => setAction({ status: "confirming" })}
                >
                  {action.status === "submitting"
                    ? "Enqueuing…"
                    : "Reconcile managed resources, commands, and content"}
                </Button>
              )}
              {action.status === "accepted" || action.status === "error" ? (
                <p
                  className={`mt-3 rounded-xl border p-3 text-sm ${
                    action.status === "accepted"
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                      : "border-red-400/30 bg-red-500/10 text-red-100"
                  }`}
                  role="status"
                >
                  {action.message}
                </p>
              ) : null}
              <p className="mt-4 text-xs leading-5 text-[#8E96A3]">
                Dead jobs are diagnostic-only. Investigate the safe error code and authoritative
                website state before support intervention; generic retry is intentionally unavailable.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
