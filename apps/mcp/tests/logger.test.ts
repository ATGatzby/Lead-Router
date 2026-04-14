import { describe, it, expect, afterEach } from "vitest";
import { Logger } from "../src/utils/logger.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Logger", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("creates log directory and writes JSON lines", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-logger-test-"));
    const logDir = join(tempDir, "logs");
    const logger = new Logger(logDir);

    logger.log({ tool: "list_rules", action: "read" });
    logger.log({ tool: "create_rule", action: "execute", input: { name: "Test" } });

    const content = readFileSync(join(logDir, "mcp.log"), "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const entry1 = JSON.parse(lines[0]);
    expect(entry1.tool).toBe("list_rules");
    expect(entry1.action).toBe("read");
    expect(entry1.ts).toBeDefined();

    const entry2 = JSON.parse(lines[1]);
    expect(entry2.tool).toBe("create_rule");
    expect(entry2.input).toEqual({ name: "Test" });
  });

  it("includes error field when provided", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-logger-test-"));
    const logger = new Logger(tempDir);

    logger.log({ tool: "delete_rule", action: "error", error: "Not found" });

    const content = readFileSync(join(tempDir, "mcp.log"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.error).toBe("Not found");
  });

  it("includes durationMs when provided", () => {
    tempDir = mkdtempSync(join(tmpdir(), "mcp-logger-test-"));
    const logger = new Logger(tempDir);

    logger.log({ tool: "test_rule", action: "read", durationMs: 42 });

    const content = readFileSync(join(tempDir, "mcp.log"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.durationMs).toBe(42);
  });
});
