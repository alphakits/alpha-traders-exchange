// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireMobileApiUser: vi.fn(),
}));

vi.mock("@/lib/mobile-api-auth", () => ({
  requireMobileApiUser: mocks.requireMobileApiUser,
}));

import { GET as getCatalog } from "@/app/api/mobile/v1/academy/route";
import { GET as getLesson } from "@/app/api/mobile/v1/academy/lessons/[slug]/route";

function request(path: string) {
  return new NextRequest(`https://www.alphatraders.co.il${path}`, {
    headers: {
      authorization: "Bearer mobile-access-token",
      "accept-language": "en",
      "x-device-id": "550e8400-e29b-41d4-a716-446655440000",
      "x-app-version": "1.0.0",
      "x-platform": "android",
      "x-request-id": "academy-request-1",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireMobileApiUser.mockResolvedValue({
    user: { id: "student-1" },
    accessToken: "mobile-access-token",
    unauthorized: null,
  });
});

describe("mobile Academy routes", () => {
  it("returns a compact published-only bilingual catalog after device authorization", async () => {
    const response = await getCatalog(request("/api/mobile/v1/academy"));
    const payload = await response.json();
    const serialized = JSON.stringify(payload);
    const lessonSlugs = payload.courses.flatMap((course: { lessons: Array<{ slug: string }> }) => (
      course.lessons.map((lesson) => lesson.slug)
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Accept-Language, X-App-Version, X-Platform");
    expect(payload.requestId).toBe("academy-request-1");
    expect(payload.courses).toHaveLength(1);
    expect(lessonSlugs).toEqual([
      "candles-foundation",
      "trendline-precision",
      "support-resistance-engine",
      "chart-patterns-rsi-integration",
      "full-strategy-time-frame-explained",
    ]);
    expect(serialized).not.toContain("trend-and-range-context");
    expect(serialized).not.toContain("correctIndex");
    expect(serialized).not.toContain("videoProvider");
    expect(serialized).not.toContain("pdfFileId");
    expect(Buffer.byteLength(serialized)).toBeLessThan(20_000);
  });

  it("returns one full native lesson with safe absolute media and course navigation", async () => {
    const response = await getLesson(
      request("/api/mobile/v1/academy/lessons/candles-foundation"),
      { params: Promise.resolve({ slug: "candles-foundation" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.lesson).toMatchObject({
      slug: "candles-foundation",
      titleAr: expect.any(String),
      hasVideo: true,
      hasWorkbook: true,
      quizQuestionCount: 3,
      quizPassingScore: 70,
    });
    expect(payload.lesson.videoUrl).toMatch(/^https:\/\//);
    expect(payload.lesson.workbookUrl).toMatch(/^https:\/\//);
    expect(payload.lesson.presentationUrl).toMatch(/^https:\/\//);
    expect(payload.lesson.quiz[0]).toMatchObject({
      question: expect.any(String),
      questionAr: expect.any(String),
      correctIndex: expect.any(Number),
    });
    expect(payload.course.lessons).toHaveLength(5);
    expect(payload.previousLesson).toBeNull();
    expect(payload.nextLesson.slug).toBe("trendline-precision");
    for (const visual of payload.lesson.narrative.visuals) {
      expect(visual.url).toMatch(/^https:\/\//);
    }
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(50_000);
  });

  it("does not expose draft lessons and rejects malformed slugs before authorization", async () => {
    const draft = await getLesson(
      request("/api/mobile/v1/academy/lessons/trend-and-range-context"),
      { params: Promise.resolve({ slug: "trend-and-range-context" }) },
    );
    expect(draft.status).toBe(404);

    mocks.requireMobileApiUser.mockClear();
    const malformed = await getLesson(
      request("/api/mobile/v1/academy/lessons/bad%2Fslug"),
      { params: Promise.resolve({ slug: "bad/slug" }) },
    );
    expect(malformed.status).toBe(400);
    expect(mocks.requireMobileApiUser).not.toHaveBeenCalled();
  });

  it("preserves the authenticated Academy boundary", async () => {
    mocks.requireMobileApiUser.mockResolvedValueOnce({
      user: null,
      accessToken: null,
      unauthorized: NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    });
    const response = await getCatalog(request("/api/mobile/v1/academy"));
    expect(response.status).toBe(401);
  });
});
