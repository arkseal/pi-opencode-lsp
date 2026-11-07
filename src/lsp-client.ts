import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { encodeRpcMessage, parseRpcBuffer, type JsonRpcMessage } from "./json-rpc.js";
import { resolveLspServerCommand, type LspServerDef } from "./server-config.js";
import { translatePosition, type EditorPosition, type LspDiagnostic, formatDiagnostic } from "./lsp-formatter.js";

export interface PendingRequest {
  resolve: (res: any) => void;
  reject: (err: any) => void;
  timer: NodeJS.Timeout;
}

export interface ActiveServer {
  key: string;
  process: ChildProcess;
  def: LspServerDef;
  requestId: number;
  pendingRequests: Map<number, PendingRequest>;
  diagnostics: Map<string, LspDiagnostic[]>;
  openedDocuments: Map<string, number>;
  buffer: Buffer;
  initialized: boolean;
}

const servers = new Map<string, ActiveServer>();
const pendingStarts = new Map<string, Promise<ActiveServer | undefined>>();

export function normalizeFilePath(filePath: string, cwd: string): string {
  const stripped = filePath.startsWith("@") ? filePath.slice(1) : filePath;
  return path.isAbsolute(stripped) ? stripped : path.resolve(cwd, stripped);
}

export function toFileUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

export function getActiveServersCount(): number {
  return servers.size;
}

function cleanupServer(key: string, active: ActiveServer) {
  if (servers.get(key) === active) {
    servers.delete(key);
  }
  for (const pending of active.pendingRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("LSP server process closed"));
  }
  active.pendingRequests.clear();
}

