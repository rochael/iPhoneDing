import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { secureHeaders } from "hono/secure-headers";
import { createApi } from "../api/app";
import { nodeRepository } from "./node-db";
import { nodeConfig } from "./node-config";
import { Monitor } from "../core/monitor";
const repo = nodeRepository(),
  config = nodeConfig();
await new Monitor(repo).initialize();
const app = createApi(() => ({ repo, config }));
app.use("*", secureHeaders());
app.use("*", serveStatic({ root: "dist/web" }));
app.get("*", serveStatic({ path: "dist/web/index.html" }));
const server = serve(
  {
    fetch: app.fetch,
    port: Number(process.env.PORT ?? 3000),
    hostname: process.env.HOST ?? "127.0.0.1",
  },
  (info) => console.log(`iPhone Ding: http://${info.address}:${info.port}`),
);
function shutdown() {
  server.close(() => {
    repo.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
