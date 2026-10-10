import { it, expect } from "vitest";
import { nodeRepository } from "../src/adapters/node-db";
import { Monitor } from "../src/core/monitor";
import { AppleProvider } from "../src/core/apple";
import { sendBark, validateBarkUrl } from "../src/core/bark";
it("runs all catalog items, only notifies watched pairs and never notifies repeat availability", async () => {
  const repo = nodeRepository(":memory:");
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
    1000,
  );
  await repo.saveWatch({
    id: "w",
    name: "mine",
    productIds: ["P"],
    storeIds: ["S"],
    enabled: true,
  });
  await repo.setSetting("barkUrl", "https://api.day.app/secret");
  let time = 1000,
    sends = 0;
  const provider = {
    catalog: async () => {
      throw Error("not due");
    },
    pickup: async () => ({
      observations: [
        { productId: "P", storeId: "S", status: "available" as const },
      ],
      stores: [{ id: "S", name: "ifc mall" }],
    }),
  };
  const m = new Monitor(
    repo,
    provider,
    async () => {
      sends++;
    },
    () => time,
  );
  await m.tick("1");
  expect(sends).toBe(1);
  time += 30_000;
  await m.tick("2");
  expect(sends).toBe(1);
  expect((await repo.status()).lastSuccessAt).toBe(time);
  expect(
    (await repo.queryCounts({ from: 0, to: 100000 })).items[0].available,
  ).toBe(2);
  repo.close();
});
it("honors rate limit backoff and does not persist a failed response as unavailable", async () => {
  const provider = new AppleProvider(
    async () =>
      new Response("limited", {
        status: 429,
        headers: { "retry-after": "120" },
      }),
  );
  await expect(provider.pickup(["P"], ["S"])).rejects.toMatchObject({
    retryAfterMs: 120_000,
  });
});
it("validates Bark URL and rejects redirects to protect stored credentials", async () => {
  expect(() => validateBarkUrl("http://api.day.app/key")).toThrow();
  expect(() => validateBarkUrl("https://127.0.0.1/key")).toThrow();
  expect(validateBarkUrl("https://api.day.app/key")).toBe(
    "https://api.day.app/key",
  );
  await expect(
    sendBark(
      "https://api.day.app/key",
      { title: "test", body: "hello", url: "https://www.apple.com/hk/shop/" },
      async () => new Response("", { status: 302 }),
    ),
  ).rejects.toThrow();
});
it("persists bounded retry attempts and expires old alerts", async () => {
  const repo = nodeRepository(":memory:");
  await repo.setSetting("barkUrl", "https://api.day.app/secret");
  await repo.acquire("a", 1000);
  await repo.commitRound("a", [], 1000, [
    { title: "test", body: "hello", url: "https://www.apple.com/hk/shop/" },
  ]);
  let now = 1000,
    calls = 0;
  const m = new Monitor(
    repo,
    undefined,
    async () => {
      calls++;
      throw Error("network");
    },
    () => now,
  );
  for (const at of [1000, 31001, 91002, 211003]) {
    now = at;
    await m.deliver();
  }
  expect(calls).toBe(4);
  expect((await repo.notificationLog())[0]).toMatchObject({
    attempts: 4,
    status: "failed",
  });
  await repo.acquire("b", now);
  await repo.commitRound("b", [], now, [
    { title: "old", body: "hello", url: "https://www.apple.com/hk/shop/" },
  ]);
  now += 300001;
  await m.deliver();
  expect(calls).toBe(4);
  expect((await repo.notificationLog())[0].status).toBe("expired");
  repo.close();
});
it("stops dispatching new product batches once Retry-After is received", async () => {
  const { ProviderError } = await import("../src/core/apple");
  const repo = nodeRepository(":memory:");
  const products = Array.from({ length: 32 }, (_, i) => ({
    id: `P${i}`,
    model: "iPhone 18 Pro",
    color: "black",
    capacity: "256GB",
    url: "https://www.apple.com/hk/shop/",
    active: true,
  }));
  await repo.saveCatalog(products, [{ id: "S", name: "ifc mall" }], 1000);
  let calls = 0;
  const m = new Monitor(
    repo,
    {
      catalog: async () => products,
      pickup: async () => {
        calls++;
        throw new ProviderError("Apple HTTP 429", 300000);
      },
    },
    undefined,
    () => 2000,
  );
  await m.tick("limit");
  expect(calls).toBeLessThanOrEqual(2);
  expect((await repo.stock()).length).toBe(32);
  expect((await repo.status()).nextAt).toBe(302000);
  repo.close();
});
it("quiesces delivery while in maintenance mode", async () => {
  const repo = nodeRepository(":memory:");
  await repo.setSetting("barkUrl", "https://api.day.app/secret");
  await repo.acquire("a", 1000);
  await repo.commitRound("a", [], 1000, [
    { title: "test", body: "hello", url: "https://www.apple.com/hk/shop/" },
  ]);
  await repo.setSetting("maintenanceMode", "true");
  let calls = 0;
  const m = new Monitor(
    repo,
    undefined,
    async () => {
      calls++;
    },
    () => 2000,
  );
  await m.deliver();
  expect(calls).toBe(0);
  expect(await repo.claimNotification("a|0", 2000)).toBe(false);
  repo.close();
});

it("does not seed or replace catalog while importing", async () => {
  const repo = nodeRepository(":memory:");
  await repo.setSetting("importInProgress", "true");
  await new Monitor(repo).initialize();
  expect((await repo.catalog()).products).toHaveLength(0);
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
    [],
    1000,
  );
  expect((await repo.catalog()).products).toHaveLength(0);
  repo.close();
});

it("persists safe request failure details alongside unknown stock", async () => {
  const { ProviderError } = await import("../src/core/apple");
  const repo = nodeRepository(":memory:");
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
    1000,
  );
  const monitor = new Monitor(
    repo,
    {
      catalog: async () => [],
      pickup: async () => {
        throw new ProviderError("sensitive remote text", 60000, 541);
      },
    },
    undefined,
    () => 2000,
  );
  await monitor.tick("http-failure");
  expect((await repo.status()).error).toContain("Apple HTTP 541");
  expect((await repo.stock())[0].status).toBe("unknown");
  const diagnostics = await repo.diagnostics();
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].message).toContain("Apple HTTP 541");
  expect(diagnostics[0].message).not.toContain("sensitive remote text");
  expect(
    (await repo.queryCounts({ from: 0, to: 100000 })).items[0],
  ).toMatchObject({ available: 0, unavailable: 0, unknown: 1 });
  repo.close();
});
