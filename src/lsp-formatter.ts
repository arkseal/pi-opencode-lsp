import * as path from "node:path";

export interface EditorPosition {
  line: number;
  character: number;
}

export interface LspPosition {
  line: number;
  character: number;
}

export function translatePosition(pos: EditorPosition): LspPosition {
  return {
    line: Math.max(0, pos.line - 1),
    character: Math.max(0, pos.character - 1),
  };
}

export interface LspDiagnostic {
  range: {
    start: LspPosition;
    end: LspPosition;
  };
  severity?: number; // 1: Error, 2: Warning, 3: Info, 4: Hint
  message: string;
  source?: string;
}

export function formatDiagnostic(diag: LspDiagnostic): string {
  const line = diag.range.start.line + 1;
  const col = diag.range.start.character + 1;
  const severityStr =
    diag.severity === 1
      ? "Error"
      : diag.severity === 2
      ? "Warning"
      : diag.severity === 3
      ? "Info"
      : "Hint";

  const sourceStr = diag.source ? ` (${diag.source})` : "";
  return `Line ${line}:${col} [${severityStr}]: ${diag.message.trim()}${sourceStr}`;
}

export function formatLspResult(
  operation: string,
  rawResult: any,
  projectDirectory: string
): string {
  if (!rawResult || (Array.isArray(rawResult) && rawResult.length === 0)) {
    return `No results found for ${operation}`;
  }

  // Location / LocationLink array (goToDefinition, findReferences, goToImplementation)
  if (Array.isArray(rawResult) && rawResult[0]?.uri) {
    const lines = [`${operation} found ${rawResult.length} location(s):`];
    for (const loc of rawResult.slice(0, 30)) {
      const filePath = loc.uri.startsWith("file://")
        ? new URL(loc.uri).pathname
        : loc.uri;
      const rel = path.relative(projectDirectory, filePath).replaceAll("\\", "/");
      const line = (loc.range?.start?.line ?? 0) + 1;
      const col = (loc.range?.start?.character ?? 0) + 1;
      lines.push(`  - ${rel}:${line}:${col}`);
    }
    if (rawResult.length > 30) {
      lines.push(`  ... and ${rawResult.length - 30} more`);
    }
    return lines.join("\n");
  }

  // Hover result
  if (rawResult.contents) {
    const contents = rawResult.contents;
    if (typeof contents === "string") return contents;
    if (contents.value) return contents.value;
    if (Array.isArray(contents)) {
      return contents.map((c) => (typeof c === "string" ? c : c.value)).join("\n\n");
    }
  }

  // Document Symbols
  if (Array.isArray(rawResult) && rawResult[0]?.name) {
    const lines = [`Symbols (${rawResult.length}):`];
    for (const sym of rawResult.slice(0, 50)) {
      const line = (sym.range?.start?.line ?? sym.location?.range?.start?.line ?? 0) + 1;
      lines.push(`  - ${sym.name} (line ${line})`);
    }
    return lines.join("\n");
  }

  return JSON.stringify(rawResult, null, 2);
}
