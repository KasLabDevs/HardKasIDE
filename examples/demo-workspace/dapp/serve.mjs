// serve.mjs
// Lightweight HTTP server for KaspaAuction dApp on http://localhost:3300

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3300;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = http.createServer((req, res) => {
  let file = req.url.split("?")[0];
  if (file === "/" || file === "") file = "/index.html";
  const filePath = path.join(__dirname, file);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);

  res.writeHead(200, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*"
  });
  res.end(content);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n======================================================`);
  console.log(`🚀 KaspaAuction dApp running at: http://127.0.0.1:${PORT}`);
  console.log(`   Open in Chrome with KasWare to interact with contract!`);
  console.log(`======================================================\n`);
});
