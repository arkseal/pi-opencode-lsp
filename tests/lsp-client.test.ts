import { describe, expect, it } from "bun:test";
import { formatDiagnostic, formatLspResult, translatePosition } from "../src/lsp-formatter";
import { encodeRpcMessage, parseRpcMessages, parseRpcBuffer } from "../src/json-rpc";

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

  it("handles multi-byte UTF-8 characters without byte-length desync", () => {
    const unicodeMsg = {
      jsonrpc: "2.0",
      id: 2,
      result: { text: "Hello 🚀 世界 🌟 test" },
    };
    const encoded = encodeRpcMessage(unicodeMsg);
    const buf = Buffer.from(encoded, "utf8");

    const { messages, remainder } = parseRpcBuffer(buf);
    expect(messages.length).toBe(1);
    expect(messages[0].id).toBe(2);
    expect((messages[0].result as any).text).toBe("Hello 🚀 世界 🌟 test");
    expect(remainder.length).toBe(0);
  });

  it("handles chunked JSON-RPC streams and unconsumed remainder", () => {
    const msg1 = { jsonrpc: "2.0", id: 1, result: "first" };
    const msg2 = { jsonrpc: "2.0", id: 2, result: "second" };

    const encoded1 = encodeRpcMessage(msg1);
    const encoded2 = encodeRpcMessage(msg2);

    const fullBuf = Buffer.concat([Buffer.from(encoded1), Buffer.from(encoded2)]);

    // Simulate chunk cut in half of message 2
    const chunk1 = fullBuf.subarray(0, encoded1.length + 15);
    const chunk2 = fullBuf.subarray(encoded1.length + 15);

    const step1 = parseRpcBuffer(chunk1);
    expect(step1.messages.length).toBe(1);
    expect(step1.messages[0].id).toBe(1);
    expect(step1.remainder.length).toBe(15);

    const step2 = parseRpcBuffer(Buffer.concat([step1.remainder, chunk2]));
    expect(step2.messages.length).toBe(1);
    expect(step2.messages[0].id).toBe(2);
    expect(step2.remainder.length).toBe(0);
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
