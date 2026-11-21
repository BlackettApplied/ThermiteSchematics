import { expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { encodedReportBytes, parseReportBytes } from "./report-file.mjs";
it.each([
  [
    "zero padding",
    () => Buffer.concat([encodedReportBytes({ a: 1 }), Buffer.alloc(8)]),
  ],
  [
    "junk trailer",
    () => Buffer.concat([encodedReportBytes({ a: 1 }), Buffer.from("junk")]),
  ],
  [
    "two members composing valid JSON",
    () => Buffer.concat([gzipSync('{"a":'), gzipSync("1}")]),
  ],
  [
    "empty second member",
    () => Buffer.concat([encodedReportBytes({ a: 1 }), gzipSync("")]),
  ],
])("Gzip report refuses %s", (_name, bytes) =>
  expect(() => parseReportBytes(bytes())).toThrow(),
);
it("Single gzip member with well-formed optional extra/name/comment headers remains accepted", () => {
  const raw = gzipSync('{"a":1}');
  const header = Buffer.from(raw.subarray(0, 10));
  header[3] = 4 | 8 | 16;
  const encoded = Buffer.concat([
    header,
    Buffer.from([2, 0, 1, 2]),
    Buffer.from("report\0note\0"),
    raw.subarray(10),
  ]);
  expect(parseReportBytes(encoded)).toEqual({ a: 1 });
});
