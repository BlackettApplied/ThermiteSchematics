import { realpathSync } from "node:fs";
export const pathText = (text) =>
  text
    .replaceAll("\\", "/")
    .replaceAll("/private/tmp/", "/tmp/")
    .replaceAll("/private/var/", "/var/")
    .toLowerCase();
export function sourceRoots(engineRoots) {
  return engineRoots
    .flatMap((root) => {
      try {
        return [root, realpathSync(root)];
      } catch {
        return [root];
      }
    })
    .map(pathText);
}
export function readsLocalSource(input, engineRoots) {
  const roots = sourceRoots(engineRoots);
  const text = pathText(input);
  if (
    roots.some((root) =>
      new RegExp(
        root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=[/\\s'\";)&\\]]|$)",
      ).test(text),
    )
  )
    return true;
  for (const token of input.match(/(?:[a-zA-Z]:[\\/]|\/)[^\s'";&)]+/g) ?? []) {
    try {
      const path = pathText(realpathSync(token));
      if (roots.some((root) => path === root || path.startsWith(root + "/")))
        return true;
    } catch {}
  }
  return false;
}
