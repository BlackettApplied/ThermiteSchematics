// Explicit browser-required network isolation acceptance, outside the unit suite.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { launch, drawingContextOptions } from "./browser.mjs";
const requests = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end("ok");
});
server.on("upgrade", (req, socket) => {
  requests.push(req.url);
  socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const html = `<link rel="prefetch" href="${base}/prefetch"><script>navigator.sendBeacon('${base}/beacon','x');new WebSocket('${base.replace("http:", "ws:")}/socket');window.executed=true;</script>`;
const browser = await launch();
try {
  const control = await browser.newContext({
    ...drawingContextOptions,
    offline: false,
    javaScriptEnabled: true,
  });
  const p = await control.newPage();
  await p.setContent(html);
  await new Promise((r) => setTimeout(r, 1200));
  for (const name of ["/prefetch", "/beacon", "/socket"])
    assert(requests.includes(name), "Positive network control missing " + name);
  await control.close();
  requests.length = 0;
  const c = await browser.newContext({
      ...drawingContextOptions,
      javaScriptEnabled: true,
    }),
    q = await c.newPage();
  await q.setContent(html);
  await new Promise((r) => setTimeout(r, 1200));
  assert.deepEqual(requests, [], "Offline capture leaked external requests");
  await c.close();
  const production = await browser.newContext(drawingContextOptions),
    r = await production.newPage();
  await r.setContent(html);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(
    await r.evaluate(() => window.executed),
    undefined,
    "Source scripts executed",
  );
  assert.deepEqual(requests, []);
  process.stdout.write(
    "Network control: beacon, prefetch, WebSocket observed. Isolated capture: 0 requests; source scripts disabled.\n",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
