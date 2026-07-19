import { NextRequest, NextResponse } from "next/server";
import { resolveAdminIdentity } from "@/lib/admin-auth";
import { buildAnalytics, readLessons, readMediaLibrary, readVersions } from "@/lib/admin-store";
import { courses } from "@/lib/content";

export async function GET(request: NextRequest) {
  try {
    await resolveAdminIdentity(request);
    const [lessons, media, versions] = await Promise.all([readLessons(), readMediaLibrary(), readVersions()]);
    return NextResponse.json({
      lessons,
      courses,
      media,
      versions: versions.slice(0, 50),
      analytics: buildAnalytics(lessons),
      roles: ["admin", "editor", "instructor", "student"],
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load admin bootstrap data." },
      { status: 401 },
    );
  }
}
