"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import type { WorkflowType } from "@/lib/application/workflow-types";

export async function startWorkflowClient(input: {
  workflowType: WorkflowType;
  initialMessage?: string;
  confidentialityLevel?: string;
  documentSubtype?: "text" | "document" | "presentation";
  outputFormat?: "markdown" | "docx" | "pdf" | "xlsx" | "pptx";
  idempotencyKey?: string;
}): Promise<
  | { ok: true; redirectTo: string; threadId: string; toolId: string | null }
  | { ok: false; message: string }
> {
  const key = input.idempotencyKey ?? crypto.randomUUID();
  const res = await fetch("/api/chat/workflow", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({ ...input, idempotencyKey: key }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    redirectTo?: string;
    threadId?: string;
    toolId?: string | null;
    message?: string;
  };
  if (!data.ok || !data.redirectTo || !data.threadId) {
    return { ok: false, message: data.message ?? "開始できませんでした" };
  }
  return {
    ok: true,
    redirectTo: data.redirectTo,
    threadId: data.threadId,
    toolId: data.toolId ?? null,
  };
}

/** Creates an empty general thread and navigates to it. */
export function StartNewChatButton({
  className,
  label = "新しく依頼する",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const creatingRef = useRef(false);

  return (
    <button
      type="button"
      disabled={pending}
      className={
        className ??
        "inline-flex h-9 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
      }
      onClick={() => {
        if (creatingRef.current || pending) return;
        creatingRef.current = true;
        setPending(true);
        void (async () => {
          try {
            const result = await startWorkflowClient({ workflowType: "general" });
            if (result.ok) router.push(result.redirectTo);
            else setPending(false);
          } finally {
            creatingRef.current = false;
          }
        })();
      }}
    >
      {pending ? "作成中…" : label}
    </button>
  );
}

/** Button that starts a research conversation via the shared workflow. */
export function StartResearchButton({
  className,
  label = "調査を開始",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      className={
        className ??
        "inline-flex h-9 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-60"
      }
      onClick={() => {
        setPending(true);
        void (async () => {
          const result = await startWorkflowClient({ workflowType: "research" });
          if (result.ok) router.push(result.redirectTo);
          else setPending(false);
        })();
      }}
    >
      {pending ? "準備中…" : label}
    </button>
  );
}

export function HomeToolGrid() {
  const router = useRouter();
  const fileInputId = useId();
  const [pending, setPending] = useState<string | null>(null);

  const tools: {
    id: string;
    label: string;
    workflowType: WorkflowType;
    documentSubtype?: "text" | "document" | "presentation";
  }[] = [
    { id: "internal_search", label: "社内情報を探す", workflowType: "general" },
    { id: "web_research", label: "Webで調べる", workflowType: "research" },
    { id: "task_manage", label: "タスクを管理する", workflowType: "task" },
    {
      id: "draft_text",
      label: "文面を作る",
      workflowType: "document",
      documentSubtype: "text",
    },
    {
      id: "make_doc",
      label: "資料を作る",
      workflowType: "document",
      documentSubtype: "presentation",
    },
    { id: "make_code", label: "コードを作る", workflowType: "code" },
    { id: "make_prompt", label: "AI向け指示書を作る", workflowType: "prompt" },
    { id: "attach_file", label: "ファイルを追加する", workflowType: "file_review" },
  ];

  async function launch(tool: (typeof tools)[number]) {
    if (tool.id === "attach_file") {
      document.getElementById(fileInputId)?.click();
      return;
    }
    setPending(tool.id);
    const result = await startWorkflowClient({
      workflowType: tool.workflowType,
      documentSubtype: tool.documentSubtype,
    });
    if (result.ok) router.push(result.redirectTo);
    else setPending(null);
  }

  async function onFileSelected(file: File | undefined) {
    if (!file) return;
    setPending("attach_file");
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createThread: true,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      redirectTo?: string | null;
      threadId?: string;
      message?: string;
    };
    if (data.ok && data.redirectTo) {
      router.push(data.redirectTo);
    } else if (data.ok && data.threadId) {
      router.push(`/assistant?thread=${data.threadId}&tool=attach_file&focus=1`);
    } else {
      setPending(null);
    }
  }

  return (
    <section>
      <input
        id={fileInputId}
        type="file"
        className="sr-only"
        onChange={(e) => void onFileSelected(e.target.files?.[0])}
      />
      <div className="flex flex-wrap gap-2">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            disabled={pending !== null}
            onClick={() => void launch(tool)}
            className="h-8 rounded-md border border-border px-2.5 text-[12px] text-text-secondary hover:bg-surface-raised hover:text-text disabled:opacity-60"
          >
            {pending === tool.id ? "…" : tool.label}
          </button>
        ))}
      </div>
    </section>
  );
}
