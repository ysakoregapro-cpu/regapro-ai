import { NextResponse } from "next/server";
import { CONFIDENTIALITY_LABELS } from "@regapro/shared";
import { projectName } from "@/lib/application/catalog-service";
import { progressLabel } from "@/lib/application/research-service";
import {
  getResearchRunAsync,
  listResearchLibraryAsync,
  listResearchRunsForThreadAsync,
} from "@/lib/application/data-gateway";
import { catchToJson, jsonError } from "@/lib/application/api-errors";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get("threadId");
    const id = searchParams.get("id");

    if (id) {
      const run = await getResearchRunAsync(id);
      if (!run) {
        return jsonError("NOT_FOUND");
      }
      return NextResponse.json({
        ok: true,
        run: {
          ...run,
          statusLabel: progressLabel(run.status),
          projectLabel: projectName(run.projectId ?? ""),
          levelLabel: CONFIDENTIALITY_LABELS[run.confidentialityLevel],
        },
      });
    }

    if (threadId) {
      const runs = await listResearchRunsForThreadAsync(threadId);
      return NextResponse.json({
        ok: true,
        runs: runs.map((r) => ({
          ...r,
          statusLabel: progressLabel(r.status),
        })),
      });
    }

    const library = (await listResearchLibraryAsync()).map((r) => ({
      id: r.id,
      title: r.title,
      threadId: r.threadId,
      projectId: r.projectId,
      projectLabel: projectName(r.projectId ?? ""),
      status: r.status,
      statusLabel: progressLabel(r.status),
      confidentialityLevel: r.confidentialityLevel,
      levelLabel: CONFIDENTIALITY_LABELS[r.confidentialityLevel],
      sourceCount: r.sources.length || r.citations.length,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      updatedAt: r.completedAt ?? r.startedAt,
      isDemo: r.isDemo,
    }));

    return NextResponse.json({ ok: true, items: library });
  } catch (err) {
    return catchToJson(err);
  }
}
