import { offViewFixture, required } from "./off-view-fixtures.js";

export const literalNumber = 'LS1-RETURN-PLC1-DI0 Åe\u0301 Ω  <&"';
export function continuationFixture(jumpers = false, label = literalNumber) {
  return offViewFixture((objects) => {
    required(objects.find((o) => o.designation === "W1")).endpoints[1] = {
      device: "S1",
      terminal: "11",
    };
    for (let n = 1; n <= 8; n++) {
      const uid = (offset: number) =>
        `15400000-0000-4000-8000-${String(offset + n).padStart(12, "0")}`;
      objects.push({
        kind: "device",
        uid: uid(100),
        designation: `S${n}`,
        type: "core:pushbutton-nc",
      });
      objects.push({
        kind: jumpers ? "jumper" : "wire",
        uid: uid(200),
        ...(jumpers ? {} : { designation: `WS${n}`, properties: { label } }),
        endpoints: [
          { device: `S${n}`, terminal: "12" },
          n === 8
            ? { device: "K1", terminal: "A1" }
            : { device: `S${n + 1}`, terminal: "11" },
        ],
      });
    }
  });
}
