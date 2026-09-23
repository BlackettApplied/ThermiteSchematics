import { describe, expect, it } from "vitest";
import {
  assertReleaseManifest,
  selectRuntimeAssets,
} from "../../../scripts/runtime-package/release-download.mjs";

const commit = "a".repeat(40);
const target = "linux-x64";
const archive = `thermite-0.3.0-alpha.2-${target}-bun-${commit.slice(0, 8)}.zip`;
const manifest = {
  version: "0.3.0-alpha.2",
  preview: false,
  commit,
  target,
  sourceUrl: `https://github.com/BlackettApplied/ThermiteSchematics/tree/${commit}`,
};

describe("published runtime download selection", () => {
  it("selects the single clean target archive and checksum among other release assets", () => {
    expect(
      selectRuntimeAssets(
        [
          archive,
          `${archive}.sha256`,
          `${archive}.json`,
          `thermite-0.3.0-alpha.2-win32-x64-bun-aaaaaaaa.zip`,
          "thermite-0.3.0-alpha.2-source-aaaaaaaa.zip",
          "verification-linux-x64.json",
        ],
        target,
      ),
    ).toEqual([archive, `${archive}.sha256`]);
  });

  it("refuses absent, preview-only, ambiguous or unpaired archives", () => {
    const alternate = archive.replace("aaaaaaaa", "bbbbbbbb");
    for (const names of [
      [],
      [archive.replace("bun-", "bun-preview-")],
      [archive],
      [archive, `${archive}.sha256`, alternate, `${alternate}.sha256`],
      [archive, `${archive}.sha256`, `${archive}.sha256`],
    ])
      expect(() => selectRuntimeAssets(names, target)).toThrow();
    expect(() =>
      selectRuntimeAssets([archive, `${archive}.sha256`], "unknown"),
    ).toThrow(/Unknown runtime target/);
  });

  it("requires the exact tag commit and target before consumer execution", () => {
    expect(() =>
      assertReleaseManifest(manifest, archive, target, commit),
    ).not.toThrow();
    expect(() =>
      assertReleaseManifest(manifest, archive, target, "a".repeat(39) + "b"),
    ).toThrow(/checked-out tag commit/);
    expect(() =>
      assertReleaseManifest(manifest, archive, "win32-x64", commit),
    ).toThrow(/requested target/);
    expect(() =>
      assertReleaseManifest(
        { ...manifest, preview: true },
        archive,
        target,
        commit,
      ),
    ).toThrow(/must not be a preview/);
    expect(() =>
      assertReleaseManifest(manifest, archive, target, "aaaaaaaa"),
    ).toThrow(/full release-tag commit/);
    expect(() =>
      assertReleaseManifest(
        { ...manifest, sourceUrl: "https://example.com/unrelated" },
        archive,
        target,
        commit,
      ),
    ).toThrow(/source URL/);
    expect(() =>
      assertReleaseManifest(
        manifest,
        archive.replace("aaaaaaaa", "bbbbbbbb"),
        target,
        commit,
      ),
    ).toThrow(/archive identity/);
  });
});
