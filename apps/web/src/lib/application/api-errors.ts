import { NextResponse } from "next/server";

/** User-facing failure codes — never include PostgREST/SQL internals. */
export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "INTERNAL";

export function publicErrorMessage(code: AppErrorCode): string {
  switch (code) {
    case "UNAUTHENTICATED":
      return "ログインが必要です。再度ログインしてください。";
    case "FORBIDDEN":
      return "この操作を行う権限がありません。";
    case "NOT_FOUND":
      return "対象が見つかりません。";
    case "VALIDATION":
      return "入力内容を確認してください。";
    case "CONFLICT":
      return "状態が競合しています。画面を更新してやり直してください。";
    default:
      return "処理に失敗しました。しばらくしてから再度お試しください。";
  }
}

export function classifyThrown(err: unknown): AppErrorCode {
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNAUTHENTICATED|not authenticated|JWT|session/i.test(msg)) {
    return "UNAUTHENTICATED";
  }
  if (
    /row-level security|permission denied|42501|FORBIDDEN|NO_ORGANIZATION/i.test(
      msg,
    )
  ) {
    return "FORBIDDEN";
  }
  if (/not found|PGRST116|404/i.test(msg)) {
    return "NOT_FOUND";
  }
  return "INTERNAL";
}

export function jsonError(
  code: AppErrorCode,
  status?: number,
  extra?: Record<string, unknown>,
) {
  const statusCode =
    status ??
    (code === "UNAUTHENTICATED"
      ? 401
      : code === "FORBIDDEN"
        ? 403
        : code === "NOT_FOUND"
          ? 404
          : code === "VALIDATION"
            ? 400
            : code === "CONFLICT"
              ? 409
              : 500);
  console.error(`[api] ${code}`, extra?.log ?? "");
  return NextResponse.json(
    {
      ok: false,
      code,
      message: publicErrorMessage(code),
      ...Object.fromEntries(
        Object.entries(extra ?? {}).filter(([k]) => k !== "log"),
      ),
    },
    { status: statusCode },
  );
}

export function catchToJson(err: unknown) {
  const code = classifyThrown(err);
  return jsonError(code, undefined, {
    log: err instanceof Error ? err.message : String(err),
  });
}
