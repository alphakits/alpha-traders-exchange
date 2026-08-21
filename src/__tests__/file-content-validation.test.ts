import { describe, expect, it } from "vitest";
import { validateTextUploadContent, validateUploadContent } from "@/lib/file-content-validation";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("file content validation", () => {
  it("accepts only matching binary signatures", () => {
    expect(validateUploadContent(PNG, "image/png")).toBe(true);
    expect(validateUploadContent(Buffer.from("<svg onload=alert(1) />"), "image/png")).toBe(false);
    expect(validateUploadContent(Buffer.from("not a PDF"), "application/pdf")).toBe(false);
    expect(validateUploadContent(Buffer.from("%PDF-1.7"), "application/pdf")).toBe(true);
  });

  it("requires valid text encoding and JSON when those formats are selected", () => {
    expect(validateTextUploadContent(Buffer.from('{"safe":true}'), "application/json")).toBe(true);
    expect(validateTextUploadContent(Buffer.from("not-json"), "application/json")).toBe(false);
    expect(validateTextUploadContent(Buffer.from([0, 1, 2]), "text/csv")).toBe(false);
  });
});