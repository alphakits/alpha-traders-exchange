"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AlertTriangle, Bold, CheckCircle2, Italic, Link2, List, Loader2, Mail, Play, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AdminAnnouncementAudience, AdminAnnouncementStatus } from "@/types/alpha-exchange";

const DEFAULT_SUBJECT = "🚀 Alpha Exchange is Officially Live – A Faster, Smarter Trading Experience";
const DEFAULT_TITLE = "Alpha Exchange v1.0.1 Is Officially Live";
const DEFAULT_CONTENT = `Hello,

We're excited to announce the official launch of Alpha Exchange v1.0.1.

We've introduced major improvements across the platform, including:

• Faster Trade Room
• Real-time notifications
• Lifecycle email updates
• Improved mobile and desktop experience
• Better marketplace performance
• Smoother trading workflow

Thank you for being part of Alpha Exchange.`;

const AUDIENCE_LABELS: Record<AdminAnnouncementAudience, string> = {
  all_verified_users: "All verified users",
  buyers: "Buyers only",
  approved_sellers: "Approved sellers only",
  administrators: "Administrators only",
};

type RunSummary = {
  id: string;
  audience: AdminAnnouncementAudience;
  subject: string;
  title: string;
  status: AdminAnnouncementStatus;
  recipientCount: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  nextRetryAt?: string;
  startedAt: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ApiErrorPayload = { error?: string };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & ApiErrorPayload;
  if (!response.ok) throw new Error(payload.error || "Announcement request failed.");
  return payload;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function AdminAnnouncementsPanel() {
  const [audience, setAudience] = useState<AdminAnnouncementAudience>("all_verified_users");
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [content, setContent] = useState(DEFAULT_CONTENT);
  const [ctaText, setCtaText] = useState("Start Trading");
  const [ctaUrl, setCtaUrl] = useState("https://alphatraders.co.il");
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loadingCount, setLoadingCount] = useState(true);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [progress, setProgress] = useState<{ sent: number; failed: number; retries: number; total: number } | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const requestKeyRef = useRef<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoadingCount(true);
    try {
      const response = await fetch(`/api/alpha-exchange/admin/announcements?audience=${audience}`, {
        cache: "no-store",
      });
      const payload = await parseResponse<{ recipientCount: number; runs: RunSummary[] }>(response);
      setRecipientCount(payload.recipientCount);
      setRuns(payload.runs);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not load announcement recipients." });
    } finally {
      setLoadingCount(false);
    }
  }, [audience]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const insertFormatting = useCallback((before: string, after = before, placeholder = "text") => {
    const textarea = contentRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.slice(start, end) || placeholder;
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`;
    setContent(next);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }, [content]);

  const emailPayload = {
    subject,
    title,
    content,
    ctaText,
    ctaUrl,
  };

  const deliverRun = useCallback(async (runId: string) => {
    let finished = false;
    while (!finished) {
      const response = await fetch(`/api/alpha-exchange/admin/announcements/${encodeURIComponent(runId)}/deliver`, {
        method: "POST",
      });
      const payload = await parseResponse<{
        run: {
          id: string;
          status: AdminAnnouncementStatus;
          recipientCount: number;
          successCount: number;
          failureCount: number;
          retryCount: number;
          nextRetryAt?: string;
          finishedAt?: string;
        };
      }>(response);
      setProgress({
        sent: payload.run.successCount,
        failed: payload.run.failureCount,
        retries: payload.run.retryCount,
        total: payload.run.recipientCount,
      });
      finished = Boolean(payload.run.finishedAt);
      if (!finished && payload.run.nextRetryAt) {
        await wait(Math.max(0, new Date(payload.run.nextRetryAt).getTime() - Date.now()));
      }
      if (finished) {
        const failures = payload.run.failureCount;
        setMessage({
          type: failures === 0 ? "success" : "error",
          text: failures === 0
            ? `Announcement delivered to ${payload.run.successCount} recipients.`
            : `Delivery finished with ${payload.run.successCount} successes and ${failures} failures.`,
        });
      }
    }
  }, []);

  async function confirmAndSend() {
    if (!recipientCount) return;
    setConfirmOpen(false);
    setSending(true);
    setMessage(null);
    setProgress({ sent: 0, failed: 0, retries: 0, total: recipientCount });
    try {
      const requestKey = requestKeyRef.current ?? crypto.randomUUID();
      requestKeyRef.current = requestKey;
      const response = await fetch("/api/alpha-exchange/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey, audience, expectedRecipientCount: recipientCount, ...emailPayload }),
      });
      const payload = await parseResponse<{ run: RunSummary }>(response);
      await deliverRun(payload.run.id);
      requestKeyRef.current = null;
      await loadOverview();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Announcement delivery failed." });
      await loadOverview();
    } finally {
      setSending(false);
    }
  }

  async function resumeRun(runId: string) {
    setSending(true);
    setMessage(null);
    try {
      await deliverRun(runId);
      await loadOverview();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not resume announcement delivery." });
    } finally {
      setSending(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/alpha-exchange/admin/announcements/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: testEmail, ...emailPayload }),
      });
      await parseResponse<{ sent: true }>(response);
      setMessage({ type: "success", text: `Test announcement sent to ${testEmail.trim()}.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Test announcement failed." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="border-[#C9A227]/25 bg-[#0B0B0B]/90">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#C9A227]">Marketing</p>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-[#C9A227]" />
                Announcements
              </CardTitle>
              <CardDescription className="mt-2">
                Compose and deliver a branded email to a verified Alpha Exchange audience.
              </CardDescription>
            </div>
            <div className="rounded-xl border border-[#C9A227]/25 bg-[#C9A227]/10 px-4 py-3 text-right">
              <div className="text-2xl font-bold text-white">{loadingCount ? "—" : recipientCount ?? 0}</div>
              <div className="text-xs text-[#D6B84C]">verified recipients</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-4">
            <label className="block space-y-2 text-sm text-[#D1D5DB]">
              <span>Recipients</span>
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value as AdminAnnouncementAudience)}
                disabled={sending}
                className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-[#C9A227]/60"
              >
                {Object.entries(AUDIENCE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-2 text-sm text-[#D1D5DB]">
              <span>Subject</span>
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={180} disabled={sending} />
            </label>
            <label className="block space-y-2 text-sm text-[#D1D5DB]">
              <span>Title</span>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} disabled={sending} />
            </label>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="announcement-content" className="text-sm text-[#D1D5DB]">Rich text content</label>
                <div className="flex items-center gap-1" aria-label="Content formatting">
                  <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("**")} aria-label="Bold">
                    <Bold className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("_")} aria-label="Italic">
                    <Italic className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("• ", "", "List item")} aria-label="Bullet list">
                    <List className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => insertFormatting("[", "](https://)", "link text")} aria-label="Link">
                    <Link2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <textarea
                id="announcement-content"
                ref={contentRef}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={8_000}
                rows={14}
                disabled={sending}
                className="w-full resize-y rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-sm leading-7 text-white outline-none focus:border-[#C9A227]/60"
              />
              <p className="text-xs text-[#6B7280]">Supports bold, italic, bullet lists, and HTTPS links.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-2 text-sm text-[#D1D5DB]">
                <span>CTA Button Text</span>
                <Input value={ctaText} onChange={(event) => setCtaText(event.target.value)} maxLength={80} disabled={sending} />
              </label>
              <label className="block space-y-2 text-sm text-[#D1D5DB]">
                <span>CTA Button URL</span>
                <Input type="url" value={ctaUrl} onChange={(event) => setCtaUrl(event.target.value)} disabled={sending} />
              </label>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <p className="mb-3 text-sm font-medium text-white">Send a test first</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  type="email"
                  value={testEmail}
                  onChange={(event) => setTestEmail(event.target.value)}
                  placeholder="verified-test-account@example.com"
                  aria-label="Verified test account email"
                  disabled={testing || sending}
                />
                <Button type="button" variant="secondary" disabled={testing || sending || !testEmail.trim()} onClick={() => void sendTest()}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send Test
                </Button>
              </div>
              <p className="mt-2 text-xs text-[#6B7280]">Test delivery is restricted to an active, verified registered user.</p>
            </div>
            <Button
              type="button"
              disabled={sending || loadingCount || !recipientCount}
              onClick={() => setConfirmOpen(true)}
              className="w-full sm:w-auto"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Delivering…" : `Review and send to ${recipientCount ?? 0}`}
            </Button>
            {progress ? (
              <div className="space-y-2" aria-live="polite">
                <div className="flex justify-between text-xs text-[#9CA3AF]">
                  <span>{progress.sent} sent · {progress.failed} failed · {progress.retries} retries</span>
                  <span>{Math.min(progress.total, progress.sent + progress.failed)} / {progress.total}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-[#C9A227] transition-all"
                    style={{ width: `${progress.total ? ((progress.sent + progress.failed) / progress.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ) : null}
            {message ? (
              <div
                className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${message.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-red-500/30 bg-red-500/10 text-red-200"}`}
                role={message.type === "error" ? "alert" : "status"}
              >
                {message.type === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                {message.text}
              </div>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-[#D1D5DB]">Email preview</p>
            <div className="overflow-hidden rounded-2xl border border-[#4A3D16] bg-[#101010] shadow-2xl">
              <div className="border-b border-[#4A3D16] bg-[#171308] px-5 py-6 text-center">
                <Image src="/images/brand/alpha-traders-logo.webp" alt="Alpha Traders Academy & Exchange" width={88} height={88} className="mx-auto rounded-2xl object-cover" />
                <div className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#D6B84C]">Alpha Exchange</div>
                <h2 className="mt-3 text-2xl font-bold leading-tight text-white">{title || "Announcement title"}</h2>
              </div>
              <div className="px-5 py-6">
                <div className="whitespace-pre-wrap text-sm leading-7 text-[#D1D5DB]">{content || "Your announcement content will appear here."}</div>
                <span className="mt-6 inline-block rounded-lg bg-[#C9A227] px-5 py-3 text-sm font-bold text-black">
                  {ctaText || "CTA"}
                </span>
              </div>
              <div className="border-t border-white/10 bg-black/30 px-5 py-4 text-xs text-[#6B7280]">
                alphatraders.co.il · support@alphatraders.co.il
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0B0B0B]/90">
        <CardHeader>
          <CardTitle>Recent announcement deliveries</CardTitle>
          <CardDescription>Durable delivery logs include timing and aggregate outcomes without exposing recipient addresses.</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-black/20 p-5 text-sm text-[#9CA3AF]">No announcement deliveries yet.</p>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <div key={run.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/20 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{run.subject}</p>
                    <p className="mt-1 text-xs text-[#9CA3AF]">
                      {AUDIENCE_LABELS[run.audience]} · Started {formatDate(run.startedAt)}
                      {run.finishedAt ? ` · Finished ${formatDate(run.finishedAt)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[#D1D5DB]">{run.status.replaceAll("_", " ")}</span>
                    <span className="text-emerald-300">{run.successCount} sent</span>
                    <span className={run.failureCount ? "text-red-300" : "text-[#6B7280]"}>{run.failureCount} failed</span>
                    <span className="text-[#D6B84C]">{run.retryCount ?? 0} retries</span>
                    {(run.status === "queued" || run.status === "sending") ? (
                      <Button type="button" size="sm" variant="secondary" disabled={sending} onClick={() => void resumeRun(run.id)}>
                        <Play className="h-3.5 w-3.5" />
                        Resume
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="announcement-confirm-title">
          <div className="w-full max-w-lg rounded-2xl border border-[#C9A227]/30 bg-[#101010] p-6 shadow-2xl">
            <h2 id="announcement-confirm-title" className="text-xl font-bold text-white">Confirm announcement delivery</h2>
            <p className="mt-3 text-sm leading-6 text-[#D1D5DB]">
              This will email <strong className="text-white">{recipientCount}</strong> recipients in <strong className="text-white">{AUDIENCE_LABELS[audience]}</strong>.
              The audience is rechecked before delivery begins.
            </p>
            <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-[#9CA3AF]">
              <div className="font-medium text-white">{subject}</div>
              <div className="mt-1">{title}</div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button type="button" onClick={() => void confirmAndSend()}>
                <Send className="h-4 w-4" />
                Send announcement
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
