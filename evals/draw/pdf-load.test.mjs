import { expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  version: "6.5.438",
  getDocument: fake.getDocument,
}));
import { loadPdfBytes } from "./pdf.mjs";
it("loads a private copy of the provided bytes with system fonts, eval and all resource fetches disabled", async () => {
  fake.getDocument.mockReturnValue({ promise: Promise.resolve({}) });
  const bytes = Buffer.from("%PDF-fixture");
  await loadPdfBytes(bytes);
  const options = fake.getDocument.mock.calls.at(-1)[0];
  expect(options.data).toEqual(new Uint8Array(bytes));
  expect(options.useSystemFonts).toBe(false);
  expect(options.isEvalSupported).toBe(false);
  expect(options.useWorkerFetch).toBe(false);
  bytes.fill(0);
  expect(Buffer.from(options.data).toString()).toBe("%PDF-fixture");
  const resources = new options.BinaryDataFactory();
  await expect(
    resources.fetch({
      kind: "standardFontDataUrl",
      filename: "https://invalid/font",
    }),
  ).rejects.toThrow(/External PDF resources/);
});
it("resource requests remain fatal even if pdf.js catches a fetch rejection", async () => {
  fake.getDocument.mockImplementation((options) => {
    const resources = new options.BinaryDataFactory();
    return { promise: resources.fetch({ kind: "cMapUrl" }).catch(() => ({})) };
  });
  const doc = await loadPdfBytes(Buffer.from("%PDF-fixture"));
  expect(() => doc.assertNoExternalResources()).toThrow(
    /External PDF resources/,
  );
});
