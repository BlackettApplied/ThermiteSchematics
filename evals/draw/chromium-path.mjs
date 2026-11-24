import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
export async function browserPath() {
  if (process.env.THERMITE_DRAW_CHROMIUM) {
    try {
      await access(process.env.THERMITE_DRAW_CHROMIUM);
    } catch {
      throw Error(
        `Drawing eval infrastructure: THERMITE_DRAW_CHROMIUM does not name an accessible executable: ${process.env.THERMITE_DRAW_CHROMIUM}. Set it to an installed Chromium executable or run bunx playwright-core install chromium. No checks were skipped.`,
      );
    }
    return process.env.THERMITE_DRAW_CHROMIUM;
  }
  const roots =
    process.platform === "darwin"
      ? [join(homedir(), "Library/Caches/ms-playwright")]
      : [join(homedir(), ".cache/ms-playwright")];
  for (const root of roots) {
    let entries = [];
    try {
      entries = await readdir(root);
    } catch {}
    for (const e of entries
      .filter((x) => /^chromium-/.test(x))
      .sort()
      .reverse())
      for (const suffix of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "chrome-linux64/chrome",
        "chrome-linux-arm64/chrome",
        "chrome-linux/chrome",
        "chrome-win/chrome.exe",
      ]) {
        const path = join(root, e, suffix);
        try {
          await access(path);
          return path;
        } catch {}
      }
  }
  throw Error(
    "Drawing eval infrastructure: Chromium missing. Install the local Chromium build with bunx playwright-core install chromium, or set THERMITE_DRAW_CHROMIUM to its executable. No checks were skipped.",
  );
}
