import { DOMParser } from "linkedom";

function urlTargets(value: string) {
  return [
    ...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/giu),
  ].flatMap((m) => {
    const target = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    return target.startsWith("#") ? [target.slice(1)] : [];
  });
}
function localReferences(element: Element) {
  const refs: { attribute: string; target: string }[] = [];
  for (const attr of [...element.attributes]) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("data-") || name.startsWith("aria-")) continue;
    const value = attr.value.trim();
    if (["href", "xlink:href"].includes(name) && value.startsWith("#"))
      refs.push({ attribute: name, target: value.slice(1) });
    for (const target of urlTargets(value))
      refs.push({ attribute: name, target });
  }
  if (element.localName === "style")
    for (const target of urlTargets(element.textContent ?? ""))
      refs.push({ attribute: "style text", target });
  return refs;
}

/** Inspect real composed SVG scopes, not a list of attributes the scoper rewrites.
 * Every local resource must resolve within its owning side/section namespace.
 * Packet navigation outside the nested drawing SVG remains intentionally global. */
export function scopedReferenceOracle(svg: string) {
  const root = new DOMParser().parseFromString(
    svg,
    "image/svg+xml",
  ).documentElement;
  let sections = 0,
    references = 0;
  for (const section of root.querySelectorAll(
    "svg[data-layout-config-version]",
  )) {
    const wrapper = section.parentElement;
    if (
      wrapper?.localName !== "g" ||
      !/^translate\(/u.test(wrapper.getAttribute("transform") ?? "")
    )
      continue;
    sections++;
    const elements = [section, ...section.querySelectorAll("*")];
    const ids = elements
      .map((e) => e.getAttribute("id"))
      .filter((id) => id !== null);
    const prefix = ids[0]?.match(/^(?:sheet-\d+-)?(?:side|section)-\d+-/u)?.[0];
    if (ids.length && !prefix) throw Error(`Unscoped composed ID: ${ids[0]}`);
    if (new Set(ids).size !== ids.length) throw Error("Duplicate composed ID");
    for (const id of ids)
      if (!prefix || !id.startsWith(prefix))
        throw Error(`Foreign composed ID: ${id}`);
    const targets = new Set(ids);
    for (const element of elements)
      for (const ref of localReferences(element)) {
        references++;
        if (
          !prefix ||
          !ref.target.startsWith(prefix) ||
          !targets.has(ref.target)
        )
          throw Error(
            `Unscoped local reference ${ref.attribute}="#${ref.target}" in ${prefix ?? "an unscoped section"}`,
          );
      }
  }
  return { sections, references };
}
