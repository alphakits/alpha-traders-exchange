import { describe, expect, it } from "vitest";
import {
  MAX_ANNOUNCEMENT_PDF_BYTES,
  isAnnouncementAttachmentRecipientEmailAllowed,
  validateAdminAnnouncementAttachment,
} from "./admin-announcement-attachment";

const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const upload = {
  filename: "Seller Guide & Rules.pdf",
  contentType: "application/pdf",
  contentBase64: pdfBytes.toString("base64"),
};

describe("owner announcement PDF validation", () => {
  it("keeps the exact file bytes and derives trusted metadata", () => {
    const result = validateAdminAnnouncementAttachment({ ...upload, sizeBytes: 1, sha256: "client-supplied" });
    expect(result).toMatchObject({ ...upload, sizeBytes: pdfBytes.length });
    expect(result?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result?.sha256).not.toBe("client-supplied");
    expect(validateAdminAnnouncementAttachment(undefined)).toBeUndefined();
  });

  it.each([
    null,
    { ...upload, filename: "../guide.pdf" },
    { ...upload, filename: "guide\r\nBcc: someone.pdf" },
    { ...upload, contentType: "text/html" },
    { ...upload, contentBase64: "https://example.com/guide.pdf" },
    { ...upload, contentBase64: Buffer.from("<html>not PDF</html>").toString("base64") },
    { ...upload, contentBase64: Buffer.from("%PDF-1.7\ntruncated").toString("base64") },
    { ...upload, contentBase64: `${upload.contentBase64}\n` },
  ])("rejects malformed, non-PDF or unsafe uploads", (value) => {
    expect(() => validateAdminAnnouncementAttachment(value)).toThrow();
  });

  it("rejects files above the 2 MB limit before delivery", () => {
    expect(() => validateAdminAnnouncementAttachment({
      ...upload,
      contentBase64: Buffer.alloc(MAX_ANNOUNCEMENT_PDF_BYTES + 1).toString("base64"),
    })).toThrow(/2 MB/);
  });

  it.each(["seller@alpha.local", "test@localhost", "seller@example.com", "seller@sub.example.org", "seller@domain.test", "bad@@gmail.com", "bad@a..com"])("excludes non-deliverable internal/test addresses", (email) => {
    expect(isAnnouncementAttachmentRecipientEmailAllowed(email)).toBe(false);
  });

  it.each([" Seller+guide@gmail.com ", "seller@yahoo.com", "seller@alphatraders.co.il"])("accepts public seller email addresses", (email) => {
    expect(isAnnouncementAttachmentRecipientEmailAllowed(email)).toBe(true);
  });
});
