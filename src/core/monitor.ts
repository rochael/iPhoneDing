import { Repository } from "../db/repository";
import { AppleProvider, ProviderError, providerFailureReason } from "./apple";
import { sendBark } from "./bark";
import { transition, retryDelay, hkDate, hkTime } from "./domain";
import type { InventoryProvider, Observation, BarkMessage } from "./types";
import seed from "../db/catalog.json";
export class Monitor {
  private busy = false;
  constructor(
    private repo: Repository,
    private provider: InventoryProvider = new AppleProvider(),
    private sender: (url: string, m: BarkMessage) => Promise<void> = sendBark,
    private clock: () => number = Date.now,
  ) {}
  async initialize() {
    if (
      (await this.repo.setting("maintenanceMode")) === "true" ||
      (await this.repo.setting("importInProgress")) === "true"
    )
      return;
    if (!(await this.repo.catalog()).products.length)
      await this.repo.saveCatalog(seed.products, seed.stores, 0);
  }
  async tick(roundId = `round-${Math.floor(this.clock() / 30_000)}`) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (
        (await this.repo.setting("importInProgress")) === "true" ||
        (await this.repo.setting("maintenanceMode")) === "true"
      )
        return;
      await this.initialize();
      await this.deliver();
      const now = this.clock(),
        status = await this.repo.status();
      if (
        !status.enabled ||
        status.nextAt > now ||
        !(await this.repo.acquire(roundId, now))
      )
        return;
      try {
        if (!status.catalogAt || now - status.catalogAt > 86400000) {
          await this.repo.saveCatalog(await this.provider.catalog(), [], now);
        }
        const catalog = await this.repo.catalog(),
          products = catalog.products.filter((p) => p.active),
          storeIds = catalog.stores.map((s) => s.id);
        const observations: Observation[] = [];
        const discoveredStores = new Map<
          string,
          { id: string; name: string }
        >();
        const chunks: string[][] = [];
        for (let i = 0; i < products.length; i += 8)
          chunks.push(products.slice(i, i + 8).map((p) => p.id));
        let cursor = 0,
          retryAfter = 0,
          errors = 0,
          halted = false;
        const failureReasons = new Set<string>();
        const work = async () => {
          while (cursor < chunks.length && !halted) {
            const group = chunks[cursor++];
            try {
              const result = await this.provider.pickup(group, storeIds);
              observations.push(...result.observations);
              for (const store of result.stores)
                discoveredStores.set(store.id, store);
            } catch (error) {
              errors++;
              failureReasons.add(providerFailureReason(error));
              if (error instanceof ProviderError) {
                retryAfter = Math.max(retryAfter, error.retryAfterMs);
                if (error.retryAfterMs > 0 || error.statusCode === 429)
                  halted = true;
              }
              observations.push(
                ...group.flatMap((productId) =>
                  storeIds.map((storeId) => ({
                    productId,
                    storeId,
                    status: "unknown" as const,
                  })),
                ),
              );
            }
          }
        };
        await Promise.all([work(), work()]);
        for (const group of chunks.slice(cursor))
          observations.push(
            ...group.flatMap((productId) =>
              storeIds.map((storeId) => ({
                productId,
                storeId,
                status: "unknown" as const,
              })),
            ),
          );
        const changedStores = [...discoveredStores.values()].filter(
          (s) =>
            !catalog.stores.some((x) => x.id === s.id && x.name === s.name),
        );
        if (changedStores.length)
          await this.repo.saveCatalog([], changedStores, now);
        const at = this.clock(),
          known = observations.filter((o) => o.status !== "unknown").length;
        const old = new Map(
          (await this.repo.stock()).map((s) => [
            `${s.productId}|${s.storeId}`,
            s,
          ]),
        );
        const watches = (await this.repo.watches()).filter((w) => w.enabled);
        const alerts = observations.filter((o) => {
          const s = old.get(`${o.productId}|${o.storeId}`);
          const t = transition(
            s?.confirmed && s.checkedAt !== null
              ? { status: s.confirmed, checkedAt: s.checkedAt }
              : undefined,
            o.status,
            at,
          );
          return (
            t.notify &&
            watches.some(
              (w) =>
                w.productIds.includes(o.productId) &&
                w.storeIds.includes(o.storeId),
            )
          );
        });
        const messages: BarkMessage[] = alerts.length
          ? [
              {
                title: `iPhone 到货 · ${alerts.length} 个门店规格`,
                body:
                  alerts
                    .map((o) => {
                      const p = products.find((p) => p.id === o.productId)!;
                      return `${p.model} ${p.color} ${p.capacity} · ${catalog.stores.find((s) => s.id === o.storeId)?.name ?? o.storeId}`;
                    })
                    .join("\n") + `\n${hkDate(at)} ${hkTime(at)}（香港时间）`,
                url: products.find((p) => p.id === alerts[0].productId)!.url,
              },
            ]
          : [];
        const partial = known < observations.length,
          failures = partial ? status.failures + 1 : 0;
        const next = {
          ...status,
          lastAttemptAt: at,
          lastSuccessAt: known > 0 ? at : status.lastSuccessAt,
          failures,
          error: partial
            ? `本轮 ${observations.length - known}/${observations.length} 个门店规格未获取有效库存${errors ? `（请求失败）：${[...failureReasons].join("；")}` : "（响应缺少有效库存字段）"}`
            : null,
          nextAt: at + (partial ? retryDelay(failures, retryAfter) : 30000),
        };
        await this.repo.commitRound(roundId, observations, at, messages, next);
        await this.deliver();
        if (
          now - Number((await this.repo.setting("prunedAt")) ?? 0) >
          86400000
        ) {
          await this.repo.prune(now);
          await this.repo.setSetting("prunedAt", String(now));
        }
      } catch (error) {
        const at = this.clock(),
          failures = status.failures + 1;
        // Do not log remote bodies, credentials or arbitrary exception messages.
        const message =
          error instanceof ProviderError
            ? providerFailureReason(error)
            : "采集失败：网络、目录解析或数据库异常";
        await this.repo.abandon(
          roundId,
          {
            ...status,
            lastAttemptAt: at,
            failures,
            error: message,
            nextAt:
              at +
              retryDelay(
                failures,
                error instanceof ProviderError ? error.retryAfterMs : 0,
              ),
          },
          at,
        );
      }
    } finally {
      this.busy = false;
    }
  }
  async deliver() {
    if (
      (await this.repo.setting("maintenanceMode")) === "true" ||
      (await this.repo.setting("importInProgress")) === "true"
    )
      return;
    const url = await this.repo.setting("barkUrl");
    for (const n of await this.repo.pending(this.clock())) {
      const now = this.clock();
      if (now - n.createdAt > 300000) {
        await this.repo.updateNotification({ ...n, status: "expired" });
        continue;
      }
      if (!url) continue;
      if (n.attempts >= 4) {
        await this.repo.updateNotification({ ...n, status: "failed" });
        continue;
      }
      if (!(await this.repo.claimNotification(n.id, now))) continue;
      const attempts = n.attempts + 1;
      try {
        await this.sender(url, n.message);
        await this.repo.updateNotification({ ...n, attempts, status: "sent" });
      } catch {
        await this.repo.updateNotification({
          ...n,
          attempts,
          status: attempts >= 4 ? "failed" : "pending",
          nextAt:
            this.clock() + [0, 30000, 60000, 120000][Math.min(attempts, 3)],
        });
      }
    }
  }
}
