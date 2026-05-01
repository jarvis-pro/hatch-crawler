import 'server-only';
import path from 'node:path';
import { attachmentRepo, getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal } from '@/lib/api/response';
import { getFileStorage } from '@/lib/storage/files';
import type { Readable } from 'node:stream';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/attachments/:id/download —— 下载文件本体。
 *
 * 简化实现：流式返回整文件，不实现 Range（看板下载够用）。
 * 如果未来要给视频播放器用，再加 Range 支持。
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const db = getDb(env.databaseUrl);
    const attachment = await attachmentRepo.getById(db, id);
    if (!attachment) return fail('NOT_FOUND', `attachment not found: ${id}`);
    if (!attachment.storagePath || attachment.status !== 'completed') {
      return fail('NOT_FOUND', `attachment is not ready: status=${String(attachment.status)}`);
    }

    const storage = getFileStorage();
    const exists = await storage.exists(attachment.storagePath);
    if (!exists) return fail('NOT_FOUND', 'underlying file missing');

    const nodeStream: Readable = await storage.get(attachment.storagePath);
    const filename = path.posix.basename(attachment.storagePath);

    const headers = new Headers({
      'content-type': attachment.mimeType || 'application/octet-stream',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    });
    if (attachment.byteSize !== null) {
      headers.set('content-length', String(attachment.byteSize));
    }

    // node Readable → web ReadableStream
    const webStream = NodeReadableStream.from(nodeStream) as unknown as ReadableStream;
    return new Response(webStream, { headers });
  } catch (err) {
    return failInternal(err);
  }
}
