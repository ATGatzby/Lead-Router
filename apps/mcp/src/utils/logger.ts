import { mkdirSync, appendFileSync, statSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 3;

export class Logger {
  private logPath: string;

  constructor(logDir: string) {
    mkdirSync(logDir, { recursive: true });
    this.logPath = join(logDir, "mcp.log");
  }

  log(entry: {
    tool: string;
    action: "preview" | "execute" | "read" | "error";
    input?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    durationMs?: number;
  }) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    this.rotate();
    appendFileSync(this.logPath, line);
  }

  private rotate() {
    try {
      const stat = statSync(this.logPath);
      if (stat.size < MAX_SIZE) return;
    } catch {
      return; // File doesn't exist yet
    }

    // Shift existing rotated files
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const src = i === 1 ? this.logPath : `${this.logPath}.${i - 1}`;
      const dst = `${this.logPath}.${i}`;
      try {
        if (i === MAX_FILES) unlinkSync(dst);
      } catch {}
      try {
        renameSync(src, dst);
      } catch {}
    }
  }
}
