export interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

export function encodeRpcMessage(msg: JsonRpcMessage): string {
  const content = JSON.stringify(msg);
  const length = Buffer.byteLength(content, "utf8");
  return `Content-Length: ${length}\r\n\r\n${content}`;
}

export interface ParseRpcResult {
  messages: JsonRpcMessage[];
  remainder: Buffer;
}

/**
 * Robust, byte-aware parser for LSP JSON-RPC message streams.
 * Handles Content-Length in bytes, UTF-8 multi-byte characters,
 * partial frames across chunks, and returns unconsumed remainder.
 */
const MAX_RPC_HEADER_BYTES = 16 * 1024;
const MAX_RPC_BODY_BYTES = 32 * 1024 * 1024;

export function parseRpcBuffer(buffer: Buffer): ParseRpcResult {
  const messages: JsonRpcMessage[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const headerEndIndex = buffer.indexOf("\r\n\r\n", offset);
    if (headerEndIndex === -1) {
      if (buffer.length - offset > MAX_RPC_HEADER_BYTES) {
        throw new Error("LSP JSON-RPC header exceeds maximum size");
      }
      break; // Incomplete header
    }
    if (headerEndIndex - offset > MAX_RPC_HEADER_BYTES) {
      throw new Error("LSP JSON-RPC header exceeds maximum size");
    }

    const headerStr = buffer.toString("ascii", offset, headerEndIndex);
    const match = headerStr.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      // Malformed header, advance past boundary to recover
      offset = headerEndIndex + 4;
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_RPC_BODY_BYTES) {
      throw new Error("LSP JSON-RPC body exceeds maximum size");
    }
    const bodyStart = headerEndIndex + 4;
    const bodyEnd = bodyStart + contentLength;

    if (buffer.length < bodyEnd) {
      // Incomplete body; wait for more data
      break;
    }

    const bodyBuf = buffer.subarray(bodyStart, bodyEnd);
    offset = bodyEnd;

    try {
      const parsed = JSON.parse(bodyBuf.toString("utf8"));
      messages.push(parsed);
    } catch {
      // Ignore malformed JSON
    }
  }

  return {
    messages,
    remainder: offset > 0 ? buffer.subarray(offset) : buffer,
  };
}

/**
 * Legacy string-based parser kept for backward compatibility.
 */
export function parseRpcMessages(buffer: string): JsonRpcMessage[] {
  const buf = Buffer.from(buffer, "utf8");
  return parseRpcBuffer(buf).messages;
}
