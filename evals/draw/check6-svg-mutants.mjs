import { parseHTML } from "linkedom";

export function mutatePortSvg(svg, obligation, kind) {
  const document = parseHTML(svg).document;
  const group = [
    ...document.querySelectorAll("[data-communication-continuation-device]"),
  ].find(
    (e) =>
      e.getAttribute("data-communication-continuation-device") ===
      obligation.deviceUid,
  );
  if (!group) throw Error("Fixture native reference group missing");
  const node = [...group.querySelectorAll("text")].find((t) =>
    /\bIN\b/u.test(t.textContent),
  );
  if (!node) throw Error("Fixture printed IN clause missing");
  if (kind === "swap")
    node.textContent = node.textContent.replace(/\bIN\b/u, "B1");
  else if (kind === "missing") node.remove();
  else if (kind === "anonymous")
    node.textContent = `See ${String(obligation.targetSheet).padStart(2, "0")}.${obligation.allowedZones[0]}`;
  else if (kind === "wrong zone")
    node.textContent = node.textContent.replace(/\.[A-D][1-6]\b/gu, ".Z9");
  else if (kind === "metadata-only") {
    group.setAttribute("data-correct", "true");
    group.setAttribute("data-port", "IN");
    group.setAttribute(
      "data-destination-sheets",
      JSON.stringify([obligation.targetSheet]),
    );
    node.remove();
  } else if (kind === "borrowing")
    node.textContent = node.textContent.replace(/\bIN\b/u, "IN/OUT");
  else if (kind === "stale sheet")
    node.textContent = node.textContent.replace(
      /(S?)(\d+)\.([A-D][1-6])\b/gu,
      (_, p, n, z) => `${p}${String(Number(n) + 1).padStart(2, "0")}.${z}`,
    );
  else throw Error("Unknown SVG mutation");
  return document.querySelector("svg").outerHTML;
}

export function mutateElementSvg(svg, kind) {
  const document = parseHTML(svg).document;
  const groups = [
    ...document.querySelectorAll("[data-navigation-role]"),
  ].filter((e) => /OL1/u.test(e.textContent) && /→/u.test(e.textContent));
  if (!groups.length) throw Error("Fixture printed OL1 locator missing");
  for (const group of groups) {
    if (kind === "missing")
      group.querySelectorAll("text").forEach((t) => t.remove());
    else if (kind === "metadata-only") {
      group.setAttribute("data-correct", "true");
      group.setAttribute("data-target-sheet", "2");
      group.querySelectorAll("text").forEach((t) => t.remove());
    } else if (kind === "stale sheet") {
      for (const t of group.querySelectorAll("text"))
        t.textContent = t.textContent.replace(
          /(S?)(\d+)\.([A-D][1-6])\b/gu,
          (_, p, n, z) => `${p}${String(Number(n) + 1).padStart(2, "0")}.${z}`,
        );
    } else throw Error("Unknown SVG mutation");
  }
  return document.querySelector("svg").outerHTML;
}
