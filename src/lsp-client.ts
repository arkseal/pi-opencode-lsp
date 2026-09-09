import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import { encodeRpcMessage, parseRpcMessages, type JsonRpcMessage } from "./json-rpc.js";
import { resolveLspServerCommand, type LspServerDef } from "./server-config.js";
import { translatePosition, type EditorPosition, type LspDiagnostic, formatDiagnostic } from "./lsp-formatter.js";

interface ActiveServer {
  process: ChildProcess;
  def: LspServerDef;
  requestId: number;
  pendingRequests: Map<number, (res: any) => void>;
  diagnostics: Map<string, LspDiagnostic[]>;
  buffer: string;
}

const servers = new Map<string, ActiveServer>();

export async function getOrStartServer(
  filePath: string,
  cwd: string
): Promise<ActiveServer | undefined> {
  const def = resolveLspServerCommand(filePath);
  if (!def) return undefined;

  const key = `${def.server}:${cwd}`;
  if (servers.has(key)) {
    return servers.get(key);
  }

  try {
    const child = spawn(def.server, def.args, {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
    });

    const active: ActiveServer = {
      process: child,
      def,
      requestId: 1,
      pendingRequests: new Map(),
      diagnostics: new Map(),
      buffer: "",
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      active.buffer += chunk.toString("utf8");
      const msgs = parseRpcMessages(active.buffer);
      for (const msg of msgs) {
        if (msg.id !== undefined && active.pendingRequests.has(Number(msg.id))) {
          const cb = active.pendingRequests.get(Number(msg.id))!;
          active.pendingRequests.delete(Number(msg.id));
          cb(msg.result ?? msg.error);
        }
        // Handle publishDiagnostics notification
        if (msg.method === "textDocument/publishDiagnostics") {
          const uri = msg.params?.uri;
          const diags = msg.params?.diagnostics ?? [];
          if (uri) {
            active.diagnostics.set(uri, diags);
          }
        }
      }
    });

    child.on("close", () => {
      servers.delete(key);
    });

    // Send initialize request
    sendNotification(active, "initialize", {
      processId: process.pid,
      rootUri: `file://${cwd}`,
      capabilities: {},
    });

    servers.set(key, active);
    return active;
  } catch {
    return undefined;
  }
}

function sendNotification(server: ActiveServer, method: string, params: any) {
  const msg: JsonRpcMessage = {
    jsonrpc: "2.0",
    method,
    params,
  };
  server.process.stdin?.write(encodeRpcMessage(msg));
}

export function sendLspRequest(
  server: ActiveServer,
  method: string,
  params: any,
  timeoutMs = 5000
): Promise<any> {
  const id = server.requestId++;
  const msg: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      server.pendingRequests.delete(id);
      resolve(null);
    }, timeoutMs);

    server.pendingRequests.set(id, (res) => {
      clearTimeout(timer);
      resolve(res);
    });

    server.process.stdin?.write(encodeRpcMessage(msg));
  });
}

export async function executeLspOperation(
  operation: string,
  filePath: string,
  pos: EditorPosition,
  cwd: string,
  query?: string
): Promise<any> {
  const server = await getOrStartServer(filePath, cwd);
  if (!server) {
    throw new Error(`No LSP server available or installed for: ${path.basename(filePath)}`);
  }

  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  const uri = `file://${absPath}`;
  const lspPos = translatePosition(pos);

  switch (operation) {
    case "goToDefinition":
      return sendLspRequest(server, "textDocument/definition", {
        textDocument: { uri },
        position: lspPos,
      });
    case "findReferences":
      return sendLspRequest(server, "textDocument/references", {
        textDocument: { uri },
        position: lspPos,
        context: { includeDeclaration: true },
      });
    case "hover":
      return sendLspRequest(server, "textDocument/hover", {
        textDocument: { uri },
        position: lspPos,
      });
    case "documentSymbol":
      return sendLspRequest(server, "textDocument/documentSymbol", {
        textDocument: { uri },
      });
    case "workspaceSymbol":
      return sendLspRequest(server, "workspace/symbol", {
        query: query ?? "",
      });
    case "goToImplementation":
      return sendLspRequest(server, "textDocument/implementation", {
        textDocument: { uri },
        position: lspPos,
      });
    case "prepareCallHierarchy":
      return sendLspRequest(server, "textDocument/prepareCallHierarchy", {
        textDocument: { uri },
        position: lspPos,
      });
    default:
      throw new Error(`Unsupported LSP operation: ${operation}`);
  }
}

export function getFileDiagnostics(filePath: string, cwd: string): string[] {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  const uri = `file://${absPath}`;

  for (const server of servers.values()) {
    const diags = server.diagnostics.get(uri);
    if (diags && diags.length > 0) {
      return diags.map(formatDiagnostic);
    }
  }

  return [];
}
