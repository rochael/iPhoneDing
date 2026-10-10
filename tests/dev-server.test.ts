import { it, expect } from "vitest";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "vite";
import config from "../vite.config";
import { getRequestListener } from "@hono/node-server";
import { createApi } from "../src/api/app";
import { nodeRepository } from "../src/adapters/node-db";

it("logs in through the Node HTTP adapter using a configured HTTPS public origin", async () => {
  const repo = nodeRepository(":memory:");
  const password = "proxy-login-test-password";
  const app = createApi(() => ({
    repo,
    config: {
      adminPassword: password,
      sessionSecret: "s".repeat(40),
      secureCookie: true,
      publicOrigin: "https://iphone.phper.dev",
    },
  }));
  const backend = createHttpServer(getRequestListener(app.fetch));
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  try {
    const url = `http://127.0.0.1:${(backend.address() as { port: number }).port}/api/login`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        origin: "https://iphone.phper.dev",
        "content-type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(await response.json()).toEqual({ ok: true });
  } finally {
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    );
    repo.close();
  }
});

it("serves the frontend API module while proxying backend API routes", async () => {
  const repo = nodeRepository(":memory:");
  const password = "dev-login-test-password";
  const app = createApi(() => ({
    repo,
    config: {
      adminPassword: password,
      sessionSecret: "s".repeat(40),
      secureCookie: false,
    },
  }));
  const backend = createHttpServer(getRequestListener(app.fetch));
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const target = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
  const cacheDir = mkdtempSync(join(tmpdir(), "iphone-ding-vite-"));
  const server = await createServer({
    ...config,
    configFile: false,
    cacheDir,
    logLevel: "silent",
    server: {
      ...config.server,
      host: "127.0.0.1",
      port: 0,
      hmr: false,
      watch: null,
      proxy: Object.fromEntries(
        Object.entries(config.server?.proxy ?? {}).map(([key, options]) => [
          key,
          typeof options === "string" ? target : { ...options, target },
        ]),
      ),
    },
  });
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
    const module = await fetch(`${origin}/api.ts`);
    expect(module.status).toBe(200);
    expect(module.headers.get("content-type")).toContain("javascript");
    const health = await fetch(`${origin}/api/health`);
    expect(await health.json()).toEqual({ ok: true });
    const login = await fetch(`${origin}/api/login`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ ok: true });
  } finally {
    await server.close();
    await new Promise<void>((resolve, reject) =>
      backend.close((error) => (error ? reject(error) : resolve())),
    );
    repo.close();
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
