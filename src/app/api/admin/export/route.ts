import { NextRequest, NextResponse } from "next/server";
import { resolveAdminIdentity } from "@/lib/admin-auth";
import { readLessons, toCsv } from "@/lib/admin-store";

export async function GET(request: NextRequest) {
  try {
    resolveAdminIdentity(request);
    const url = new URL(request.url);
    const format = url.searchParams.get("format") || "json";
    const lessons = await readLessons();

    if (format === "csv") {
      return new NextResponse(toCsv(lessons), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="alpha-traders-lessons-${Date.now()}.csv"`,
        },
      });
    }

    if (format === "backup") {
      return NextResponse.json(
        {
          exportedAt: new Date().toISOString(),
          version: 1,
          lessons,
        },
        {
          headers: {
            "content-disposition": `attachment; filename="alpha-traders-backup-${Date.now()}.json"`,
          },
        },
      );
    }

    return NextResponse.json(lessons, {
      headers: {
        "content-disposition": `attachment; filename="alpha-traders-lessons-${Date.now()}.json"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to export academy data." }, { status: 400 });
  }
}
