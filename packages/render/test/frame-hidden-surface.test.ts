import { expect, it } from "vitest";
import * as publicApi from "../src/index.js";
it("keeps the compact benchmark and its activation outside the public render entry", () => {
  expect(
    Object.keys(publicApi).filter((k) =>
      /renderCompactBenchmark|useCompactFrame|compactFramePlan|renderPacketWithAdvice|admitFinalBanks/.test(
        k,
      ),
    ),
  ).toEqual([]);
});
