/**
 * Constructor / entry arguments as people write them, turned into the form `hardkas silver compile --args` reads
 * (`@hardkas/core` parseSilArtifactValuesJson: `{ kind, value }`, bytes as an array of numbers).
 *
 * Accepted on top of that form: `type` as a spelling of `kind`; `pubkey`, `byte[]` and `byte[N]` as names of
 * `bytes`; a bytes value written as hex ("0x3e1b…"). Anything else is passed through for the CLI to judge.
 */
export function normalizeSilverValue(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  let kind = (o.kind ?? o.type) as unknown;
  if (kind === "pubkey" || kind === "byte[]" || (typeof kind === "string" && /^byte\[\d+\]$/.test(kind))) kind = "bytes";
  let value = o.value;
  if (kind === "bytes" && typeof value === "string") {
    const hex = value.trim().replace(/^0x/i, "");
    if (/^(?:[0-9a-fA-F]{2})*$/.test(hex)) value = Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
  if (kind === "array" && Array.isArray(value)) value = value.map(normalizeSilverValue);
  if (kind === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    value = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, x]) => [k, normalizeSilverValue(x)]));
  }
  return { kind, value };
}

/** The constructor-args text, normalized; text that is not a JSON array is returned as it is (the CLI reports it). */
export function normalizeSilverArgsText(text: string): string {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return text;
    return JSON.stringify(parsed.map(normalizeSilverValue));
  } catch {
    return text;
  }
}
