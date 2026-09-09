export function appendDiagnosticsToEditResult(
  originalOutput: string,
  filePath: string,
  diagnostics: string[]
): string {
  if (!diagnostics || diagnostics.length === 0) {
    return originalOutput;
  }

  const lines = [
    originalOutput,
    "",
    `LSP diagnostics detected in ${filePath}, please review:`,
    ...diagnostics.map((d) => `  ${d}`),
  ];

  return lines.join("\n");
}
