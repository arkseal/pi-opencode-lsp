const MAX_REPORTED_DIAGNOSTICS = 20;

export function appendDiagnosticsToEditResult(
  originalOutput: string,
  filePath: string,
  diagnostics: string[]
): string {
  if (!diagnostics || diagnostics.length === 0) {
    return originalOutput;
  }

  const shown = diagnostics.slice(0, MAX_REPORTED_DIAGNOSTICS);
  const remainingCount = diagnostics.length - shown.length;

  const lines = [
    originalOutput,
    "",
    `LSP diagnostics detected in ${filePath}, please review:`,
    ...shown.map((d) => `  ${d}`),
  ];

  if (remainingCount > 0) {
    lines.push(`  ... and ${remainingCount} more diagnostic(s)`);
  }

  return lines.join("\n");
}
