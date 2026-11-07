## Deliverable format

Use the already initialized project and supplied launcher; the historical path is provenance only. Save views in drawings/ (motor-power.pdf, contactor-actuation.pdf, ps1-loads.pdf); packet.request.json and generated drawings/packet.{json,html,pdf}; drawings/<kind>.csv reports; drawings/{diagnostics,cable,before,review}.json; friction.md. Final deliverables must reflect the final sources: after the guarded change, regenerate every final output. Pre-change outputs may be kept elsewhere.

Write requirement-matrix.json as an array with each ID exactly once, case-insensitive. Fixed statuses: satisfied, substituted, deferred. Shape:

```json
{
  "id": "C-MOTOR",
  "status": "satisfied",
  "designations": ["M1"],
  "evidence": { "summary": "Source and schematic evidence" }
}
```

Satisfied/substituted names must resolve in manifest-listed validated sources and appear on a non-report drawing. Start/stop require the pushbutton profile with NO/NC sense respectively; level requires a level-family profile; indicator requires a lamp profile. The plc and analog-input roles may share a designation when the PLC has its own analog-input function. Every other pair of different roles needs distinct designations; the same role may be shared by rows such as PLC and coil drive. Explain substitutions. A deferred must row needs its own non-empty designations, a substantive summary, and a final diagnostic on its own appropriate modeled device. Core 0.2.0 supplies the capabilities required by these rows; no library-capability gaps are declared in this task. Existing unrelated objects cannot stand in for a missing component. A deferred may row needs a reason. Draw all modeled non-terminal devices and any designed PSU feed; defer the undesigned feed on the PSU's own diagnostic. Judges assess adequacy, not electrical approval.

- **C-SUPPLY (must)**: “480 VAC 3-phase supply”. Roles/gap: supply.
- **C-BREAKER (must)**: “main 3-pole breaker”. Roles/gap: breaker.
- **C-STARTER (must)**: “contactor K1 with overload OL1”. Roles/gap: contactor, overload.
- **C-MOTOR (must)**: “a 2 HP 480 V conveyor motor M1”. Roles/gap: motor.
- **C-PSU (must)**: “24 VDC PSU fed from the 480 V side”. Roles/gap: psu.
- **C-PLC (must)**: “a compact PLC”. Roles/gap: plc.
- **C-TERMINALS (must)**: “a terminal block in the main panel”. Roles/gap: terminal.
- **C-CABLE (must)**: “via a multi-core field cable”. Roles/gap: cable.
- **C-START (must)**: “start pushbutton (NO)”. Roles/gap: start-button; normal state: open.
- **C-STOP (must)**: “stop pushbutton (NC) as PLC inputs”. Roles/gap: stop-button.
- **C-COIL (must)**: “the PLC output drives the K1 coil through the OL1 aux contact”. Roles/gap: plc, contactor.
- **C-SENSOR (must)**: “a PNP 3-wire photo/prox sensor at the conveyor discharge”. Roles/gap: pnp-sensor.
- **C-JUNCTION (must)**: “to a junction box”. Roles/gap: junction.
- **C-SPARE (must)**: “one cable core left explicitly spare”. Roles/gap: cable.
- **C-INDICATOR (may)**: “a stack light or indicator if the library supports it”. Roles/gap: indicator.
- **C-OUTPUTS (must)**: “zero-error validation; power view of M1; actuation view of K1; loads view of PS1; a printable packet (HTML, and PDF) with index, I/O report, terminal report, BOM, wire and cable schedules; `diagnostics` completeness output; a cable listing.”. Roles/gap: deliverable observation.
- **C-CHANGE (must)**: “Then make one realistic change via the guarded agent workflow (`thermite agent apply-source-patch`, dry-run first then apply)”. Roles/gap: deliverable observation.

Visual inspection is rubric-only: “Visually check at least two outputs: screenshot the HTML packet with playwright-cli (see `playwright-cli --help`) and look at the images yourself; note readability problems.” PDF V1/V5 remain pending without E3 or judges.
