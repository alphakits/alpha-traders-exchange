const IMAGE_SIGNATURES = {
  "image/jpeg": (bytes: Buffer) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  "image/png": (bytes: Buffer) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (bytes: Buffer) => bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP",
  "image/gif": (bytes: Buffer) => bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a",
} as const;

export type ValidatedUploadType = keyof typeof IMAGE_SIGNATURES | "application/pdf" | "video/mp4" | "video/webm";

function hasTextLikeBytes(bytes: Buffer) {
  if (!bytes.length || bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function validateUploadContent(bytes: Buffer, mimeType: ValidatedUploadType) {
  const imageValidator = IMAGE_SIGNATURES[mimeType as keyof typeof IMAGE_SIGNATURES];
  if (imageValidator) return imageValidator(bytes);
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "video/mp4") return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
  if (mimeType === "video/webm") return bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}

export function validateTextUploadContent(bytes: Buffer, mimeType: "application/json" | "text/csv") {
  if (!hasTextLikeBytes(bytes)) return false;
  if (mimeType === "application/json") {
    try {
      JSON.parse(bytes.toString("utf8"));
    } catch {
      return false;
    }
  }
  return true;
}