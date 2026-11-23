import { describe, expect, it } from "vitest";
import { extractLocalUrls, portOfUrl, stripAnsi } from "./scriptUrls";

describe("scriptUrls", () => {
  it("strips ANSI color codes and extracts localhost/127.0.0.1/0.0.0.0 URLs", () => {
    const sample =
      "\x1b[32m  ➜\x1b[0m  \x1b[1mLocal:\x1b[0m   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[0m\n" +
      "  ➜  Network: http://192.168.1.40:5173/\n" +
      "  Ready on http://0.0.0.0:8788/api/health, and ws fallback on http://[::1]:3000.\n";

    expect(stripAnsi("\x1b[36mhello\x1b[0m")).toBe("hello");
    expect(extractLocalUrls(sample)).toEqual([
      "http://localhost:5173/",
      "http://localhost:8788/api/health",
      "http://localhost:3000/"
    ]);
  });

  it("ignores LAN/public hosts and deduplicates identical normalized URLs", () => {
    const sample = "Local: http://localhost:5173 and http://localhost:5173/ and Network: http://10.0.0.5:5173/";
    expect(extractLocalUrls(sample)).toEqual(["http://localhost:5173/"]);
  });

  it("extracts port numbers for compact pill badges", () => {
    expect(portOfUrl("http://127.0.0.1:7421/")).toBe("7421");
    expect(portOfUrl("not-a-url")).toBeNull();
  });
});
