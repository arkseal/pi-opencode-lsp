import { describe, expect, it } from "bun:test";
import { formatDiagnostic, formatLspResult, translatePosition } from "../src/lsp-formatter";
import { encodeRpcMessage, parseRpcMessages } from "../src/json-rpc";

describe("LSP Client & Formatter", () => {
  it("translates 1-based editor coordinates to 0-based LSP coordinates", () => {
    const pos = translatePosition({ line: 15, character: 4 });
    expect(pos.line).toBe(14);
    expect(pos.character).toBe(3);
  });

  it("encodes and parses JSON-RPC headers with Content-Length", () => {
    const msg = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    const encoded = encodeRpcMessage(msg);

    expect(encoded).toContain("Content-Length: ");
    expect(encoded).toContain("\r\n\r\n");

    const parsed = parseRpcMessages(encoded);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe(1);
    expect(parsed[0].method).toBe("initialize");
  });

  it("formats diagnostics into clean, token-efficient summaries", () => {
    const rawDiagnostic = {
      range: {
        start: { line: 11, character: 7 },
        end: { line: 11, character: 15 },
      },
      severity: 1, // Error
      message: "Type 'string' is not assignable to type 'number'.",
      source: "typescript",
    };

    const formatted = formatDiagnostic(rawDiagnostic);
    expect(formatted).toBe("Line 12:8 [Error]: Type 'string' is not assignable to type 'number'. (typescript)");
  });

  it("formats definition and reference results compactly", () => {
    const locations = [
      {
        uri: "file:///project/src/auth.ts",
        range: { start: { line: 24, character: 4 }, end: { line: 24, character: 16 } },
      },
      {
        uri: "file:///project/src/index.ts",
        range: { start: { line: 5, character: 2 }, end: { line: 5, character: 14 } },
      },
    ];

    const result = formatLspResult("findReferences", locations, "/project");
    expect(result).toContain("src/auth.ts:25:5");
    expect(result).toContain("src/index.ts:6:3");
  });
});
