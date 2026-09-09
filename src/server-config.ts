import * as path from "node:path";

export interface LspServerDef {
  server: string;
  args: string[];
}

export const LSP_CONFIG: Record<string, LspServerDef> = {
  ".ts": { server: "typescript-language-server", args: ["--stdio"] },
  ".tsx": { server: "typescript-language-server", args: ["--stdio"] },
  ".js": { server: "typescript-language-server", args: ["--stdio"] },
  ".jsx": { server: "typescript-language-server", args: ["--stdio"] },
  ".py": { server: "pyright", args: ["--stdio"] },
  ".rs": { server: "rust-analyzer", args: [] },
  ".go": { server: "gopls", args: [] },
  ".c": { server: "clangd", args: [] },
  ".cpp": { server: "clangd", args: [] },
};

export function resolveLspServerCommand(filePath: string): LspServerDef | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return LSP_CONFIG[ext];
}
