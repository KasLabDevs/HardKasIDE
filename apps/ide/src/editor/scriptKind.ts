/** TypeScript's ScriptKind values the editor needs. */
export interface ScriptKinds {
  JS: number;
  JSX: number;
  TS: number;
  TSX: number;
}

/**
 * The kind of a file by its extension, for the extensions Monaco's worker does not know (it knows .ts/.tsx/.js/.jsx).
 * `null`: leave it to Monaco.
 */
export function scriptKindFor(fileName: string, kinds: ScriptKinds): number | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".mts") || lower.endsWith(".cts")) return kinds.TS; // also .d.mts / .d.cts
  if (lower.endsWith(".mjs") || lower.endsWith(".cjs")) return kinds.JS;
  return null;
}