export async function getOrStartServer(
  filePath: string,
  cwd: string,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<ActiveServer | undefined> {
  const def = resolveLspServerCommand(filePath);
  if (!def) return undefined;

  const key = `${def.server}:${cwd}`;
  const existing = servers.get(key);
  if (existing && !existing.process.killed) {
    return existing;
  }

  // Deduplicate concurrent startup attempts for the same server & directory
  const inflight = pendingStarts.get(key);
  if (inflight) {
    return inflight;
  }

  const startPromise = startServer(key, def, cwd, options?.timeoutMs ?? 8000);
  pendingStarts.set(key, startPromise);

  try {
    const server = await startPromise;
    if (server) {
      servers.set(key, server);
    }
    return server;
  } finally {
    pendingStarts.delete(key);
  }
}

async function startServer(
  key: string,
  def: LspServerDef,
  cwd: string,
  initTimeoutMs: number
): Promise<ActiveServer | undefined> {
  return new Promise<ActiveServer | undefined>((resolve) => {
    let resolved = false;

    const safeResolve = (val: ActiveServer | undefined) => {
      if (!resolved) {
        resolved = true;
        resolve(val);
      }
    };

    try {
      const child = spawn(def.server, def.args, {
        cwd,
        stdio: ["pipe", "pipe", "ignore"],
      });

      const active: ActiveServer = {
        key,
        process: child,
        def,
        requestId: 1,
        pendingRequests: new Map(),
        diagnostics: new Map(),
        openedDocuments: new Map(),
        buffer: Buffer.alloc(0),
        initialized: false,
      };

      child.on("error", () => {
        cleanupServer(key, active);
        safeResolve(undefined);
      });

      child.on("close", () => {
        cleanupServer(key, active);
        safeResolve(undefined);
      });

      child.stdout?.on("data", (chunk: Buffer) => {
        active.buffer = Buffer.concat([active.buffer, chunk]);
        let messages: JsonRpcMessage[];
        try {
          const parsed = parseRpcBuffer(active.buffer);
          messages = parsed.messages;
          active.buffer = parsed.remainder;
        } catch {
          cleanupServer(key, active);
          child.kill();
          return;
        }

        for (const msg of messages) {
          if (msg.id !== undefined) {
            const reqId = Number(msg.id);
            const pending = active.pendingRequests.get(reqId);
            if (pending) {
              active.pendingRequests.delete(reqId);
              clearTimeout(pending.timer);
              if (msg.error) {
                pending.reject(new Error(`LSP ${msg.error.code ?? "error"}: ${msg.error.message ?? "request failed"}`));
              } else {
                pending.resolve(msg.result);
              }
            }
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

      // Send initialize request following standard LSP lifecycle
      sendLspRequest(
        active,
        "initialize",
        {
          processId: process.pid,
          rootUri: toFileUri(cwd),
          capabilities: {
            textDocument: {
              definition: {},
              references: {},
              hover: { contentFormat: ["markdown", "plaintext"] },
              documentSymbol: {},
              implementation: {},
            },
            workspace: {
              symbol: {},
            },
          },
        },
        { timeoutMs: initTimeoutMs }
      )
        .then((res) => {
          // LSP InitializeResult is an object. Null indicates timeout or closed stdin.
          if (!res || typeof res !== "object" || child.exitCode !== null || child.signalCode !== null) {
            child.kill();
            cleanupServer(key, active);
            safeResolve(undefined);
            return;
          }
          // Send initialized notification as required by LSP specification
          sendNotification(active, "initialized", {});
          active.initialized = true;
          safeResolve(active);
        })
        .catch(() => {
          child.kill();
          cleanupServer(key, active);
          safeResolve(undefined);
        });
    } catch {
      safeResolve(undefined);
    }
  });
}

export function sendNotification(server: ActiveServer, method: string, params: any) {
  const msg: JsonRpcMessage = {
    jsonrpc: "2.0",
    method,
    params,
  };
  try {
    if (server.process.stdin?.writable) {
      server.process.stdin.write(encodeRpcMessage(msg));
    }
  } catch {}
}

export function sendLspRequest(
  server: ActiveServer,
  method: string,
  params: any,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<any> {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const signal = options?.signal;

  if (signal?.aborted) {
    return Promise.reject(new Error("LSP request aborted"));
  }

  const id = server.requestId++;
  const msg: JsonRpcMessage = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  return new Promise((resolve, reject) => {
    let onAbort: (() => void) | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      server.pendingRequests.delete(id);
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    if (signal) {
      onAbort = () => {
        cleanup();
        sendNotification(server, "$/cancelRequest", { id });
        reject(new Error("LSP request cancelled"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    server.pendingRequests.set(id, {
      resolve: (res) => {
        cleanup();
        resolve(res);
      },
      reject: (err) => {
        cleanup();
        reject(err);
      },
      timer,
    });

    try {
      if (server.process.stdin?.writable) {
        server.process.stdin.write(encodeRpcMessage(msg));
      } else {
        cleanup();
        resolve(null);
      }
    } catch {
      cleanup();
      resolve(null);
    }
  });
}

export async function shutdownServer(server: ActiveServer): Promise<void> {
  cleanupServer(server.key, server);

  try {
    if (server.process.stdin?.writable) {
      await sendLspRequest(server, "shutdown", {}, { timeoutMs: 1000 });
      sendNotification(server, "exit", {});
    }
  } catch {}

  try {
    if (server.process.exitCode === null && server.process.signalCode === null) {
      server.process.kill("SIGTERM");
      setTimeout(() => {
        try {
          // ChildProcess.killed means a signal was sent, not that it exited.
          if (server.process.exitCode === null && server.process.signalCode === null) {
            server.process.kill("SIGKILL");
          }
        } catch {}
      }, 300).unref();
    }
  } catch {}
}

export async function shutdownAllServers(): Promise<void> {
  const all = Array.from(servers.values());
  servers.clear();
  pendingStarts.clear();
  await Promise.all(all.map((s) => shutdownServer(s)));
}

export async function executeLspOperation(
  operation: string,
  filePath: string,
  pos: EditorPosition,
  cwd: string,
  query?: string,
  signal?: AbortSignal
): Promise<any> {
  if (signal?.aborted) {
    throw new Error("LSP operation aborted");
  }

  const server = await getOrStartServer(filePath, cwd, { signal });
  if (!server) {
    throw new Error(`No LSP server available or installed for: ${path.basename(filePath)}`);
  }

  const absPath = normalizeFilePath(filePath, cwd);
  const uri = toFileUri(absPath);
  const lspPos = translatePosition(pos);
  const reqOpts = { signal };

  if (operation !== "workspaceSymbol") {
    await synchronizeDocument(server, absPath);
  }

  switch (operation) {
    case "goToDefinition":
      return sendLspRequest(server, "textDocument/definition", {
        textDocument: { uri },
        position: lspPos,
      }, reqOpts);
    case "findReferences":
      return sendLspRequest(server, "textDocument/references", {
        textDocument: { uri },
        position: lspPos,
        context: { includeDeclaration: true },
      }, reqOpts);
    case "hover":
      return sendLspRequest(server, "textDocument/hover", {
        textDocument: { uri },
        position: lspPos,
      }, reqOpts);
    case "documentSymbol":
      return sendLspRequest(server, "textDocument/documentSymbol", {
        textDocument: { uri },
      }, reqOpts);
    case "workspaceSymbol":
      return sendLspRequest(server, "workspace/symbol", {
        query: query ?? "",
      }, reqOpts);
    case "goToImplementation":
      return sendLspRequest(server, "textDocument/implementation", {
        textDocument: { uri },
        position: lspPos,
      }, reqOpts);
    case "prepareCallHierarchy":
      return sendLspRequest(server, "textDocument/prepareCallHierarchy", {
        textDocument: { uri },
        position: lspPos,
      }, reqOpts);
    default:
      throw new Error(`Unsupported LSP operation: ${operation}`);
  }
}

const LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".c": "c",
  ".cpp": "cpp",
};

export function getLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_IDS[ext] ?? ext.replace(/^\./, "");
}

async function synchronizeDocument(server: ActiveServer, absPath: string): Promise<void> {
  const uri = toFileUri(absPath);
  let text: string;
  try {
    text = await fs.readFile(absPath, "utf8");
  } catch {
    return; // File unreadable or does not exist yet; proceed directly
  }

  const version = server.openedDocuments.get(uri);

  if (version === undefined) {
    sendNotification(server, "textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: getLanguageId(absPath),
        version: 1,
        text,
      },
    });
    server.openedDocuments.set(uri, 1);
    return;
  }

  const nextVersion = version + 1;
  sendNotification(server, "textDocument/didChange", {
    textDocument: { uri, version: nextVersion },
    contentChanges: [{ text }],
  });
  server.openedDocuments.set(uri, nextVersion);
}

export function getFileDiagnostics(filePath: string, cwd: string): string[] {
  const absPath = normalizeFilePath(filePath, cwd);
  const uri = toFileUri(absPath);

  for (const server of servers.values()) {
    const diags = server.diagnostics.get(uri);
    if (diags && diags.length > 0) {
      return diags.map(formatDiagnostic);
    }
  }

  return [];
}
