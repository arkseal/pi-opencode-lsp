import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { resolveLspServerCommand } from "../src/server-config";
import { appendDiagnosticsToEditResult } from "../src/post-edit-diagnostics";

describe("LSP Tool & Post-Edit Hook", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lsp-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("resolves default server for file extensions", () => {
    expect(resolveLspServerCommand("app.ts")?.server).toBe("typescript-language-server");
    expect(resolveLspServerCommand("main.py")?.server).toBe("pyright");
    expect(resolveLspServerCommand("lib.rs")?.server).toBe("rust-analyzer");
    expect(resolveLspServerCommand("main.go")?.server).toBe("gopls");
    expect(resolveLspServerCommand("file.unknown")).toBeUndefined();
  });

  it("appends diagnostics to edit tool result without mutating system prompt", () => {
    const originalOutput = "Successfully applied edits to src/auth.ts";
    const diagnostics = [
      "Line 12:8 [Error]: Type 'string' is not assignable to type 'number'. (typescript)",
    ];

    const result = appendDiagnosticsToEditResult(originalOutput, "src/auth.ts", diagnostics);
    expect(result).toContain("Successfully applied edits to src/auth.ts");
    expect(result).toContain("LSP diagnostics detected in src/auth.ts, please review:");
    expect(result).toContain("Line 12:8 [Error]");
  });

  it("leaves output untouched when zero diagnostics exist", () => {
    const originalOutput = "Successfully applied edits to src/auth.ts";
    const result = appendDiagnosticsToEditResult(originalOutput, "src/auth.ts", []);
    expect(result).toBe(originalOutput);
  });
});
