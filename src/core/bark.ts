import type { BarkMessage } from "./types";
export function validateBarkUrl(value: string) {
  const url = new URL(value);
  // A user-owned Bark server can be added through BARK_ALLOWED_HOSTS, never through browser input.
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.split("/").filter(Boolean).length !== 1
  )
    throw new Error("请输入 HTTPS Bark 设备地址");
  if (
    url.hostname === "localhost" ||
    url.hostname.includes(":") ||
    /^\d+(\.\d+){3}$/.test(url.hostname) ||
    url.hostname.endsWith(".local")
  )
    throw new Error("Bark 地址不能指向本机或内网");
  return url.toString().replace(/\/$/, "");
}
export async function sendBark(
  deviceUrl: string,
  message: BarkMessage,
  fetcher: typeof fetch = fetch,
  allowedHosts: string[] = ["api.day.app"],
) {
  const url = new URL(validateBarkUrl(deviceUrl));
  if (!allowedHosts.includes(url.hostname))
    throw new Error("此 Bark 服务域名未获配置许可");
  const response = await fetcher(`${url.origin}/push`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      device_key: decodeURIComponent(url.pathname.slice(1)),
      title: message.title,
      body: message.body,
      url: message.url,
      group: "iPhone Ding",
      sound: "bell",
    }),
  });
  if (!response.ok) throw new Error(`Bark HTTP ${response.status}`);
  const result = (await response.json()) as { code?: number };
  if (result.code !== 200) throw new Error("Bark 未确认发送成功");
}
