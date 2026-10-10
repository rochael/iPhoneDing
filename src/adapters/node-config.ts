import "./load-env";
import { validateConfig } from "../api/app";
export function nodeConfig() {
  const secureCookie = process.env.COOKIE_SECURE !== "false";
  const config = {
    adminPassword: process.env.ADMIN_PASSWORD ?? "",
    sessionSecret: process.env.SESSION_SECRET ?? "",
    secureCookie,
    publicOrigin:
      process.env.PUBLIC_ORIGIN?.trim() ||
      (secureCookie && process.env.DOMAIN
        ? `https://${process.env.DOMAIN.trim()}`
        : undefined),
    barkAllowedHosts: (process.env.BARK_ALLOWED_HOSTS ?? "api.day.app")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
  validateConfig(config);
  return config;
}
