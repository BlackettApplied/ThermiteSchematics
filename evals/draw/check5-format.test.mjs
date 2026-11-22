import { expect, it } from "vitest";
import { elementFixture, portFixture } from "./check5-navigation-fixture.mjs";
import { elementNavigationAudit } from "./element-navigation-oracle.mjs";
import { portNavigationAudit } from "./port-navigation-oracle.mjs";

function multiline() {
  const x = elementFixture();
  for (const [i, t] of x.geometries[1].texts
    .filter((t) => t.element.startsWith("nav-"))
    .entries()) {
    t.navigationAnnotation = "one-printed-annotation";
    t.text = `${i ? "" : "OL1: "}Overload element ${["1/L1–2/T1", "3/L2–4/T2", "5/L3–6/T3"][i]} → 01.${i ? "B1" : "A1"}`;
  }
  return x;
}
const elements = (x) =>
  elementNavigationAudit(x.packet, x.geometries, x.ir, x.request);
const ports = (x) =>
  portNavigationAudit(x.packet, x.geometries, x.ir, x.request);
const problems = (a) => [...a.findings, ...a.failures];
it.each(["NC", "NO"])(
  "CHECK5 a wrapped %s qualifier stays with its contact",
  (state) => {
    const x = elementFixture(),
      g = x.geometries[0];
    const t = g.texts.find((t) => t.element === "nav-aux");
    t.navigationAnnotation = "wrapped-state";
    t.text = `OL1: ${state}`;
    g.texts.push({
      ...t,
      element: "contact-line",
      text: "contact 95–96 → 02.A1",
    });
    expect(problems(elements(x)).length === 0).toBe(state === "NC");
  },
);

it("CHECK5 T6 multiline element locator carries only its printed group header", () => {
  const a = elements(multiline());
  expect(a.obligations).toHaveLength(6);
  expect(problems(a)).toEqual([]);
});
function wrappedElements() {
  const x = multiline(),
    g = x.geometries[1];
  const lines = g.texts.filter((t) => t.element.startsWith("nav-"));
  g.texts = g.texts.filter((t) => !t.element.startsWith("nav-"));
  for (const [i, t] of lines.entries()) {
    const words = t.text.split(" ");
    const fragments = i
      ? [
          words.slice(0, 2).join(" "),
          words.slice(2, -1).join(" "),
          words.at(-1),
        ]
      : [
          "OL1: Overload",
          "element",
          words.slice(3, -1).join(" "),
          words.at(-1),
        ];
    g.texts.push(
      ...fragments.map((text, j) => ({
        ...structuredClone(t),
        text,
        element: `${t.element}-${j}`,
        bbox: { ...t.bbox, y: t.bbox.y + j },
      })),
    );
  }
  return x;
}
it("CHECK5 an element clause can wrap before its arrow and destination", () => {
  expect(problems(elements(wrappedElements()))).toEqual([]);
});
it("CHECK5 a missing wrapped destination cannot borrow the next element's pointer", () => {
  const x = wrappedElements();
  x.geometries[1].texts = x.geometries[1].texts.filter(
    (t) => t.element !== "nav-pole1-3",
  );
  expect(elements(x).findings.some((f) => f.targetFunction === "pole1")).toBe(
    true,
  );
});
it("CHECK5 a missing destination cannot borrow a peer's pointer to the same zone", () => {
  const x = wrappedElements();
  x.geometries[1].texts = x.geometries[1].texts.filter(
    (t) => t.element !== "nav-pole2-2",
  );
  expect(elements(x).findings.some((f) => f.targetFunction === "pole2")).toBe(
    true,
  );
});
it.each(["swapped rows", "wrong header", "different group", "wrong role"])(
  "CHECK5 multiline negative: %s",
  (mutation) => {
    const x = multiline();
    const rows = x.geometries[1].texts.filter((t) =>
      t.element.startsWith("nav-"),
    );
    if (mutation === "swapped rows") {
      rows[0].text = rows[0].text.replace("01.A1", "01.B1");
      rows[1].text = rows[1].text.replace("01.B1", "01.A1");
    } else if (mutation === "wrong header")
      rows[0].text = rows[0].text.replace("OL1:", "OL11:");
    else if (mutation === "different group")
      rows[1].navigationAnnotation = "unrelated";
    else rows[1].text = rows[1].text.replace("Overload", "Coil");
    expect(problems(elements(x)).length).toBeGreaterThan(0);
  },
);
function t6Ports() {
  const x = portFixture();
  for (const g of x.geometries) {
    const refs = g.tranche4.partRefs;
    for (const r of refs)
      r.texts[0].text = r.texts[0].text
        .replace("N05.", "N05 port ")
        .replace(/P\d+\//u, "");
    // Several measured rows in the same continuation container stay clauses.
    if (refs.length > 1) {
      refs[0].texts = refs.flatMap((r) => r.texts);
      g.tranche4.partRefs = [refs[0]];
    }
  }
  return x;
}
it("CHECK5 T6 named port wording needs no redundant physical part prefix", () => {
  expect(problems(ports(t6Ports()))).toEqual([]);
});
it("CHECK5 grouped B1/B2/B3 share a pointer only to their common measured zone", () => {
  const x = t6Ports();
  for (const g of x.geometries.slice(1)) {
    const r = g.tranche4.partRefs[0];
    r.texts = r.texts.filter((t) => !/port B[23]/u.test(t.text));
    r.texts.find((t) => /port B1/u.test(t.text)).text =
      "N05 port B1/B2/B3 → 01.A1";
  }
  expect(problems(ports(x))).toEqual([]);
  x.geometries[1].tranche4.partRefs[0].texts.find((t) =>
    /B1\/B2/u.test(t.text),
  ).text = "N05 port B1/B2/B3 → 01.C3";
  expect(problems(ports(x)).length).toBeGreaterThan(0);
});
it.each(["swap", "missing", "anonymous", "zone", "metadata"])(
  "CHECK5 T6 port negative: %s",
  (mutation) => {
    const x = t6Ports(),
      r = x.geometries[0].tranche4.partRefs[0];
    if (mutation === "swap") r.texts[0].text = "N05 port B1 → S02.C3";
    else if (mutation === "missing") r.texts.shift();
    else if (mutation === "anonymous") r.texts[0].text = "See S02.C3";
    else if (mutation === "zone") r.texts[0].text = "N05 port IN → S02.D5";
    else {
      r.texts = [];
      Object.assign(r, { port: "IN", targetSheets: [2], correct: true });
    }
    expect(problems(ports(x)).length).toBeGreaterThan(0);
  },
);
it("CHECK5 absent port ink reports the native device designation", () => {
  const x = portFixture();
  x.geometries[0].tranche4.partRefs = [];
  expect(ports(x).findings[0].designation).toBe("N05");
});
it("CHECK5 a grouped pointer cannot lend one port's zone to its peers", () => {
  const x = t6Ports(),
    g = x.geometries[1];
  g.tranche4.partRefs[0].texts = [
    { ...g.tranche4.partRefs[0].texts[0], text: "N05 port B1/B2/OUT → 01.A1" },
  ];
  const a = ports(x);
  expect(
    a.findings.filter((f) => f.sheet === 2 && ["B1", "B2"].includes(f.portKey)),
  ).toHaveLength(2);
});
it("CHECK5 an unknown grouped port cannot be silently ignored", () => {
  const x = t6Ports();
  x.geometries[1].tranche4.partRefs[0].texts[0].text =
    "N05 port B1/FAKE → 01.A1";
  expect(problems(ports(x)).length).toBeGreaterThan(0);
});
