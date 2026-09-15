function normalizeBaseUrl(value: string | undefined) {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function parentUrl(value: string | undefined) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    parsed.pathname = parsed.pathname.replace(/\/[^/]*$/, "");
    parsed.search = "";
    parsed.hash = "";
    return normalizeBaseUrl(parsed.toString());
  } catch {
    return "";
  }
}

const EXPLICIT_LESSON_VIDEO_BASE_URL = normalizeBaseUrl(process.env.NEXT_PUBLIC_LESSON_VIDEO_BASE_URL);
const FOUNDER_VIDEO_DIRECTORY_URL = parentUrl(process.env.NEXT_PUBLIC_FOUNDER_VIDEO_URL);
const SUPABASE_COURSE_VIDEO_BASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${normalizeBaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)}/storage/v1/object/public/course-videos`
  : "";
const LESSON_VIDEO_BASE_URL = EXPLICIT_LESSON_VIDEO_BASE_URL
  || FOUNDER_VIDEO_DIRECTORY_URL
  || SUPABASE_COURSE_VIDEO_BASE_URL;

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
