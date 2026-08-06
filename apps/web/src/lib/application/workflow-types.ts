import type { ConfidentialityLevel, Visibility } from "@regapro/shared";

export type WorkflowType =
  | "general"
  | "research"
  | "document"
  | "file_review"
  | "code"
  | "prompt"
  | "task";

export const WORKFLOW_TOOL_MAP: Record<WorkflowType, string | null> = {
  general: null,
  research: "web_research",
  document: "make_doc",
  file_review: "attach_file",
  code: "make_code",
  prompt: "make_prompt",
  task: "task_manage",
};

export const WORKFLOW_TITLES: Record<WorkflowType, string> = {
  general: "新しい会話",
  research: "詳細調査",
  document: "資料・文面",
  file_review: "ファイル確認",
  code: "コード作成",
  prompt: "AI向け指示書",
  task: "タスク管理",
};

export const ASSISTANT_TOOL_TO_WORKFLOW: Record<string, WorkflowType> = {
  internal_search: "general",
  web_research: "research",
  task_manage: "task",
  draft_text: "document",
  make_doc: "document",
  make_code: "code",
  make_prompt: "prompt",
  attach_file: "file_review",
};

export type StartConversationInput = {
  workflowType: WorkflowType;
  initialMessage?: string;
  attachmentIds?: string[];
  confidentialityLevel?: ConfidentialityLevel;
  visibility?: Visibility;
  projectId?: string | null;
  idempotencyKey?: string;
  userId?: string;
  /** document subtype hint */
  documentSubtype?: "text" | "document" | "presentation";
  outputFormat?: "markdown" | "docx" | "pdf" | "xlsx" | "pptx";
};

export type StartConversationResult =
  | {
      ok: true;
      threadId: string;
      messageId: string | null;
      researchRunId: string | null;
      redirectTo: string;
      workflowType: WorkflowType;
      toolId: string | null;
    }
  | {
      ok: false;
      code: string;
      message: string;
      restoreContent?: string;
      suggestedLevel?: ConfidentialityLevel;
    };
