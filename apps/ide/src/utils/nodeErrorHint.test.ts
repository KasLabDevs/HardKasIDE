import { describe, expect, it } from "vitest";
import { nodeErrorHint } from "./nodeErrorHint";

describe("nodeErrorHint", () => {
  it("recognises Docker not running on Windows, macOS and Linux", () => {
    for (const text of [
      "Could not start the node: error during connect: Get \"http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/containers/json\": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.",
      "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
    ]) {
      expect(nodeErrorHint(text)?.cause).toMatch(/Docker is not running/);
    }
  });

  it("recognises a port that is already taken", () => {
    expect(nodeErrorHint("Bind for 0.0.0.0:16610 failed: port is already allocated")?.cause).toMatch(/port/);
    expect(nodeErrorHint("listen EADDRINUSE: address already in use 127.0.0.1:18210")?.cause).toMatch(/port/);
  });

  it("recognises image download failures and an RPC timeout", () => {
    expect(nodeErrorHint("Error response from daemon: Get https://registry-1.docker.io/v2/: net/http: TLS handshake timeout")?.cause).toMatch(/download/);
    expect(nodeErrorHint("The node did not answer on RPC within 2 minutes. Check the Console and Docker.")?.cause).toMatch(/RPC/);
  });

  it("leaves unknown failures alone", () => {
    expect(nodeErrorHint("Could not start the node (exit 1). See the Console for details.")).toBeNull();
    expect(nodeErrorHint("")).toBeNull();
    expect(nodeErrorHint(null)).toBeNull();
  });
});
