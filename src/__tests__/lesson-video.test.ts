import { afterEach, describe, expect, it, vi } from "vitest";

async function loadResolver(env: {
  lessonBase?: string;
  founderVideo?: string;
  supabaseUrl?: string;
}) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_LESSON_VIDEO_BASE_URL", env.lessonBase ?? "");
  vi.stubEnv("NEXT_PUBLIC_FOUNDER_VIDEO_URL", env.founderVideo ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.supabaseUrl ?? "");
  return import("@/lib/lesson-video");
}

describe("lesson video URLs", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the explicit lesson video base when configured", async () => {
    const { resolveLessonVideoUrl } = await loadResolver({
      lessonBase: "https://media.example.test/course/",
      founderVideo: "https://storage.example.test/founder.mp4",
    });

    expect(resolveLessonVideoUrl("/lesson-2-candles.mp4"))
      .toBe("https://media.example.test/course/lesson-2-candles.mp4");
  });

  it("derives the lesson directory from the configured founder video", async () => {
    const { resolveLessonVideoUrl } = await loadResolver({
      founderVideo: "https://project.supabase.co/storage/v1/object/public/course-videos/alpha-traders-founder-introduction.mp4?download=1",
    });

    expect(resolveLessonVideoUrl("/lesson-2-candles.mp4"))
      .toBe("https://project.supabase.co/storage/v1/object/public/course-videos/lesson-2-candles.mp4");
  });

  it("falls back to the public Supabase course-videos bucket", async () => {
    const { resolveLessonVideoUrl } = await loadResolver({
      supabaseUrl: "https://project.supabase.co/",
    });

    expect(resolveLessonVideoUrl("/files/course/lesson-3-trendline.mp4"))
      .toBe("https://project.supabase.co/storage/v1/object/public/course-videos/lesson-3-trendline.mp4");
  });
});
