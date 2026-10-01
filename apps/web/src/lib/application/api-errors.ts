import { NextResponse } from "next/server";
import {
  isShiftDomainError,
  isWeeklyPayDomainError,
  isWorkDomainError,
} from "@regapro/work";

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
  if (isShiftDomainError(err)) {
    switch (err.code) {
      case "FORBIDDEN":
        return "FORBIDDEN";
      case "NOT_FOUND":
        return "NOT_FOUND";
      case "CONFLICT":
      case "REQUEST_IMMUTABLE":
      case "SHIFT_IMMUTABLE":
      case "INVALID_TRANSITION":
        return "CONFLICT";
      default:
        return "VALIDATION";
    }
  }
  if (isWorkDomainError(err)) {
    switch (err.code) {
      case "FORBIDDEN":
        return "FORBIDDEN";
      case "NOT_FOUND":
        return "NOT_FOUND";
      case "CONFLICT":
      case "TERM_OVERLAP":
      case "RECORD_IMMUTABLE":
      case "LOCKED_IMMUTABLE":
      case "INVALID_TRANSITION":
        return "CONFLICT";
      default:
        return "VALIDATION";
    }
  }
  if (isWeeklyPayDomainError(err)) {
    switch (err.code) {
      case "FORBIDDEN":
      case "SELF_REVIEW":
        return "FORBIDDEN";
      case "NOT_FOUND":
        return "NOT_FOUND";
      case "CONFLICT":
      case "DUPLICATE_WEEK":
      case "ALREADY_APPLIED":
      case "INVALID_TRANSITION":
      case "WEEK_CUTOFF":
      case "NO_BANK":
        return "CONFLICT";
      case "BANK_KEY_MISSING":
        return "INTERNAL";
      default:
        return "VALIDATION";
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNAUTHENTICATED|not authenticated|JWT|session/i.test(msg)) {
    return "UNAUTHENTICATED";
  }
  if (
    /row-level security|permission denied|42501|FORBIDDEN|SHIFT_FORBIDDEN|WORK_FORBIDDEN|WEEKLY_PAY_FORBIDDEN|WEEKLY_PAY_SELF_REVIEW|NO_ORGANIZATION|NO_PLATFORM_IDENTITY|STAFF_INACTIVE|UNAUTHORIZED_REVIEW|UNAUTHORIZED_KNOWLEDGE/i.test(
      msg,
    )
  ) {
    return "FORBIDDEN";
  }
  if (/SHIFT_NOT_FOUND|WORK_NOT_FOUND|WEEKLY_PAY_NOT_FOUND|not found|PGRST116|404/i.test(msg)) {
    return "NOT_FOUND";
  }
  if (
    /SHIFT_CONFLICT|SHIFT_INVALID_TRANSITION|SHIFT_REQUEST_IMMUTABLE|SHIFT_IMMUTABLE|WORK_CONFLICT|WORK_INVALID_TRANSITION|WORK_RECORD_IMMUTABLE|WORK_LOCKED_IMMUTABLE|WORK_TERM_OVERLAP|WEEKLY_PAY_CONFLICT|WEEKLY_PAY_INVALID_TRANSITION|WEEKLY_PAY_DUPLICATE_WEEK|WEEKLY_PAY_ALREADY_APPLIED|WEEKLY_PAY_WEEK_CUTOFF|23P01|23505/i.test(
      msg,
    )
  ) {
    return "CONFLICT";
  }
  if (/SHIFT_[A-Z_]+|WORK_[A-Z_]+|WEEKLY_PAY_[A-Z_]+/i.test(msg)) {
    return "VALIDATION";
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
