import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { offViewFixture } from "./off-view-fixtures.js";
import {
  dependencyDraft,
  wireNeed,
  documentPaper,
} from "./document-fixture.js";
import * as reports from "../src/packet/reports.js";
import { appendDocumentCompanions } from "../src/packet/document-companions.js";
let source: Awaited<ReturnType<typeof offViewFixture>>;
beforeAll(async () => {
  source = await offViewFixture();
});
afterAll(async () => {
  await source.dispose();
});
it("refuses insufficient closure after actual report ink is hidden", () => {
  const native = reports.tableDrafts;
  const spy = vi.spyOn(reports, "tableDrafts").mockImplementation((...args) => {
    const result = native(...args);
    if (result.ok)
      for (const d of result.value)
        d.content = `<g display="none">${d.content}</g>`;
    return result;
  });
  try {
    const result = appendDocumentCompanions(
      source.ir,
      [dependencyDraft(source.ir, [wireNeed(source.ir)])],
      documentPaper(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("must refuse");
    expect(result.error.message).toContain("insufficient after closure");
  } finally {
    spy.mockRestore();
  }
});
it("refuses when a report adapter tries to create a recursive promise", () => {
  const native = reports.tableDrafts;
  const spy = vi.spyOn(reports, "tableDrafts").mockImplementation((...args) => {
    const result = native(...args);
    if (result.ok)
      for (const d of result.value) d.documentNeeds = [wireNeed(source.ir)];
    return result;
  });
  try {
    const result = appendDocumentCompanions(
      source.ir,
      [dependencyDraft(source.ir, [wireNeed(source.ir)])],
      documentPaper(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("must refuse");
    expect(result.error.message).toContain("Cyclic");
  } finally {
    spy.mockRestore();
  }
});
