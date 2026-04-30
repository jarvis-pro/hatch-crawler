import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

/**
 * 统一 API 响应封装。
 * 与 docs/api-spec.md 的 { ok, data } / { ok: false, error } 形态对齐。
 */

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_ERROR";

const STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...(details && { details }) },
    },
    { status: STATUS[code] },
  );
}

/** 把 Zod 错误转成 VALIDATION_ERROR */
export function failValidation(err: ZodError): NextResponse {
  return fail("VALIDATION_ERROR", "请求参数不合法", {
    issues: err.issues,
  });
}

/** 兜底错误处理 */
export function failInternal(err: unknown): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return fail("INTERNAL_ERROR", message);
}
