import type { LessonAsset } from "@/types/academy";

export type LessonPdfSource = {
  provider: LessonAsset["pdfProvider"];
  embedUrl: string;
  downloadUrl: string;
  openUrl: string;
};

function normalizeGoogleDriveId(fileId: string, fallbackUrl: string) {
  if (fileId) return fileId;
  const fromFileUrl = fallbackUrl.match(/\/d\/([^/]+)/)?.[1];
  return fromFileUrl ?? "";
}

export function resolveLessonPdfSource(asset: LessonAsset): LessonPdfSource {
  if (asset.pdfProvider === "google-drive") {
    const fileId = normalizeGoogleDriveId(asset.pdfFileId, asset.pdfUrl);
    if (!fileId) {
      return {
        provider: asset.pdfProvider,
        embedUrl: asset.pdfUrl,
        downloadUrl: asset.pdfUrl,
        openUrl: asset.pdfUrl,
      };
    }

    return {
      provider: asset.pdfProvider,
      embedUrl: `https://drive.google.com/file/d/${fileId}/preview`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${fileId}`,
      openUrl: `https://drive.google.com/file/d/${fileId}/view`,
    };
  }

  return {
    provider: asset.pdfProvider,
    embedUrl: asset.pdfUrl,
    downloadUrl: asset.pdfUrl,
    openUrl: asset.pdfUrl,
  };
}
