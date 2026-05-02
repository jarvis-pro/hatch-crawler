/**
 * 前端 API 客户端：统一处理 { ok, data } / { ok: false, error } 响应。
 */

/**
 * 分页列表响应的通用结构。
 * 所有 GET /api/<resource> 返回分页数据时都使用此形状。
 */
export interface ListResult<T> {
  data: T[];
  total: number;
  page?: number;
  pageSize?: number;
}

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiError {
  ok: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

type ApiEnvelope<T> = ApiSuccess<T> | ApiError;

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json()) as ApiEnvelope<T>;
  if (json.ok) return json.data;
  throw new ApiClientError(json.error.code, json.error.message, json.error.details);
}

export const api = {
  async get<T>(url: string): Promise<T> {
    const res = await fetch(url, { cache: 'no-store' });
    return parse<T>(res);
  },
  async post<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parse<T>(res);
  },
  async put<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parse<T>(res);
  },
  async patch<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parse<T>(res);
  },
  async delete<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parse<T>(res);
  },
};
