import { expect, it, vi } from "vitest";
import { offViewFixture } from "./off-view-fixtures.js";
import {
  dependencyDraft,
  documentPaper,
  fixtureSheets,
  reportFixture,
  wireNeed,
} from "./document-fixture.js";
import { cachedCircuitView } from "../src/layout/circuit-view-cache.js";
import {
  circuitInlineContext,
  circuitLayoutContext,
} from "../src/layout/circuit-inline-context.js";
import { appendViewDrafts } from "../src/packet/assembly.js";
import { appendDocumentCompanions } from "../src/packet/document-companions.js";
import { finalizeNavigation } from "../src/packet/navigation-finalize.js";
import type { Draft } from "../src/packet/types.js";

it("reuses native document drafts while recomputing companions and final sheet locations", async () => {
  const source = await offViewFixture();
  try {
    const context = circuitLayoutContext();
    const work = vi.fn(async () => ({
      ok: true as const,
      value: [
        dependencyDraft(source.ir, [wireNeed(source.ir)]),
        ...reportFixture(
          source.ir,
          { format: "documentation-view-request/0.1", kind: "wires" },
          [source.ir.wires.find((w) => w.designation === "W1")!.uid],
        ),
      ],
    }));
    const compose = (incoming: Draft[], prefix: boolean) => {
      const drafts = prefix ? [dependencyDraft(source.ir)] : [];
      appendViewDrafts(drafts, incoming, 1, "standard", 0, undefined, {
        key: "cached-document-view",
        authoredOrder: 1,
      });
      const closed = appendDocumentCompanions(
        source.ir,
        drafts,
        documentPaper(),
      );
      if (!closed.ok) throw Error(JSON.stringify(closed.error));
      const final = finalizeNavigation(
        source.ir,
        closed.value,
        fixtureSheets(source.ir, closed.value),
        {
          page: documentPaper(),
          documents: { presentation: undefined, standalone: false },
        },
      );
      if (!final.ok) throw Error(JSON.stringify(final.error));
      return final.value;
    };
    await circuitInlineContext.run(context, async () => {
      const original = await cachedCircuitView(source.ir, undefined, [], work);
      if (!original.ok) throw Error("Expected native drafts");
      const pristine = structuredClone(original.value);
      const before = structuredClone(compose(original.value, true));
      expect(before.navigation.autoDocuments).toHaveLength(1);
      expect(before.navigation.autoDocuments![0]!.sheets).toEqual([4]);
      expect(before.navigation.dependencies![0]!.caption!.text).toContain(
        "04.A4",
      );
      // Mutations of nested NAV3 fields must not reach the private saved draft.
      original.value[0]!.documentNeeds![0]!.requiredFacts[0]!.kind =
        "terminal-inventory";
      original.value[1]!.issuedDocument!.id = "poisoned";
      original.value[1]!.documentRows![0]!.cells = ["poisoned"];
      original.value[1]!.documentHeader!.cells = ["poisoned"];
      context.qualityPhase = true;
      const reused = await cachedCircuitView(source.ir, undefined, [], work);
      if (!reused.ok) throw Error("Expected reused drafts");
      expect(reused.value).toEqual(pristine);
      const after = compose(reused.value, false);
      expect(after.navigation.autoDocuments![0]!.sheets).toEqual([3]);
      expect(after.navigation.dependencies![0]!.caption!.text).toContain(
        "03.A4",
      );
      const beforeRow = before.navigation.documents!.find((d) => d.autoOrigin)!
        .rows[0]!;
      const afterRow = after.navigation.documents!.find((d) => d.autoOrigin)!
        .rows[0]!;
      expect(afterRow.facts).toEqual(beforeRow.facts);
      expect(afterRow.sheet).toBe(beforeRow.sheet - 1);
      expect(afterRow.primitiveId).toBe(
        beforeRow.primitiveId.replace("sheet-4-", "sheet-3-"),
      );
      expect(work).toHaveBeenCalledTimes(1);
      // A later composition also gets untouched drafts, including document IDs.
      const again = await cachedCircuitView(source.ir, undefined, [], work);
      if (!again.ok) throw Error("Expected reused drafts");
      expect(again.value).toEqual(pristine);
      expect(compose(again.value, true)).toEqual(before);
      expect(work).toHaveBeenCalledTimes(1);
    });
  } finally {
    await source.dispose();
  }
});
