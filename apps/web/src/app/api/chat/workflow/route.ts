import { NextResponse } from "next/server";
import { z } from "zod";
import { ConfidentialityLevelSchema, VisibilitySchema } from "@regapro/shared";
import { startConversationWorkflowAsync } from "@/lib/application/data-gateway";
import type { WorkflowType } from "@/lib/application/workflow-types";
import { catchToJson } from "@/lib/application/api-errors";

const WorkflowTypeSchema = z.enum([
  "general",
  "research",
  "document",
  "file_review",
  "code",
  "prompt",
  "task",
]);

const BodySchema = z.object({
  workflowType: WorkflowTypeSchema,
  initialMessage: z.string().optional(),
  attachmentIds: z.array(z.string()).optional(),
  confidentialityLevel: ConfidentialityLevelSchema.optional(),
  visibility: VisibilitySchema.optional(),
  projectId: z.string().nullable().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  documentSubtype: z.enum(["text", "document", "presentation"]).optional(),
  outputFormat: z.enum(["markdown", "docx", "pdf", "xlsx", "pptx"]).optional(),
});

export async function POST(request: Request) {
  try {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json(
        { ok: false, code: "EMPTY", message: "不正なリクエストです" },
        { status: 400 },
      );
    }

    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, code: "EMPTY", message: "入力内容を確認してください" },
        { status: 400 },
      );
    }

    const idempotencyKey =
      parsed.data.idempotencyKey ??
      request.headers.get("Idempotency-Key") ??
      undefined;

    const result = await startConversationWorkflowAsync({
      workflowType: parsed.data.workflowType as WorkflowType,
      initialMessage: parsed.data.initialMessage,
      attachmentIds: parsed.data.attachmentIds,
      confidentialityLevel: parsed.data.confidentialityLevel,
      visibility: parsed.data.visibility,
      projectId: parsed.data.projectId,
      idempotencyKey,
      documentSubtype: parsed.data.documentSubtype,
      outputFormat: parsed.data.outputFormat,
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    return catchToJson(err);
  }
}
