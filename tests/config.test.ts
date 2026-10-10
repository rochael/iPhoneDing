import { afterEach, expect, it, vi } from "vitest";
import { nodeConfig } from "../src/adapters/node-config";

afterEach(() => vi.unstubAllEnvs());
function environment(secure = true) {
  vi.stubEnv("ADMIN_PASSWORD", "config-test-password");
  vi.stubEnv(
    "SESSION_SECRET",
    "config-test-secret-with-at-least-32-characters",
  );
  vi.stubEnv("COOKIE_SECURE", String(secure));
  vi.stubEnv("DOMAIN", "iphone.phper.dev");
  vi.stubEnv("PUBLIC_ORIGIN", undefined);
}
it("uses the configured HTTPS domain for production origin checks", () => {
  environment();
  expect(nodeConfig().publicOrigin).toBe("https://iphone.phper.dev");
});
it("keeps local development on the request origin despite an example domain", () => {
  environment(false);
  expect(nodeConfig().publicOrigin).toBeUndefined();
});
it("allows an explicit public origin and validates it at startup", () => {
  environment();
  vi.stubEnv("PUBLIC_ORIGIN", " https://alternate.example:8443 ");
  expect(nodeConfig().publicOrigin).toBe("https://alternate.example:8443");
  vi.stubEnv("PUBLIC_ORIGIN", "https://alternate.example/path");
  expect(() => nodeConfig()).toThrow(/PUBLIC_ORIGIN/);
});
