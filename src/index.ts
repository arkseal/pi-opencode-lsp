import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeLspOperation, getFileDiagnostics } from "./lsp-client.js";
import { formatLspResult } from "./lsp-formatter.js";
import { appendDiagnosticsToEditResult } from "./post-edit-diagnostics.js";

const OPERATIONS = [
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
  "prepareCallHierarchy",
] as const;

export default function opencodeLspExtension(pi: ExtensionAPI) {
  // 1. Unified LSP tool
  pi.registerTool({
    name: "lsp",
    label: "LSP",
    description:
      "Language Server Protocol code intelligence. Supports goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, and prepareCallHierarchy.",
    promptSnippet: "Query symbol definitions, references, hover types, or workspace symbols",
    parameters: Type.Object(
      {
        operation: Type.Union(
          OPERATIONS.map((op) => Type.Literal(op)),
          { description: "The LSP operation to perform" }
        ),
        filePath: Type.String({
          description: "Path to the file to inspect",
        }),
        line: Type.Optional(
          Type.Integer({
            minimum: 1,
            description: "1-based line number",
          })
        ),
        character: Type.Optional(
          Type.Integer({
            minimum: 1,
            description: "1-based character column",
          })
        ),
        query: Type.Optional(
          Type.String({
            description: "Symbol search query for workspaceSymbol",
          })
        ),
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const line = params.line ?? 1;
      const character = params.character ?? 1;

      try {
        const raw = await executeLspOperation(
          params.operation,
          params.filePath,
          { line, character },
          ctx.cwd,
          params.query
        );
        const formatted = formatLspResult(params.operation, raw, ctx.cwd);
        return {
          content: [{ type: "text", text: formatted }],
          details: { operation: params.operation, filePath: params.filePath },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `LSP error: ${err.message}` }],
          details: { error: err.message },
        };
      }
    },
  });

  // 2. Post-edit diagnostic hook: appends diagnostics to edit results without mutating systemPrompt
  pi.on("tool_result", async (event, ctx) => {
    const isEditTool =
      event.toolName === "write" ||
      event.toolName === "edit" ||
      event.toolName === "hashline_edit";

    if (!isEditTool || !event.input) return;

    const targetPath = (event.input as any)?.path ?? (event.input as any)?.filePath;
    if (!targetPath || typeof targetPath !== "string") return;

    const diagnostics = getFileDiagnostics(targetPath, ctx.cwd);
    if (diagnostics.length === 0) return;

    if (Array.isArray(event.content)) {
      for (const item of event.content) {
        if (item.type === "text" && typeof item.text === "string") {
          item.text = appendDiagnosticsToEditResult(item.text, targetPath, diagnostics);
        }
      }
    }
  });
}
