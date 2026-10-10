import { nodeRepository } from "./node-db";
import { nodeConfig } from "./node-config";
import { Monitor } from "../core/monitor";
import { nextWakeAt } from "../core/domain";
import { sendBark } from "../core/bark";
const repo = nodeRepository(),
  config = nodeConfig();
const monitor = new Monitor(repo, undefined, (url, message) =>
  sendBark(url, message, fetch, config.barkAllowedHosts),
);
let stopped = false;
let timer: ReturnType<typeof setTimeout> | undefined;
async function run() {
  try {
    await monitor.tick();
  } catch {
    console.error("监控轮次失败，30 秒后重试；请检查数据库和网络。");
  }
  if (stopped) {
    repo.close();
    return;
  }
  const status = await repo.status(),
    now = Date.now();
  timer = setTimeout(
    run,
    nextWakeAt(status, await repo.nextDeliveryAt(), now) - now,
  );
}
function shutdown() {
  stopped = true;
  if (timer) {
    clearTimeout(timer);
    repo.close();
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await run();
