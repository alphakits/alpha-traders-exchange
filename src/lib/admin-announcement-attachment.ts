import "server-only";
import { createHash } from "node:crypto";

export const MAX_ANNOUNCEMENT_PDF_BYTES = 2 * 1024 * 1024;

export type AdminAnnouncementAttachment = {
  filename: string;
  contentType: "application/pdf";
  contentBase64: string;
  sizeBytes: number;
  sha256: string;
};

/** Accept uploaded bytes only. Never fetch an attachment URL or a local path. */
export function validateAdminAnnouncementAttachment(input: unknown): AdminAnnouncementAttachment | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Choose a PDF attachment.");
  }
  const attachment = input as Record<string, unknown>;
  const filename = typeof attachment.filename === "string" ? attachment.filename.normalize("NFC").trim() : "";
  if (!/^[\p{L}\p{N} _().&-]{1,120}\.pdf$/iu.test(filename)) {
    throw new Error("Use a PDF filename without paths or special control characters (up to 124 characters).");
  }
  if (attachment.contentType !== "application/pdf") {
    throw new Error("Only PDF attachments are supported.");
  }
  const content = attachment.contentBase64;
  if (typeof content !== "string" || !content.length || content.length > Math.ceil(MAX_ANNOUNCEMENT_PDF_BYTES / 3) * 4) {
    throw new Error("The PDF attachment must be no larger than 2 MB.");
  }
  if (content.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) {
    throw new Error("The PDF attachment encoding is invalid.");
  }
  const bytes = Buffer.from(content, "base64");
  if (bytes.length > MAX_ANNOUNCEMENT_PDF_BYTES || bytes.toString("base64") !== content) {
    throw new Error("The PDF attachment is invalid or larger than 2 MB.");
  }
  if (!/^%PDF-[12]\.\d[\r\n]/.test(bytes.subarray(0, 10).toString("ascii"))
    || !/%%EOF\s*$/.test(bytes.subarray(Math.max(0, bytes.length - 1024)).toString("latin1"))) {
    throw new Error("The uploaded file is not a complete PDF.");
  }
  return {
    filename,
    contentType: "application/pdf",
    contentBase64: content,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Local and reserved test addresses cannot receive an external seller guide. */
export function isAnnouncementAttachmentRecipientEmailAllowed(email: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@<>]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(normalized)) return false;
  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
  if (domain.split(".").some((label) => !label || label.startsWith("-") || label.endsWith("-"))) return false;
  return !/(?:^|\.)(?:local|localhost|test|invalid|example)$/.test(domain)
    && !/(?:^|\.)example\.(?:com|net|org)$/.test(domain);
}
