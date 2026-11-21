import { createTerminalIr } from "../../query/test/fixtures.js";
export function longStrip() {
  const keys = Array.from({ length: 48 }, (_, i) => `T${48 - i}`);
  const ir = createTerminalIr([
    { uid: "native-strip", designation: "XT-LONG", terminalKeys: keys },
  ]);
  ir.deviceTypes[0]!.terminalOrder = keys;
  const source = ir.devices[0]!.source;
  ir.jumpers = [
    {
      uid: "native-cross-sheet-jumper",
      designation: "J-CROSS",
      aliases: [],
      source,
      endpoints: [
        {
          terminal: { deviceUid: "native-strip", terminalKey: keys[0]! },
          source,
        },
        {
          terminal: { deviceUid: "native-strip", terminalKey: keys.at(-1)! },
          source,
        },
      ],
    },
  ];
  return { ir, keys };
}
