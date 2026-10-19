import { test, expect } from "bun:test";
import { limitedJson } from "../src/lib/server/proxy-security";
test("proxy rejects oversized streamed, malformed and non-object JSON", async () => {
  const request = (body: string, type = "application/json") =>
    new Request("https://example.test", {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
  expect(await limitedJson(request('{"ok":true}'))).toEqual({ ok: true });
  await expect(limitedJson(request("{"))).rejects.toMatchObject({
    status: 400,
  });
  await expect(limitedJson(request("[]"))).rejects.toMatchObject({
    status: 400,
  });
  await expect(limitedJson(request("{}", "text/plain"))).rejects.toMatchObject({
    status: 415,
  });
  await expect(
    limitedJson(request(JSON.stringify({ value: "a".repeat(65536) }))),
  ).rejects.toMatchObject({ status: 413 });
});
