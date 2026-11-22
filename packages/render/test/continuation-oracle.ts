import { DOMParser } from "linkedom";
import type { ElectricalIr } from "@thermite/compiler";
import type { RenderedPacket, RenderedSheet } from "../src/sheets.js";

const number = (e: Element, key: string) => Number(e.getAttribute(key));
function zoneAt(sheet: RenderedSheet, x: number, y: number) {
  const root = new DOMParser().parseFromString(
    sheet.svg,
    "image/svg+xml",
  ).documentElement;
  const texts = [...root.children].filter((e) => e.tagName === "text");
  const xs = texts
    .filter((e) => /^[1-6]$/u.test(e.textContent ?? "") && number(e, "y") < 30)
    .sort((a, b) => Number(a.textContent) - Number(b.textContent));
  const ys = texts
    .filter((e) => /^[A-D]$/u.test(e.textContent ?? "") && number(e, "x") < 20)
    .sort((a, b) => (a.textContent ?? "").localeCompare(b.textContent ?? ""));
  if (xs.length !== 6 || ys.length !== 4)
    throw Error("Printed zone grid missing");
  const dx = (number(xs[5]!, "x") - number(xs[0]!, "x")) / 5,
    dy = (number(ys[3]!, "y") - number(ys[0]!, "y")) / 3;
  const col = Math.max(
      0,
      Math.min(5, Math.floor((x - number(xs[0]!, "x") + dx / 2) / dx)),
    ),
    row = Math.max(
      0,
      Math.min(3, Math.floor((y - number(ys[0]!, "y") + dy / 2) / dy)),
    );
  return "ABCD"[row]! + String(col + 1);
}
function authored(ir: ElectricalIr, c: RenderedSheet["continuations"][number]) {
  const p = c.provenance;
  if (!p) throw Error("No source provenance");
  let identity: string, designation: string | undefined;
  if (p.kind === "wire") {
    const w = ir.wires.find((w) => w.uid === p.uid);
    if (!w) throw Error("Unknown source wire");
    identity = w.properties?.label ?? w.designation;
    designation = w.designation;
  } else if (p.kind === "jumper") {
    const j = ir.jumpers.find((j) => j.uid === p.uid);
    if (!j) throw Error("Unknown jumper");
    identity = j.designation ?? "JUMPER";
    designation = j.designation;
  } else {
    const cable = ir.cables.find((c) => c.uid === p.cableUid),
      core = ir.cableConductors.find(
        (c) =>
          c.id.cableUid === p.cableUid && c.id.conductorId === p.conductorId,
      );
    if (!cable || !core) throw Error("Unknown cable core");
    identity = designation = `${cable.designation}.${p.conductorId}`;
  }
  return { identity, designation };
}
/** Reads actual strings and stroke anchors; neither the formatter nor its zone
 * and identity helpers participate in the expected result. */
export function continuationOracle(ir: ElectricalIr, packet: RenderedPacket) {
  const ends = packet.sheets.flatMap((sheet) => {
    const root = new DOMParser().parseFromString(
      sheet.svg,
      "image/svg+xml",
    ).documentElement;
    return [...root.querySelectorAll('a[href^="#sheet-"]')].map((a) => {
      const rows = [...a.querySelectorAll("text")],
        header = rows[0]?.textContent ?? "",
        m = header.match(/^(C\d+) \/ (\d+)\.([A-D][1-6])(?: \/ ([\s\S]*))?$/u);
      if (!m) throw Error(`Incomplete printed caption: ${header}`);
      const path = a.querySelector("path"),
        pt = path?.getAttribute("d")?.match(/^M ([\d.-]+) ([\d.-]+)/u);
      if (!pt) throw Error("No visible connector stroke");
      if (a.parentElement !== root)
        throw Error("Continuation text is unexpectedly scaled/nested");
      for (const t of rows)
        if (number(t, "font-size") < 2.5 || t.hasAttribute("textLength"))
          throw Error("Illegal continuation type");
      const metadata = sheet.continuations.filter(
        (c) =>
          c.id === m[1] &&
          String(c.end) === a.getAttribute("data-continuation-end"),
      );
      if (metadata.length !== 1) throw Error("Ambiguous exported endpoint");
      if (
        rows.some((t) => t.children.length) ||
        rows.slice(1).some((t) => /^C\d+ \/ /u.test(t.textContent ?? ""))
      )
        throw Error(
          "Caption must have one reference row and separate direct-text rows",
        );
      const c = metadata[0]!,
        source = authored(ir, c),
        body =
          m[4] ??
          rows
            .slice(1)
            .map((r) => r.textContent)
            .join("");
      if (
        c.conductor !== source.identity ||
        c.designation !== source.designation ||
        body !== source.identity
      )
        throw Error(`Wrong printed source identity ${body}`);
      const identityRows =
        m[4] !== undefined ? [m[4]] : rows.slice(1).map((r) => r.textContent);
      if (identityRows.length !== 1 || identityRows[0] !== source.identity)
        throw Error("Authored conductor identity is not one line unit");
      const forms = [...root.querySelectorAll('a[href^="#sheet-"]')].map(
        (link) =>
          /^(C\d+) \/ \d+\.[A-D][1-6] \/ /u.test(
            link.querySelector("text")?.textContent ?? "",
          ),
      );
      if (new Set(forms).size > 1) throw Error("Mixed forms within one bank");
      if (body.includes("jumper:")) throw Error("Synthesised jumper name");
      if (Number(a.getAttribute("href")?.slice(7)) !== Number(m[2]))
        throw Error("Href and printed destination differ");
      return {
        sheet,
        id: m[1]!,
        to: Number(m[2]),
        zone: m[3]!,
        x: Number(pt[1]),
        y: Number(pt[2]),
        c,
      };
    });
  });
  for (const e of ends) {
    const peers = ends.filter((z) => z !== e && z.id === e.id);
    if (peers.length !== 1) throw Error(`Not a physical pair: ${e.id}`);
    const z = peers[0]!;
    if (
      e.to !== z.sheet.number ||
      z.to !== e.sheet.number ||
      e.c.conductor !== z.c.conductor ||
      e.c.netId !== z.c.netId
    )
      throw Error("Wrong reciprocal peer");
    const expected = zoneAt(z.sheet, z.x, z.y);
    if (e.zone !== expected || e.c.toZone !== expected)
      throw Error(
        `Wrong printed peer zone ${e.id}: ${e.zone}, expected ${expected}`,
      );
  }
  if (
    ends.length !==
    packet.sheets.reduce((n, s) => n + s.continuations.length, 0)
  )
    throw Error("Lost continuation label");
  return {
    ends: ends.length,
    sameSheet: ends.filter((e) => e.to === e.sheet.number).length,
  };
}
