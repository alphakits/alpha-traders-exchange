import { privateAdminResponse } from "@/lib/admin-response";
import { NextRequest, NextResponse } from "next/server";
import { adminErrorStatus, resolveAdminIdentity } from "@/lib/admin-auth";
import { readLessons, toCsv } from "@/lib/admin-store";

export async function GET(request: NextRequest) {
  try {
    await resolveAdminIdentity(request);
    const url = new URL(request.url);
    const format = url.searchParams.get("format") || "json";
    const lessons = await readLessons();

    if (format === "csv") {
      return privateAdminResponse(new NextResponse(toCsv(lessons), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="alpha-traders-lessons-${Date.now()}.csv"`,
        },
      }));
    }

    if (format === "backup") {
      return privateAdminResponse(NextResponse.json(
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
      ));
    }

    return privateAdminResponse(NextResponse.json(lessons, {
      headers: {
        "content-disposition": `attachment; filename="alpha-traders-lessons-${Date.now()}.json"`,
      },
    }));
  } catch (error) {
    return privateAdminResponse(NextResponse.json({ error: error instanceof Error ? error.message : "Failed to export academy data." }, { status: adminErrorStatus(error) }));
  }
}
