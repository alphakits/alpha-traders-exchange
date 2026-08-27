import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { checkSharedRateLimit } from "@/lib/rate-limit";
import { logEvent } from "@/lib/structured-logging";
import { getRuntimePostgresPool } from "@/lib/postgres-runtime";

const RESPONSE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const ContactSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(254),
  subject: z.string().min(2).max(200),
  message: z.string().min(10).max(4000),
  locale: z.enum(["ar", "en"]).default("en"),
  // honeypot — must be empty
  website: z.string().max(0).optional(),
});

type ContactField = "name" | "email" | "subject" | "message";

function stableContactIssues(error: z.ZodError): Partial<Record<ContactField, string[]>> {
  const result: Partial<Record<ContactField, string[]>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (field !== "name" && field !== "email" && field !== "subject" && field !== "message") continue;

    let code: string;
    if (field === "email") {
      code = issue.code === "too_big" ? "EMAIL_TOO_LONG" : issue.code === "invalid_type" ? "EMAIL_REQUIRED" : "EMAIL_INVALID";
    } else {
      const prefix = field.toUpperCase();
      if (issue.code === "too_big") code = `${prefix}_TOO_LONG`;
      else if (issue.code === "too_small") code = `${prefix}_TOO_SHORT`;
      else code = `${prefix}_REQUIRED`;
    }

    const bucket = result[field] ?? [];
    if (!bucket.includes(code)) bucket.push(code);
    result[field] = bucket;
  }
  return result;
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip + (process.env.NEXT_PUBLIC_SITE_URL ?? "")).digest("hex").slice(0, 16);
}

export async function POST(request: NextRequest) {
  // Rate limit: 5 submissions per hour per IP
  const rate = await checkSharedRateLimit({
    headers: request.headers,
    key: "contact:submit",
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "too_many_requests", retryAfterSeconds: rate.retryAfterSeconds },
      { status: 429, headers: { ...RESPONSE_HEADERS, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  // Check the honeypot before schema validation so bots receive the same
  // successful response regardless of what they placed in the hidden field.
  if (body && typeof body === "object" && !Array.isArray(body) && "website" in body) {
    const honeypotValue = String((body as { website?: unknown }).website ?? "").trim();
    if (honeypotValue) {
      return NextResponse.json({ ok: true }, { status: 200, headers: RESPONSE_HEADERS });
    }
  }

  const parsed = ContactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", issues: stableContactIssues(parsed.error) },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const { name, email, subject, message, locale } = parsed.data;

  const forwarded = request.headers.get("x-forwarded-for");
  const rawIp = forwarded ? forwarded.split(",")[0]?.trim() : request.headers.get("x-real-ip") ?? "unknown";
  const ipHash = hashIp(rawIp ?? "unknown");

  const pool = getRuntimePostgresPool();

  if (pool) {
    try {
      await pool.query(
        `INSERT INTO public.contact_submissions (name, email, subject, message, locale, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [name, email, subject, message, locale, ipHash],
      );
      logEvent("info", {
        event: "contact_submission",
        outcome: "success",
        metadata: { locale, emailDomain: email.split("@")[1] },
      });
    } catch (err) {
      logEvent("error", {
        event: "contact_submission",
        outcome: "failed",
        reason: "db_insert_failed",
        metadata: { error: String(err) },
      });
      return NextResponse.json({ error: "server_error" }, { status: 500, headers: RESPONSE_HEADERS });
    }
  } else {
    // No DB configured — log server-side only
    logEvent("warn", {
      event: "contact_submission",
      outcome: "success",
      reason: "no_db_configured",
      metadata: { name, emailDomain: email.split("@")[1], subject, locale },
    });
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: RESPONSE_HEADERS });
}
