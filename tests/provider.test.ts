import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseCatalog, parsePickup } from "../src/core/apple";
it("parses verified Apple catalog with valid Hong Kong part numbers and exact dimensions", () => {
  const rows = parseCatalog(
    readFileSync("tests/fixtures/catalog.html", "utf8"),
  );
  expect(rows).toHaveLength(32);
  expect(rows[0]).toMatchObject({
    id: "MJY04ZA/A",
    model: "iPhone 18 Pro Max",
    color: "burgundy",
    capacity: "1TB",
  });
  expect(rows[0].url).toContain("6.9-inch-display-1tb-burgundy");
});
it("uses product pickupDisplay rather than general store availability and includes missing pairs as unknown", () => {
  const json = JSON.parse(readFileSync("tests/fixtures/pickup.json", "utf8"));
  const r = parsePickup(json, ["MJY04ZA/A", "MISSING"], ["R428", "R499"]);
  expect(r.observations).toHaveLength(4);
  expect(
    r.observations.find(
      (x) => x.productId === "MJY04ZA/A" && x.storeId === "R428",
    )?.status,
  ).toBe("unavailable");
  expect(r.observations.find((x) => x.productId === "MISSING")?.status).toBe(
    "unknown",
  );
});
it("rejects malformed responses without fabricating an empty successful inventory", () => {
  expect(() => parsePickup({}, ["x"], ["R428"])).toThrow();
});
it("does not bind runtime Fetch to the provider object on Workers", async () => {
  const { AppleProvider } = await import("../src/core/apple");
  const fetcher = async function (this: unknown) {
    if (this !== undefined && this !== globalThis)
      throw new TypeError("Illegal invocation");
    return new Response(readFileSync("tests/fixtures/pickup.json", "utf8"), {
      status: 200,
    });
  };
  const result = await new AppleProvider(fetcher as typeof fetch).pickup(
    ["MJY04ZA/A"],
    ["R428"],
  );
  expect(result.observations[0].status).toBe("unavailable");
});
