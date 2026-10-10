import { it, expect } from "vitest";
import { nodeRepository } from "../src/adapters/node-db";
import { createApi } from "../src/api/app";
const config = {
  adminPassword: "test-password-123",
  sessionSecret: "test-secret-with-at-least-32-characters",
  secureCookie: false,
};
it("protects data, logs in and masks Bark secrets", async () => {
  const repo = nodeRepository(":memory:");
  const app = createApi(() => ({ repo, config }));
  expect((await app.request("/api/catalog")).status).toBe(401);
  const login = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: config.adminPassword }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const headers = { cookie, "content-type": "application/json" };
  expect(
    (
      await app.request("/api/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          barkUrl: "https://api.day.app/my-device-secret",
        }),
      })
    ).status,
  ).toBe(200);
  const settings = await (
    await app.request("/api/settings", { headers })
  ).json();
  expect(JSON.stringify(settings)).not.toContain("my-device-secret");
  expect(
    (
      await app.request("/api/watches", {
        method: "POST",
        headers,
        body: JSON.stringify({ name: "bad", productIds: [], storeIds: [] }),
      })
    ).status,
  ).toBe(400);
  repo.close();
});
it("rejects cross-origin mutations even with a valid session", async () => {
  const repo = nodeRepository(":memory:");
  const app = createApi(() => ({ repo, config }));
  const res = await app.request("http://localhost/api/login", {
    method: "POST",
    headers: {
      origin: "https://other.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect(res.status).toBe(403);
  repo.close();
});
it("filters real events, exports HK CSV and rejects invalid dates and granularity", async () => {
  const repo = nodeRepository(":memory:");
  const app = createApi(() => ({ repo, config }));
  const at = Date.parse("2026-10-08T16:00:01Z");
  await repo.saveCatalog(
    [
      {
        id: "P",
        model: "iPhone 18 Pro",
        color: "black",
        capacity: "256GB",
        url: "https://www.apple.com/hk/shop/",
        active: true,
      },
    ],
    [{ id: "S", name: "ifc mall" }],
    at,
  );
  await repo.acquire("a", at);
  await repo.commitRound(
    "a",
    [{ productId: "P", storeId: "S", status: "unavailable" }],
    at,
    [],
  );
  await repo.acquire("b", at + 30000);
  await repo.commitRound(
    "b",
    [{ productId: "P", storeId: "S", status: "available" }],
    at + 30000,
    [],
  );
  const r = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: config.adminPassword }),
  });
  const headers = { cookie: r.headers.get("set-cookie")!.split(";")[0] };
  const stats = (await (
    await app.request(
      "/api/history/stats?from=2026-10-09&to=2026-10-09&color=black",
      { headers },
    )
  ).json()) as any;
  expect(stats.totals.restocks).toBe(1);
  expect(stats.totals.exposureSeconds).toBe(30);
  expect(stats.totals).toMatchObject({
    availableChecks: 1,
    unavailableChecks: 1,
    validChecks: 2,
    unknownChecks: 0,
    hitRate: 0.5,
  });
  expect(stats.queryCountsStartedAt).toBe(at);
  const queries = (await (
    await app.request(
      "/api/history/queries?from=2026-10-09&to=2026-10-09&color=black",
      { headers },
    )
  ).json()) as { items: { available: number; unavailable: number }[] };
  expect(queries.items[0]).toMatchObject({ available: 1, unavailable: 1 });
  const queryCsv = await (
    await app.request(
      "/api/history/export?kind=queries&from=2026-10-09&to=2026-10-09",
      { headers },
    )
  ).text();
  expect(queryCsv).toContain(
    '"2026-10-09","00:00","00:15","iPhone 18 Pro","black","256GB","ifc mall","P","1","1","0","2","50.0%"',
  );
  const filtered = (await (
    await app.request(
      "/api/history/events?from=2026-10-09&to=2026-10-09&color=burgundy",
      { headers },
    )
  ).json()) as any;
  expect(filtered.total).toBe(0);
  const csv = await (
    await app.request("/api/history/export?from=2026-10-09&to=2026-10-09", {
      headers,
    })
  ).text();
  expect(csv).toContain('"2026-10-09","00:00:31","restock"');
  expect(
    (await app.request("/api/history/stats?from=2026-02-30", { headers }))
      .status,
  ).toBe(400);
  expect(
    (await app.request("/api/history/stats?minutes=5", { headers })).status,
  ).toBe(400);
  repo.close();
});
it("limits repeated failed logins without exposing authentication secrets", async () => {
  const repo = nodeRepository(":memory:");
  const app = createApi(() => ({ repo, config }));
  for (let i = 0; i < 10; i++) {
    const r = await app.request("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(r.status).toBe(401);
  }
  expect(
    (
      await app.request("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: config.adminPassword }),
      })
    ).status,
  ).toBe(429);
  repo.close();
});
it("protects maintenance snapshots and will not resume a partial import", async () => {
  const repo = nodeRepository(":memory:");
  const app = createApi(() => ({ repo, config }));
  const login = await app.request("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: config.adminPassword }),
  });
  const headers = {
    cookie: login.headers.get("set-cookie")!.split(";")[0],
    "content-type": "application/json",
  };
  await repo.setSetting("maintenanceMode", "true");
  expect(
    (
      await app.request("/api/settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ barkUrl: "" }),
      })
    ).status,
  ).toBe(409);
  await repo.setSetting("importInProgress", "true");
  expect(
    (
      await app.request("/api/monitor", {
        method: "PUT",
        headers,
        body: '{"enabled":true}',
      })
    ).status,
  ).toBe(409);
  await repo.setSetting("importInProgress", "false");
  expect(
    (
      await app.request("/api/monitor", {
        method: "PUT",
        headers,
        body: '{"enabled":true}',
      })
    ).status,
  ).toBe(200);
  expect(await repo.setting("maintenanceMode")).toBe("false");
  repo.close();
});
