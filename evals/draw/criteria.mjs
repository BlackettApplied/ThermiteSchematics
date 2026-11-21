// Frozen DQ checklist, council §4. Automated and visual portions share IDs.
export const criteria = {
  "DQ-01": "PDF/SVG label parity: zero missing label regions",
  "DQ-02": "Text inside its cell/frame/sheet; no text-text overlap",
  "DQ-03": "No symbol primitive joins independent nets; review legend",
  "DQ-04":
    "Glyphs and qualifiers match the selected standard; contact-state captions agree with native function/symbol roles; protection-role captions carry no NO/NC state",
  "DQ-05":
    "No raw UUID, unmapped circuit group key or IR function key printed by default. Terminal strip references bind their printed device and final sheet / zone to a measured native strip body",
  "DQ-06": "Device designation, description and authored rating/part",
  "DQ-07":
    "Full-repeat navigation, coil mirrors and contact-to-coil sheet.zone match IR",
  "DQ-08":
    "Reciprocal ordered off-page sheet.zone, source-backed conductor aliases and 2.5 mm block gaps; native circuit-terminal/network-port part references resolve reciprocally to measured destination zones; same-device detached protection/contact elements and each omitted selected communication port have individually named final sheet.zone pointers to measured native appearances",
  "DQ-09": "Four-side zones and all references resolve",
  "DQ-10":
    "Monotone L1-L2-L3(-PE), U-V-W and upright text and graphical AC/DC qualifiers",
  "DQ-11":
    "Vertical flow succeeds wherever horizontal does, or executed R006 remedy works",
  "DQ-12":
    "Median visible drawing-area utilisation >=40%; no avoidable extra sheet",
  "DQ-13":
    "Conductor >= outline/incident attachment stroke; filled dots only at >=3-way native junctions, measured by distinct painted incident rays including circuit and wiring attachments",
  "DQ-14":
    "Double landings appear as two native conductors without shared approach ink or free-air junction dots unsupported by native nodes",
  "DQ-15": "No jog <3 mm or unreasoned detour >2x Manhattan +20 mm",
  "DQ-16":
    "Wire label <=2 mm from own conductor and nearest to it; native label ownership and painted support data are required; broader block association remains manual",
  "DQ-17": "No duplicate/overlapping terminal text",
  "DQ-18": "Title-block fields and revision table present",
  "DQ-19":
    "Report bounds, explicit native empty states, endpoint sheet.zone reconciled to painted native strip or schematic landings, complete index, sufficient printed document dependencies and truthful partial/complete wire-inventory scope; final index includes its own and reference pages, with own-sheet qualifiers exactly for repeated captions; assembly notes deliver native reasons to sufficient issued rows and off-part ports to their individually named measured drawn destinations; port-status needs apply only when no issued sheet draws the port; M3 reconstructs selected assembly disposition/reason needs and distinct connector-port-status facts from native IR, with no invented cap pins or unoccupied-port cables",
  "DQ-20": "One font family and one symbol catalog per packet",
  "DQ-21": "PDF and SVG font metrics identical",
  "DQ-22": "Two blind independent drafter reviews, material/minor red-lines",
  "DQ-23":
    "Graphical terminal-strip diagram available; native conductor stubs and bridges do not join outside a common terminal body, and distinct native bridges do not share outside-body approach ink",
  "DQ-24":
    "Configured wire numbers unique and consistently placed; printed stroke/inventory conductor aliases agree with native identity (not a configured-numbering-policy claim)",
};
