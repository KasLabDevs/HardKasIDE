/** Calls to ide-server's /api/store: HardKAS's query store, read-only. */

async function parse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ({ ok?: boolean; message?: string; code?: string } & T) | null;
  if (!res.ok || !json || json.ok === false) {
    const e = new Error(json?.message ?? `HTTP ${res.status}`) as Error & { code?: string };
    e.code = json?.code;
    throw e;
  }
  return json;
}

export const storeGet = <T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> => {
  const qs = params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString() : "";
  return fetch(`/api/store/${path}${qs}`).then((r) => parse<T>(r));
};

export const storePost = <T>(path: string, body: unknown): Promise<T> =>
  fetch(`/api/store/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => parse<T>(r));
