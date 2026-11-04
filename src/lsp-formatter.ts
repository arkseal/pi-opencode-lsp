import * as path from "node:path";
import { fileURLToPath } from "node:url";

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

const MAX_FORMATTED_CHARS = 8000;

function resolveLocationUri(uri: string, projectDirectory: string): string {
  try {
    const filePath = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
    return path.relative(projectDirectory, filePath).replaceAll("\\", "/");
  } catch {
    return uri;
  }
}

export function formatLspResult(
  operation: string,
  rawResult: any,
  projectDirectory: string
): string {
  if (!rawResult || (Array.isArray(rawResult) && rawResult.length === 0)) {
    return `No results found for ${operation}`;
  }

  let formatted = "";

  // Single location object (some LSPs return a single Location for definition)
  if (!Array.isArray(rawResult) && rawResult?.uri && rawResult?.range) {
    const rel = resolveLocationUri(rawResult.uri, projectDirectory);
    const line = (rawResult.range?.start?.line ?? 0) + 1;
    const col = (rawResult.range?.start?.character ?? 0) + 1;
    formatted = `${operation} found 1 location:\n  - ${rel}:${line}:${col}`;
  }
  // Location / LocationLink array (goToDefinition, findReferences, goToImplementation)
  else if (Array.isArray(rawResult) && rawResult[0]?.uri) {
    const lines = [`${operation} found ${rawResult.length} location(s):`];
    for (const loc of rawResult.slice(0, 30)) {
      const rel = resolveLocationUri(loc.uri, projectDirectory);
      const line = (loc.range?.start?.line ?? 0) + 1;
      const col = (loc.range?.start?.character ?? 0) + 1;
      lines.push(`  - ${rel}:${line}:${col}`);
    }
    if (rawResult.length > 30) {
      lines.push(`  ... and ${rawResult.length - 30} more`);
    }
    formatted = lines.join("\n");
  }
  // Hover result
  else if (rawResult.contents) {
    const contents = rawResult.contents;
    if (typeof contents === "string") {
      formatted = contents;
    } else if (contents.value) {
      formatted = contents.value;
    } else if (Array.isArray(contents)) {
      formatted = contents
        .map((c) => (typeof c === "string" ? c : c.value))
        .join("\n\n");
    }
  }
  // Symbols (documentSymbol or workspaceSymbol)
  else if (Array.isArray(rawResult) && rawResult[0]?.name) {
    const isWorkspace =
      operation === "workspaceSymbol" || rawResult.some((s: any) => s.location?.uri);
    const label = isWorkspace ? "Workspace symbols" : "Symbols";
    const lines = [`${label} (${rawResult.length}):`];

    for (const sym of rawResult.slice(0, 50)) {
      const line =
        (sym.range?.start?.line ?? sym.location?.range?.start?.line ?? 0) + 1;
      let locStr = `line ${line}`;
      if (sym.location?.uri) {
        const rel = resolveLocationUri(sym.location.uri, projectDirectory);
        locStr = `${rel}:${line}`;
      }
      const container = sym.containerName ? ` [${sym.containerName}]` : "";
      lines.push(`  - ${sym.name}${container} (${locStr})`);
    }
    if (rawResult.length > 50) {
      lines.push(`  ... and ${rawResult.length - 50} more`);
    }
    formatted = lines.join("\n");
  } else {
    formatted = JSON.stringify(rawResult, null, 2);
  }

  // Bounded output to prevent context window blowout
  if (formatted.length > MAX_FORMATTED_CHARS) {
    return (
      formatted.slice(0, MAX_FORMATTED_CHARS) +
      "\n\n...(output truncated to stay within token limits)"
    );
  }

  return formatted;
}
