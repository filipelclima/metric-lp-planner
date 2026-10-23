import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchJsonWithTimeout } from "@/lib/fetchTimeout";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/slow") {
      setTimeout(() => res.end('{"ok":true}'), 1000);
      return;
    }
    if (req.url === "/fail") {
      res.statusCode = 500;
      res.end("{}");
      return;
    }
    if (req.url === "/bad") {
      res.end("not json");
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("fetchJsonWithTimeout", () => {
  it("returns parsed JSON when the server answers in time", async () => {
    expect(await fetchJsonWithTimeout<{ ok: boolean }>(`${base}/fast`, 1000)).toEqual({ ok: true });
  });

  it("gives up at the deadline and returns null instead of throwing", async () => {
    const t0 = Date.now();
    expect(await fetchJsonWithTimeout(`${base}/slow`, 150)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(800);
  });

  it("returns null for non-2xx, invalid JSON and unreachable hosts", async () => {
    expect(await fetchJsonWithTimeout(`${base}/fail`, 1000)).toBeNull();
    expect(await fetchJsonWithTimeout(`${base}/bad`, 1000)).toBeNull();
    expect(await fetchJsonWithTimeout("http://127.0.0.1:1/nothing", 1000)).toBeNull();
  });
});
