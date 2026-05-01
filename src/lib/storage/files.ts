import 'server-only';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

import { env } from '@/lib/env';

/**
 * 二进制文件存储抽象 —— RFC 0002 Phase A
 *
 * 当前只实现 LocalFileStorage（写本地磁盘）。
 * 留 interface 给未来可能的 S3 / MinIO 适配，使下载相关代码不感知后端差异。
 */

export interface PutResult {
  byteSize: number;
  sha256: string;
}

export interface FileStorage {
  /** 把 stream 持久化到 relPath。返回写入的字节数与 sha256。 */
  put(relPath: string, stream: Readable): Promise<PutResult>;
  /** 读取一个文件流。供 GET /api/attachments/:id/download 使用。 */
  get(relPath: string): Promise<Readable>;
  /** 删除文件。文件不存在不报错。 */
  delete(relPath: string): Promise<void>;
  /** 文件是否存在。 */
  exists(relPath: string): Promise<boolean>;
  /** 取文件大小。文件不存在返回 null。 */
  size(relPath: string): Promise<number | null>;
}

class LocalFileStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(relPath: string): string {
    // 绝对化并校验：不能逃出 root
    const absRoot = path.resolve(this.root);
    const abs = path.resolve(absRoot, relPath);
    if (!abs.startsWith(absRoot + path.sep) && abs !== absRoot) {
      throw new Error(`storage path escapes root: ${relPath}`);
    }
    return abs;
  }

  async put(relPath: string, stream: Readable): Promise<PutResult> {
    const abs = this.resolve(relPath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });

    const hasher = createHash('sha256');
    let byteSize = 0;
    stream.on('data', (chunk: Buffer) => {
      hasher.update(chunk);
      byteSize += chunk.length;
    });

    const tmp = abs + '.partial';
    await pipeline(stream, createWriteStream(tmp));
    await fsp.rename(tmp, abs);

    return { byteSize, sha256: hasher.digest('hex') };
  }

  async get(relPath: string): Promise<Readable> {
    const abs = this.resolve(relPath);
    return createReadStream(abs);
  }

  async delete(relPath: string): Promise<void> {
    const abs = this.resolve(relPath);
    await fsp.rm(abs, { force: true });
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fsp.access(this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }

  async size(relPath: string): Promise<number | null> {
    try {
      const st = await fsp.stat(this.resolve(relPath));
      return st.size;
    } catch {
      return null;
    }
  }
}

// 单例（Next.js dev HMR 友好）
const STORAGE_KEY = '__hatchFileStorage__';
type StorageHolder = { [STORAGE_KEY]?: FileStorage };

export function getFileStorage(): FileStorage {
  const holder = globalThis as unknown as StorageHolder;
  if (!holder[STORAGE_KEY]) {
    if (env.storageBackend === 'local') {
      holder[STORAGE_KEY] = new LocalFileStorage(env.storageLocalRoot);
    } else {
      throw new Error(`unsupported STORAGE_BACKEND: ${env.storageBackend as string}`);
    }
  }
  return holder[STORAGE_KEY]!;
}

/**
 * 标准化文件存储相对路径。
 * 形态：downloads/<spider>/<itemId>/<attachmentId>.<ext>
 *
 * 安全：扩展名 whitelist，避免奇怪后缀。
 */
const SAFE_EXT = new Set([
  'mp4',
  'mp3',
  'wav',
  'm4a',
  'webm',
  'ogg',
  'opus',
  'flac',
  'aac',
  'zip',
  'pdf',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bin',
]);

export function buildAttachmentPath(args: {
  spider: string;
  itemId: number;
  attachmentId: string;
  ext: string;
}): string {
  const ext = args.ext.replace(/^\./, '').toLowerCase();
  if (!SAFE_EXT.has(ext)) {
    throw new Error(`unsupported attachment extension: ${ext}`);
  }
  // 防 spider 名乱造路径：仅允许字母数字 - _
  if (!/^[A-Za-z0-9_-]+$/.test(args.spider)) {
    throw new Error(`invalid spider name for storage path: ${args.spider}`);
  }
  return path.posix.join(
    'downloads',
    args.spider,
    String(args.itemId),
    `${args.attachmentId}.${ext}`,
  );
}
