# pi-opencode-lsp

Unified Language Server Protocol (LSP) intelligence with non-invasive post-edit diagnostic feedback for the **pi** coding agent.

## Why This Architecture Minimizes Tokens

1. **Single Tool Schema (~120 tokens):**
   Instead of exposing 7–9 distinct tools (`goto_definition`, `find_references`, `hover`, etc.) which costs 1,500+ tokens on every turn, all operations are routed through a single `lsp` tool with an `operation` selector.

2. **Post-Edit Diagnostic Feedback:**
   When an edit or write completes, any fresh LSP diagnostics are appended **directly to the edit tool output**.
   - If the edit is clean, **zero diagnostic tokens** are added.
   - It **never mutates `systemPrompt`**, fully preserving prefix prompt caching for Anthropic, DeepSeek, and OpenAI.

## Supported Operations

- `goToDefinition`: Find symbol definitions across files
- `findReferences`: Find all references/callsites
- `hover`: Type signature and docstrings at cursor position
- `documentSymbol`: Outline of symbols in a file
- `workspaceSymbol`: Fuzzy search symbols project-wide
- `goToImplementation`: Find implementations of interfaces or traits
- `prepareCallHierarchy`: Call hierarchy analysis

## Auto-Supported Languages

- TypeScript / JavaScript (`typescript-language-server` / `vtsls`)
- Python (`pyright`)
- Rust (`rust-analyzer`)
- Go (`gopls`)
- C / C++ (`clangd`)

## Running Tests

```bash
bun test
```
