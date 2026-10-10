import "../src/adapters/load-env";
import { AppleProvider } from "../src/core/apple";
import seed from "../src/db/catalog.json";
const target = process.argv[2];
try {
  if (target) {
    const origin = new URL(target).origin;
    if (!process.env.ADMIN_PASSWORD)
      throw Error("设置 ADMIN_PASSWORD 后再验证远程部署");
    const login = await fetch(`${origin}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }),
    });
    if (!login.ok) throw Error(`远程登录失败：HTTP ${login.status}`);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const result = await fetch(`${origin}/api/probe`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    console.log(await result.text());
    if (!result.ok) process.exitCode = 1;
  } else {
    const provider = new AppleProvider(),
      products = await provider.catalog();
    const results = await Promise.all([
      provider.pickup(
        products.slice(0, 8).map((p) => p.id),
        seed.stores.map((s) => s.id),
      ),
      provider.pickup(
        products.slice(8, 16).map((p) => p.id),
        seed.stores.map((s) => s.id),
      ),
    ]);
    const observations = results.flatMap((r) => r.observations);
    console.log(
      JSON.stringify(
        {
          runtime: "node",
          at: new Date().toISOString(),
          catalogProducts: products.length,
          stores: results[0].stores,
          queriedProducts: 16,
          observations: observations.length,
          available: observations.filter((o) => o.status === "available")
            .length,
          unavailable: observations.filter((o) => o.status === "unavailable")
            .length,
          unknown: observations.filter((o) => o.status === "unknown").length,
        },
        null,
        2,
      ),
    );
    if (observations.some((o) => o.status === "unknown")) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "验证失败");
  process.exitCode = 1;
}
