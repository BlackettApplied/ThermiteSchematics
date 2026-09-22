import { escapeXmlText } from "../svg/escape.js";
/** Native primitives for field-wiring views; electrical identity stays in the IR. */
export function fieldDeviceBody(
  symbol: string,
  width: number,
  height: number,
  instrumentX = width / 2,
): string {
  const rectangle = `<rect width="${width}" height="${height}" rx="1" fill="white" stroke="#344054" stroke-width="0.35"/>`;
  if (symbol !== "thermite:pressure-transmitter") return rectangle;
  // Pressure-to-current instrument mark. This is a functional symbol, not a
  // connector face view or a claim of a particular instrument standard.
  return (
    rectangle +
    `<circle cx="${instrumentX}" cy="14" r="8" fill="#f4f7fa" stroke="#344054" stroke-width="0.4"/>
<path d="M ${instrumentX - 7.5} 14 H ${instrumentX + 7.5}" fill="none" stroke="#344054" stroke-width="0.3"/>
<text x="${instrumentX}" y="12.5" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="3.2">P</text>
<text x="${instrumentX}" y="19" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="3.2">I</text>`
  );
}

/** A grouped connector contact interface, never a conductive junction. */
export function connectorPort(
  x: number,
  y: number,
  vertical: boolean,
  side: "in" | "out",
  label: string,
): string {
  const n = (value: number) => String(Number(value.toFixed(3)));
  return `<g data-connector-interface="assembly"><rect x="${n(x - (vertical ? 4 : 2))}" y="${n(y - (vertical ? 2 : 4))}" width="${vertical ? 8 : 4}" height="${vertical ? 4 : 8}" rx="0.8" fill="#eaf0f5" stroke="#23566d" stroke-width="0.5"/>
<text x="${n(vertical ? x : x + (side === "in" ? 4 : -4))}" y="${n(vertical ? y + (side === "in" ? 7 : -4) : y + 1)}" text-anchor="${vertical ? "middle" : side === "in" ? "start" : "end"}" font-family="Arial, Helvetica, sans-serif" font-size="2.7" fill="#18212b">${escapeXmlText(label)}</text></g>`;
}
