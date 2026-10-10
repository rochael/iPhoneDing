import "./load-env";
import { validateConfig } from "../api/app";
export function nodeConfig() {
  const config = {
    adminPassword: process.env.ADMIN_PASSWORD ?? "",
    sessionSecret: process.env.SESSION_SECRET ?? "",
    secureCookie: process.env.COOKIE_SECURE !== "false",
    barkAllowedHosts: (process.env.BARK_ALLOWED_HOSTS ?? "api.day.app")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  validateConfig(config);
  return config;
}
