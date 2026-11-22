// Freeze a reviewed dev measurement capture, not current renderer output.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "prettier";
const i = process.argv.indexOf("--input");
if (i < 0 || !process.argv.includes("--write"))
  throw Error("Use --input <reviewed-dev-capture-directory> --write");
const input = resolve(process.argv[i + 1]),
  measurements = JSON.parse(
    await readFile(resolve(input, "distances.json"), "utf8"),
  ),
  capture = JSON.parse(await readFile(resolve(input, "capture.json"), "utf8"));
if (capture.length !== 50 || measurements.length !== 50)
  throw Error("Expected the reviewed 50-request set");
const data = {
  format: "printable-label-baseline/1.0",
  base: "d7f10b3439540b88a4546b1f754c44b763029b44",
  measurement:
    "Dev Chromium ink at 300 dpi, original forced widths; distances in layout units, before stroke subtraction.",
  cases: capture.map((c, i) => ({
    key: c.key,
    project: c.project,
    request: c.request,
    ...(c.error
      ? { error: c.error.code }
      : {
          facts: Object.fromEntries(
            measurements[i].labels.map((l) => {
              const label = c.layout.labels.find((x) => x.id === l.id),
                edge = c.graph.edges.find((x) => x.id === label.ownerId);
              return [
                l.id,
                { role: label.role, text: label.text, netId: edge.netId },
              ];
            }),
          ),
          distances: Object.fromEntries(
            measurements[i].labels.map((l) => [l.id, l.distance]),
          ),
        }),
  })),
};
await writeFile(
  new URL(
    "../packages/render/test/printable-anchor-baseline.json",
    import.meta.url,
  ),
  await format(JSON.stringify(data), { parser: "json" }),
);
console.log(
  JSON.stringify({
    cases: data.cases.length,
    labels: data.cases.reduce(
      (n, c) => n + Object.keys(c.distances ?? {}).length,
      0,
    ),
  }),
);
