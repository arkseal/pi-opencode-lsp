import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { resolveLspServerCommand } from "../src/server-config";
import { appendDiagnosticsToEditResult } from "../src/post-edit-diagnostics";
import opencodeLspExtension from "../src/index";

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

  it("bounds diagnostics reporting to 20 items with overflow count", () => {
    const originalOutput = "Edited src/app.ts";
    const manyDiags = Array.from({ length: 35 }, (_, i) => `Line ${i + 1}:1 [Error]: Syntax error ${i}`);

    const result = appendDiagnosticsToEditResult(originalOutput, "src/app.ts", manyDiags);
    expect(result).toContain("Line 20:1 [Error]");
    expect(result).not.toContain("Line 21:1 [Error]");
    expect(result).toContain("... and 15 more diagnostic(s)");
  });

  it("leaves output untouched when zero diagnostics exist", () => {
    const originalOutput = "Successfully applied edits to src/auth.ts";
    const result = appendDiagnosticsToEditResult(originalOutput, "src/auth.ts", []);
    expect(result).toBe(originalOutput);
  });

  it("registers extension tool, shutdown handler, and tool_result hook", async () => {
    let registeredTool: any = null;
    const eventHandlers = new Map<string, Function>();

    const mockPi: any = {
      registerTool(tool: any) {
        registeredTool = tool;
      },
      on(event: string, handler: Function) {
        eventHandlers.set(event, handler);
      },
    };

    opencodeLspExtension(mockPi);

    expect(registeredTool).not.toBeNull();
    expect(registeredTool.name).toBe("lsp");
    expect(registeredTool.promptGuidelines).toBeDefined();
    expect(registeredTool.promptGuidelines[0]).toContain("Use lsp");

    // Execute with unknown file type should return error with isError: true
    const errorResult = await registeredTool.execute(
      "call-1",
      { operation: "hover", filePath: "unknown.xyz" },
      undefined,
      undefined,
      { cwd: tempDir }
    );
    expect(errorResult.isError).toBe(true);
    expect(errorResult.content[0].text).toContain("LSP error:");

    // tool_result hook ignores errored tool results
    const toolResultHandler = eventHandlers.get("tool_result")!;
    const ignoredRes = await toolResultHandler(
      {
        toolName: "edit",
        isError: true,
        input: { path: "src/auth.ts" },
        content: [{ type: "text", text: "Failed edit" }],
      },
      { cwd: tempDir }
    );
    expect(ignoredRes).toBeUndefined();

    // session_shutdown handler cleans up
    const shutdownHandler = eventHandlers.get("session_shutdown")!;
    expect(shutdownHandler).toBeDefined();
    await shutdownHandler();
  });
});
