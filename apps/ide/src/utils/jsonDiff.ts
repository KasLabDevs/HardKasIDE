/** Field-by-field difference of two JSON documents, as a flat list of paths. */

export interface DiffEntry {
  path: string;
  kind: "changed" | "added" | "removed";
  left?: unknown;
  right?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function diffJson(left: unknown, right: unknown, path = "", out: DiffEntry[] = []): DiffEntry[] {
  if (isObj(left) && isObj(right)) {
    for (const k of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in left)) out.push({ path: p, kind: "added", right: right[k] });
      else if (!(k in right)) out.push({ path: p, kind: "removed", left: left[k] });
      else diffJson(left[k], right[k], p, out);
    }
  } else if (Array.isArray(left) && Array.isArray(right)) {
    const n = Math.max(left.length, right.length);
    for (let i = 0; i < n; i++) {
      const p = `${path}[${i}]`;
      if (i >= left.length) out.push({ path: p, kind: "added", right: right[i] });
      else if (i >= right.length) out.push({ path: p, kind: "removed", left: left[i] });
      else diffJson(left[i], right[i], p, out);
    }
  } else if (JSON.stringify(left) !== JSON.stringify(right)) {
    out.push({ path: path || "(root)", kind: "changed", left, right });
  }
  return out;
}

export function show(v: unknown, max = 90): string {
  const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? "undefined";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
