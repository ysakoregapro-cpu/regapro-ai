import { NextResponse } from "next/server";
import {
  getResearchRun,
  listResearchLibrary,
  listResearchRunsForThread,
  progressLabel,
} from "@/lib/application/research-service";
import { CONFIDENTIALITY_LABELS } from "@regapro/shared";
import { projectName } from "@/lib/application/catalog-service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const threadId = searchParams.get("threadId");
  const id = searchParams.get("id");

  if (id) {
    const run = getResearchRun(id);
    if (!run) {
      return NextResponse.json({ ok: false }, { status: 404 });
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
    const runs = listResearchRunsForThread(threadId);
    return NextResponse.json({
      ok: true,
      runs: runs.map((r) => ({
        ...r,
        statusLabel: progressLabel(r.status),
      })),
    });
  }

  const library = listResearchLibrary().map((r) => ({
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
}
