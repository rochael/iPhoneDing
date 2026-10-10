import { z } from "zod";
import type { Product, PickupResult, InventoryProvider } from "./types";
export const CATALOG_URL =
  "https://www.apple.com/hk/shop/buy-iphone/iphone-18-pro";
export const PICKUP_URL = "https://www.apple.com/hk/shop/retail/pickup-message";
const CatalogSchema = z.object({
  data: z.object({
    products: z.array(z.object({ partNumber: z.string(), name: z.string() })),
  }),
});
export function parseCatalog(html: string): Product[] {
  const script = html.match(
    /<script\b[^>]*\bid=["']metrics["'][^>]*>([\s\S]*?)<\/script>/i,
  )?.[1];
  if (!script) throw new Error("Apple 商品目录结构发生变化");
  const data = CatalogSchema.parse(JSON.parse(script));
  const products = data.data.products.flatMap((p) => {
    const name = p.name.replace(/\s+/g, " ");
    const m = name.match(
      /^(iPhone 18 Pro(?: Max)?) (256GB|512GB|1TB|2TB) (Burgundy|Glacier|Silver|Black)$/,
    );
    if (!m || !/^\w{5}ZA\/A$/.test(p.partNumber)) return [];
    const [, model, capacity, color] = m;
    return [
      {
        id: p.partNumber,
        model,
        capacity,
        color: color.toLowerCase(),
        active: true,
        url: `${CATALOG_URL}/${model.endsWith("Max") ? "6.9" : "6.3"}-inch-display-${capacity.toLowerCase()}-${color.toLowerCase()}`,
      },
    ];
  });
  if (
    !products.length ||
    new Set(products.map((p) => p.id)).size !== products.length
  )
    throw new Error("Apple 商品目录为空或重复");
  return products;
}
const PickupSchema = z.object({
  head: z.object({ status: z.union([z.string(), z.number()]) }),
  body: z.object({
    stores: z.array(
      z.object({
        storeNumber: z.string(),
        storeName: z.string(),
        country: z.string().optional(),
        partsAvailability: z
          .record(
            z.string(),
            z
              .object({
                pickupDisplay: z.string().optional(),
                storePickEligible: z.boolean().optional(),
              })
              .passthrough(),
          )
          .optional(),
      }),
    ),
  }),
});
export function parsePickup(
  raw: unknown,
  productIds: string[],
  storeIds: string[],
): PickupResult {
  const data = PickupSchema.parse(raw);
  if (String(data.head.status) !== "200" || !data.body.stores.length)
    throw new Error("Apple 库存响应无有效门店");
  const stores = data.body.stores.filter(
    (s) => s.country === undefined || s.country === "HK",
  );
  const observations = productIds.flatMap((productId) =>
    storeIds.map((storeId) => {
      const part = stores.find((s) => s.storeNumber === storeId)
        ?.partsAvailability?.[productId];
      const status =
        part?.pickupDisplay === "available" && part.storePickEligible !== false
          ? "available"
          : part?.pickupDisplay === "unavailable"
            ? "unavailable"
            : "unknown";
      return { productId, storeId, status } as const;
    }),
  );
  return {
    observations,
    stores: stores.map((s) => ({ id: s.storeNumber, name: s.storeName })),
  };
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryAfterMs = 0,
    public statusCode = 0,
  ) {
    super(message);
  }
}
export function providerFailureReason(error: unknown): string {
  if (error instanceof ProviderError && error.statusCode > 0) {
    const retry =
      error.retryAfterMs > 0
        ? `；Retry-After ${Math.ceil(error.retryAfterMs / 1000)} 秒`
        : "";
    return `Apple HTTP ${error.statusCode}${retry}`;
  }
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError")
      return "Apple 请求超时（10 秒）";
    if (error instanceof z.ZodError) return "Apple 库存响应结构不匹配";
    if (error instanceof SyntaxError) return "Apple 返回内容无法解析为 JSON";
    const safeMessages = [
      "Apple 商品目录结构发生变化",
      "Apple 商品目录为空或重复",
      "Apple 库存响应无有效门店",
    ];
    if (safeMessages.includes(error.message)) return error.message;
    const codes: Record<string, string> = {
      ENOTFOUND: "DNS 解析失败",
      EAI_AGAIN: "DNS 解析暂时失败",
      ECONNREFUSED: "连接被拒绝",
      ECONNRESET: "连接被重置",
      ETIMEDOUT: "连接超时",
      UND_ERR_CONNECT_TIMEOUT: "连接超时",
      CERT_HAS_EXPIRED: "TLS 证书过期",
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS 证书验证失败",
    };
    let cause: unknown = error;
    for (
      let depth = 0;
      depth < 3 && cause && typeof cause === "object";
      depth++
    ) {
      const detail = cause as { code?: unknown; cause?: unknown };
      if (typeof detail.code === "string" && codes[detail.code])
        return `Apple 网络错误：${codes[detail.code]}（${detail.code}）`;
      cause = detail.cause;
    }
  }
  return "Apple 请求失败（网络连接或运行环境异常）";
}
export class AppleProvider implements InventoryProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  private async request(url: string) {
    const fetcher = this.fetcher;
    const res = await fetcher(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        accept: "application/json,text/html",
        "user-agent": "Mozilla/5.0 iPhoneDing/1.0",
      },
    });
    if (!res.ok) {
      const value = res.headers.get("retry-after");
      const retry = value
        ? /^\d+$/.test(value)
          ? Number(value) * 1000
          : Math.max(0, Date.parse(value) - Date.now())
        : 0;
      throw new ProviderError(
        `Apple HTTP ${res.status}`,
        Number.isFinite(retry) ? retry : 0,
        res.status,
      );
    }
    return res;
  }
  async catalog() {
    return parseCatalog(await (await this.request(CATALOG_URL)).text());
  }
  async pickup(products: string[], stores: string[]) {
    const url = new URL(PICKUP_URL);
    url.searchParams.set("pl", "true");
    url.searchParams.set("searchNearby", "true");
    url.searchParams.set("store", "R428");
    products.forEach((p, i) => url.searchParams.set(`parts.${i}`, p));
    return parsePickup(
      await (await this.request(url.toString())).json(),
      products,
      stores,
    );
  }
}
