import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { dirname } from "node:path";

/**
 * Append-only JSON Lines writer.
 *
 * JSONL is great for crawler output:
 *  - one item per line, easy to grep/jq
 *  - safe to tail while a crawl is in progress
 *  - trivial to load into pandas/duckdb later
 */
export class JsonlWriter {
  private readonly stream: WriteStream;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.stream = createWriteStream(path, { flags: "a", encoding: "utf8" });
  }

  write(record: unknown): void {
    this.stream.write(JSON.stringify(record) + "\n");
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}
