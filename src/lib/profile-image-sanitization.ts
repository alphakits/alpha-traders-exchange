import sharp from "sharp";

const MAX_PROFILE_IMAGE_PIXELS = 40_000_000;
const MAX_PROFILE_IMAGE_EDGE = 12_000;
const MAX_SAFE_OUTPUT_EDGE = 2_048;
const MAX_SAFE_OUTPUT_BYTES = 5 * 1024 * 1024;

export type SanitizedProfileImage = {
  bytes: Buffer;
  mimeType: "image/webp";
  extension: ".webp";
  width: number;
  height: number;
};

/**
 * Fully decodes and re-encodes a profile image before it reaches public
 * storage. Re-encoding removes EXIF/GPS/comments and rejects malformed or
 * decompression-heavy inputs that a magic-byte check alone cannot detect.
 */
export async function sanitizeProfileImage(bytes: Buffer): Promise<SanitizedProfileImage> {
  const image = sharp(bytes, {
    failOn: "error",
    limitInputPixels: MAX_PROFILE_IMAGE_PIXELS,
    sequentialRead: true,
  });
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width > MAX_PROFILE_IMAGE_EDGE || height > MAX_PROFILE_IMAGE_EDGE) {
    throw new Error("Invalid profile image dimensions.");
  }

  const output = await image
    .rotate()
    .resize({
      width: MAX_SAFE_OUTPUT_EDGE,
      height: MAX_SAFE_OUTPUT_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 86, effort: 4, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  if (!output.data.length || output.data.length > MAX_SAFE_OUTPUT_BYTES) {
    throw new Error("Sanitized profile image exceeds the safe output size.");
  }

  return {
    bytes: output.data,
    mimeType: "image/webp",
    extension: ".webp",
    width: output.info.width,
    height: output.info.height,
  };
}
