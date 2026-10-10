import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { Repository } from "../db/repository";
import { hkMidnight, hkDate, hkTime, GAP_MS } from "../core/domain";
import { aggregateAvailability } from "../core/availability";
import seed from "../db/catalog.json";
import { AppleProvider, ProviderError } from "../core/apple";
import { sendBark, validateBarkUrl } from "../core/bark";
import type { Filter } from "../core/types";
export interface ApiConfig {
  adminPassword: string;
  sessionSecret: string;
  secureCookie: boolean;
  barkAllowedHosts?: string[];
}
export interface Services {
  repo: Repository;
  config: ApiConfig;
  wake?: () => Promise<void>;
}
export function validateConfig(config: ApiConfig) {
  if (config.adminPassword.length < 12 || config.sessionSecret.length < 32)
    throw new Error("ADMIN_PASSWORD 至少 12 位，SESSION_SECRET 至少 32 位");
}
async function samePassword(a: string, b: string) {
  const hash = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [x, y] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
const WatchSchema = z.object({
  name: z.string().trim().min(1).max(60),
  productIds: z.array(z.string()).min(1).max(64),
  storeIds: z.array(z.string()).min(1).max(20),
  enabled: z.boolean().default(true),
});
export function createApi<E extends { Bindings?: object } = {}>(
  services: (env: E["Bindings"]) => Services,
) {
  const app = new Hono<E>();
  app.use(
    "/api/*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    }),
  );
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) => c.json({ error: "请求内容过大" }, 413),
    }),
  );
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && origin !== new URL(c.req.url).origin)
        return c.json({ error: "不允许跨站请求" }, 403);
      if (c.req.header("sec-fetch-site") === "cross-site")
        return c.json({ error: "不允许跨站请求" }, 403);
      if (
        c.req.path !== "/api/logout" &&
        !c.req.header("content-type")?.startsWith("application/json")
      )
        return c.json({ error: "需要 JSON 请求" }, 415);
    }
    if (c.req.path === "/api/login" || c.req.path === "/api/health")
      return next();
    const { config } = services(c.env);
    const token = getCookie(c, "session");
    try {
      if (!token) throw Error();
      const payload = await verify(token, config.sessionSecret, "HS256");
      if (payload.sub !== "admin") throw Error();
    } catch {
      return c.json({ error: "请先登录" }, 401);
    }
    if (
      !["GET", "HEAD"].includes(c.req.method) &&
      !["/api/monitor", "/api/logout"].includes(c.req.path) &&
      (await services(c.env).repo.setting("maintenanceMode")) === "true"
    )
      return c.json({ error: "当前处于备份／迁移模式，请先恢复采集" }, 409);
    await next();
  });
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.post("/api/login", async (c) => {
    const { repo, config } = services(c.env);
    validateConfig(config);
    if (!(await repo.loginAllowed(Date.now())))
      return c.json({ error: "尝试过多，请 15 分钟后重试" }, 429);
    const input = z
      .object({ password: z.string().max(256) })
      .parse(await c.req.json());
    if (!(await samePassword(input.password, config.adminPassword))) {
      await repo.loginFailure(Date.now());
      return c.json({ error: "密码不正确" }, 401);
    }
    await repo.clearLoginFailures();
    setCookie(
      c,
      "session",
      await sign(
        { sub: "admin", exp: Math.floor(Date.now() / 1000) + 7 * 86400 },
        config.sessionSecret,
        "HS256",
      ),
      {
        httpOnly: true,
        secure: config.secureCookie,
        sameSite: "Strict",
        path: "/",
        maxAge: 7 * 86400,
      },
    );
    return c.json({ ok: true });
  });
  app.post("/api/logout", (c) => {
    deleteCookie(c, "session", { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/session", (c) => c.json({ authenticated: true }));
  app.get("/api/catalog", async (c) =>
    c.json(await services(c.env).repo.catalog()),
  );
  app.get("/api/stock", async (c) => {
    const rows = await services(c.env).repo.stock();
    const now = Date.now();
    return c.json(
      rows.map((s) => ({
        ...s,
        stale: s.checkedAt === null || now - s.checkedAt > GAP_MS,
      })),
    );
  });
  app.get("/api/watches", async (c) =>
    c.json(await services(c.env).repo.watches()),
  );
  const save = async (env: E["Bindings"], input: unknown, id: string) => {
    const { repo, wake } = services(env);
    const data = WatchSchema.parse(input),
      catalog = await repo.catalog();
    if (
      data.productIds.some(
        (p) => !catalog.products.some((x) => x.id === p && x.active),
      ) ||
      data.storeIds.some((s) => !catalog.stores.some((x) => x.id === s))
    )
      throw new Error("INVALID_WATCH");
    const w = {
      ...data,
      id,
      productIds: [...new Set(data.productIds)],
      storeIds: [...new Set(data.storeIds)],
    };
    await repo.saveWatch(w);
    await wake?.();
    return w;
  };
  app.post("/api/watches", async (c) =>
    c.json(await save(c.env, await c.req.json(), crypto.randomUUID()), 201),
  );
  app.put("/api/watches/:id", async (c) => {
    if (
      !(await services(c.env).repo.watches()).some(
        (w) => w.id === c.req.param("id"),
      )
    )
      return c.json({ error: "关注不存在" }, 404);
    return c.json(await save(c.env, await c.req.json(), c.req.param("id")));
  });
  app.delete("/api/watches/:id", async (c) => {
    await services(c.env).repo.deleteWatch(c.req.param("id"));
    return c.json({ ok: true });
  });
  function filter(params: Record<string, string>): Filter {
    const date = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (s) => Number.isFinite(hkMidnight(s)) && hkDate(hkMidnight(s)) === s,
        "无效日期",
      );
    const today = hkDate(Date.now()),
      from = params.from ?? hkDate(Date.now() - 6 * 86400000),
      to = params.to ?? today;
    date.parse(from);
    date.parse(to);
    const start = hkMidnight(from),
      end = hkMidnight(to) + 86400000;
    if (start >= end || start >= Date.now() || end - start > 366 * 86400000)
      throw new Error("INVALID_RANGE");
    return {
      from: start,
      to: Math.min(end, Date.now()),
      model: params.model || undefined,
      color: params.color || undefined,
      capacity: params.capacity || undefined,
      storeId: params.storeId || undefined,
      productId: params.productId || undefined,
    };
  }
  app.get("/api/history/events", async (c) => {
    const p = c.req.query();
    return c.json(
      await services(c.env).repo.events(
        filter(p),
        z.coerce
          .number()
          .int()
          .min(1)
          .max(100000)
          .parse(p.page ?? 1),
        z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .parse(p.limit ?? 50),
      ),
    );
  });
  app.get("/api/history/stats", async (c) => {
    const p = c.req.query(),
      f = filter(p),
      minutes = z.coerce
        .number()
        .refine((x) => x === 15 || x === 60)
        .parse(p.minutes ?? 15);
    const data = await services(c.env).repo.historyData(f);
    return c.json({
      ...aggregateAvailability({
        ...f,
        minutes,
        ...data,
      }),
      queryCountsStartedAt: data.queryCountsStartedAt,
    });
  });
  app.get("/api/history/queries", async (c) => {
    const p = c.req.query();
    return c.json(
      await services(c.env).repo.queryCounts(
        filter(p),
        z.coerce
          .number()
          .int()
          .min(1)
          .max(100000)
          .parse(p.page ?? 1),
        z.coerce
          .number()
          .int()
          .min(1)
          .max(200)
          .parse(p.limit ?? 50),
        p.availableOnly === "true",
      ),
    );
  });
  app.get("/api/history/export", async (c) => {
    const { repo } = services(c.env),
      f = filter(c.req.query()),
      catalog = await repo.catalog();
    const kind = z
      .enum(["events", "queries"])
      .parse(c.req.query("kind") ?? "events");
    const quote = (value: unknown) =>
      `"${String(value ?? "")
        .replace(/^([=+\-@])/, "\t$1")
        .replace(/"/g, '""')}"`;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              kind === "queries"
                ? "\uFEFF日期,时段开始,香港时段结束,机型,颜色,容量,门店,商品编号,有货次数,无货次数,失败或未知,有效查询次数,有货率\r\n"
                : "\uFEFF日期,香港时间,类型,机型,颜色,容量,门店,商品编号\r\n",
            ),
          );
          let page = 1;
          while (true) {
            if (kind === "queries") {
              const r = await repo.queryCounts(f, page++, 200);
              for (const q of r.items) {
                const p = catalog.products.find((x) => x.id === q.productId),
                  s = catalog.stores.find((x) => x.id === q.storeId);
                const valid = q.available + q.unavailable;
                controller.enqueue(
                  encoder.encode(
                    [
                      hkDate(q.at),
                      hkTime(q.at).slice(0, 5),
                      hkTime(q.at + 900000).slice(0, 5),
                      p?.model,
                      p?.color,
                      p?.capacity,
                      s?.name,
                      q.productId,
                      q.available,
                      q.unavailable,
                      q.unknown,
                      valid,
                      valid
                        ? `${((q.available / valid) * 100).toFixed(1)}%`
                        : "",
                    ]
                      .map(quote)
                      .join(",") + "\r\n",
                  ),
                );
              }
              if ((page - 1) * 200 >= r.total) break;
              continue;
            }
            const r = await repo.events(f, page++, 200);
            for (const e of r.items) {
              const p = catalog.products.find((x) => x.id === e.productId),
                s = catalog.stores.find((x) => x.id === e.storeId);
              controller.enqueue(
                encoder.encode(
                  [
                    hkDate(e.at),
                    new Date(e.at + 8 * 3600000).toISOString().slice(11, 19),
                    e.kind,
                    p?.model,
                    p?.color,
                    p?.capacity,
                    s?.name,
                    e.productId,
                  ]
                    .map(quote)
                    .join(",") + "\r\n",
                ),
              );
            }
            if ((page - 1) * 200 >= r.total) break;
          }
          controller.close();
        } catch {
          controller.error(new Error("导出失败"));
        }
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="iphone-ding-${kind === "queries" ? "availability" : "history"}.csv"`,
        "cache-control": "no-store",
      },
    });
  });
  app.post("/api/probe", async (c) => {
    const provider = new AppleProvider(),
      { repo } = services(c.env),
      catalog = await repo.catalog();
    try {
      const products = await provider.catalog(),
        result = await provider.pickup(
          products.slice(0, 8).map((p) => p.id),
          (catalog.stores.length ? catalog.stores : seed.stores).map(
            (s) => s.id,
          ),
        );
      return c.json({
        at: Date.now(),
        catalogProducts: products.length,
        queriedProducts: 8,
        stores: result.stores,
        observations: result.observations.length,
        available: result.observations.filter((o) => o.status === "available")
          .length,
        unavailable: result.observations.filter(
          (o) => o.status === "unavailable",
        ).length,
        unknown: result.observations.filter((o) => o.status === "unknown")
          .length,
      });
    } catch (error) {
      return c.json(
        {
          error: "当前部署环境无法完成 Apple 实时查询",
          reason:
            error instanceof ProviderError
              ? error.message
              : error instanceof z.ZodError
                ? "Apple 响应结构不匹配"
                : error instanceof Error
                  ? error.message.slice(0, 200)
                  : "未知错误",
        },
        502,
      );
    }
  });
  app.get("/api/status", async (c) => {
    const { repo } = services(c.env);
    return c.json({
      ...(await repo.status()),
      notifications: await repo.notificationLog(),
      diagnostics: await repo.diagnostics(),
    });
  });
  app.put("/api/monitor", async (c) => {
    const { repo, wake } = services(c.env);
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .parse(await c.req.json());
    if (enabled && (await repo.setting("importInProgress")) === "true")
      return c.json({ error: "数据导入尚未完成，请先修复导入" }, 409);
    if (enabled) await repo.setSetting("maintenanceMode", "false");
    await repo.setSetting("monitorEnabled", String(enabled));
    await wake?.();
    return c.json({ ok: true });
  });
  app.get("/api/settings", async (c) => {
    const { repo, config } = services(c.env),
      bark = await repo.setting("barkUrl");
    return c.json({
      barkConfigured: !!bark,
      barkHost: bark ? new URL(bark).hostname : null,
      barkMasked: bark ? `${new URL(bark).origin}/••••••` : null,
      allowedHosts: config.barkAllowedHosts ?? ["api.day.app"],
    });
  });
  app.put("/api/settings", async (c) => {
    const { repo, config } = services(c.env);
    const { barkUrl } = z
      .object({ barkUrl: z.string().max(1024) })
      .parse(await c.req.json());
    if (barkUrl) {
      let url: string;
      try {
        url = validateBarkUrl(barkUrl);
      } catch {
        return c.json({ error: "请输入有效的 HTTPS Bark 设备地址" }, 400);
      }
      if (
        !(config.barkAllowedHosts ?? ["api.day.app"]).includes(
          new URL(url).hostname,
        )
      )
        return c.json({ error: "Bark 域名不在服务器允许列表中" }, 400);
      await repo.setSetting("barkUrl", url);
    } else await repo.setSetting("barkUrl", "");
    return c.json({ ok: true });
  });
  app.post("/api/settings/test", async (c) => {
    const { repo, config } = services(c.env),
      url = await repo.setting("barkUrl");
    if (!url) return c.json({ error: "请先保存 Bark 地址" }, 400);
    try {
      await sendBark(
        url,
        {
          title: "iPhone Ding 测试通知",
          body: "通知已连接，可以开始关注香港门店库存。",
          url: "https://www.apple.com/hk/shop/buy-iphone/iphone-18-pro",
        },
        fetch,
        config.barkAllowedHosts,
      );
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "Bark 未确认发送成功，请检查地址或网络" }, 502);
    }
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: "输入格式不正确",
          details: error.issues.map((x) => ({
            path: x.path.join("."),
            message: x.message,
          })),
        },
        400,
      );
    if (error.message === "INVALID_WATCH")
      return c.json({ error: "请选择目录中有效的商品和门店" }, 400);
    if (error.message === "INVALID_RANGE")
      return c.json({ error: "日期范围须为 1–366 天" }, 400);
    if (error instanceof SyntaxError)
      return c.json({ error: "JSON 格式错误" }, 400);
    return c.json({ error: "服务暂时不可用，请检查后台运行状态" }, 500);
  });
  return app;
}
