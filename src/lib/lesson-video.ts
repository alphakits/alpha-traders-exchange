const LESSON_VIDEO_BASE_URL = (process.env.NEXT_PUBLIC_LESSON_VIDEO_BASE_URL ?? "").trim().replace(/\/+$/, "");

const LESSON_VIDEO_FILE_RE = /^lesson-\d+-[a-z0-9-]+\.mp4$/i;

function toBaseFilename(url: string) {
  const clean = url.split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

function toSupabaseRelativePath(url: string) {
  const filename = toBaseFilename(url);
  if (!LESSON_VIDEO_FILE_RE.test(filename)) {
    return url;
  }
  return `/${filename}`;
}

export function isLessonVideoUrl(url: string) {
  return LESSON_VIDEO_FILE_RE.test(toBaseFilename(url));
}

export function resolveLessonVideoUrl(url: string) {
  if (!url) return "";
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }

  const normalizedPath = toSupabaseRelativePath(url);
  if (!normalizedPath.startsWith("/")) {
    return normalizedPath;
  }
  if (!LESSON_VIDEO_BASE_URL) {
    return normalizedPath;
  }
  return `${LESSON_VIDEO_BASE_URL}${normalizedPath}`;
}

export function resolveLessonResourceUrl(url: string) {
  if (!isLessonVideoUrl(url)) return url;
  return resolveLessonVideoUrl(url);
}

