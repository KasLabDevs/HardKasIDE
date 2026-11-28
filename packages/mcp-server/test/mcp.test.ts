import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, describe, it } from "node:test";
import * as ide from "../src/ide.js";

const servers: http.Server[] = [];

afterEach(async () => {
  delete process.env.HARDKAS_IDE_URL;
  delete process.env.HARDKAS_IDE_TAB;
  await Promise.all(
    servers.splice(0).map(
      (srv) =>
        new Promise<void>((resolve) => {
          srv.close(() => resolve());
        })
    )
  );
});

async function startMockServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<string> {
  const srv = http.createServer(handler);
  servers.push(srv);
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const addr = srv.address() as { port: number };
  return `http://127.0.0.1:${addr.port}`;
}

describe("@hardkas-ide/mcp client transport & helpers", () => {
  it("always sends x-hardkas-client: mcp and forwards HARDKAS_IDE_TAB when set", async () => {
    const seen: Array<{ url: string; client?: string; tab?: string }> = [];
    process.env.HARDKAS_IDE_URL = await startMockServer((req, res) => {
      seen.push({
        url: req.url ?? "",
        client: req.headers["x-hardkas-client"] as string | undefined,
        tab: req.headers["x-hardkas-tab"] as string | undefined
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, workspace: { root: "C:/demo/app", name: "app" } }));
    });

    await ide.workspace();
    assert.equal(seen[0].client, "mcp");
    assert.equal(seen[0].tab, undefined);

    process.env.HARDKAS_IDE_TAB = "tab-demo-42";
    const ws = await ide.workspace();
    assert.equal(ws.root, "C:/demo/app");
    assert.equal(seen[1].client, "mcp");
    assert.equal(seen[1].tab, "tab-demo-42");
  });

  it("propagates IdeError codes when the server refuses a request", async () => {
    process.env.HARDKAS_IDE_URL = await startMockServer((_req, res) => {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, code: "FORBIDDEN", message: "refused secret path" }));
    });

    await assert.rejects(
      () => ide.readFile(".env"),
      (err: unknown) => err instanceof ide.IdeError && err.code === "FORBIDDEN" && err.message.includes("refused secret path")
    );
  });

  it("flattenTree collects file paths and filters cleanly by subfolder", () => {
    const nodes: ide.TreeNode[] = [
      {
        name: "contracts",
        path: "contracts",
        type: "dir",
        children: [{ name: "Vault.sil", path: "contracts/Vault.sil", type: "file" }]
      },
      { name: "hardkas.config.ts", path: "hardkas.config.ts", type: "file" }
    ];
    assert.deepEqual(ide.flattenTree(nodes), ["contracts/Vault.sil", "hardkas.config.ts"]);
    assert.deepEqual(ide.flattenTree(nodes, "contracts"), ["contracts/Vault.sil"]);
  });
});
