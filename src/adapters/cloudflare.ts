import { DurableObject } from "cloudflare:workers";
import { createApi, validateConfig } from "../api/app";
import { cloudflareRepository } from "./cloudflare-db";
import { Monitor } from "../core/monitor";
import { nextWakeAt } from "../core/domain";
import { sendBark } from "../core/bark";
export interface Bindings {
  DB: D1Database;
  MONITOR: DurableObjectNamespace<InventoryMonitor>;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  BARK_ALLOWED_HOSTS?: string;
  COOKIE_SECURE?: string;
}
function config(env: Bindings) {
  return {
    adminPassword: env.ADMIN_PASSWORD ?? "",
    sessionSecret: env.SESSION_SECRET ?? "",
    secureCookie: env.COOKIE_SECURE !== "false",
    barkAllowedHosts: (env.BARK_ALLOWED_HOSTS ?? "api.day.app")
      .split(",")
      .map((s) => s.trim()),
  };
}
function stub(env: Bindings) {
  return env.MONITOR.get(env.MONITOR.idFromName("hong-kong"));
}
const api = createApi<{ Bindings: Bindings }>((env) => ({
  repo: cloudflareRepository(env.DB),
  config: config(env),
  wake: async () => {
    await stub(env).fetch("https://monitor/ensure");
  },
}));
export class InventoryMonitor extends DurableObject<Bindings> {
  private monitor: Monitor;
  private initialized = false;
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.monitor = new Monitor(
      cloudflareRepository(env.DB),
      undefined,
      (url, message) =>
        sendBark(url, message, fetch, config(env).barkAllowedHosts),
    );
  }
  async fetch(request: Request) {
    if (new URL(request.url).pathname !== "/ensure")
      return new Response("Not found", { status: 404 });
    if (!this.initialized) {
      await this.monitor.initialize();
      this.initialized = true;
    }
    const alarm = await this.ctx.storage.getAlarm();
    // A cron wakeup must never postpone a pending alarm or create a parallel round.
    if (alarm === null || alarm < Date.now() - 180000)
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    return new Response("ok");
  }
  async alarm() {
    await this.ctx.storage.setAlarm(Date.now() + 180000);
    try {
      await this.monitor.tick();
    } finally {
      const repo = cloudflareRepository(this.env.DB),
        status = await repo.status();
      await this.ctx.storage.setAlarm(
        nextWakeAt(status, await repo.nextDeliveryAt(), Date.now()),
      );
    }
  }
}
export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    validateConfig(config(env));
    if (new URL(request.url).pathname.startsWith("/api/")) {
      if (new URL(request.url).pathname === "/api/catalog")
        await stub(env).fetch("https://monitor/ensure");
      return api.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(stub(env).fetch("https://monitor/ensure"));
  },
};
