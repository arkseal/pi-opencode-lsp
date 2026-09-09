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

export function parseRpcMessages(buffer: string): JsonRpcMessage[] {
  const messages: JsonRpcMessage[] = [];
  let remaining = buffer;

  while (true) {
    const match = remaining.match(/Content-Length:\s*(\d+)\r\n\r\n/i);
    if (!match || match.index === undefined) break;

    const length = parseInt(match[1], 10);
    const bodyStart = match.index + match[0].length;
    const bodyEnd = bodyStart + length;

    if (Buffer.byteLength(remaining.slice(bodyStart), "utf8") < length) {
      break; // Incomplete message
    }

    const body = remaining.slice(bodyStart, bodyEnd);
    try {
      messages.push(JSON.parse(body));
    } catch {
      // ignore malformed
    }

    remaining = remaining.slice(bodyEnd);
  }

  return messages;
}
