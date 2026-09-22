# One component research assignment

Read `job.json`. Work on exactly its one source identity. The source description
is historical evidence, not a manufacturer specification. Do not delegate,
research additional components, or change anything outside this job directory.
This folder is a staging area; nothing you write is accepted into the library
automatically. Do not run installs, builds, repository tests, git operations,
account changes or publishing commands.

## Deliverables

Write `research.md`, `result.json` matching `candidate.schema.json`, and, only
when justified, `type.json` containing `{"types":[oneDeviceType]}`. Use the
exact `expectedTypeId`, `expectedManufacturer` and `expectedOrderNumber` from
the job. Existing examples and schemas in `reference/` illustrate the format.
The result's `conformance` is your independently researched connection inventory
and factory-continuity specification, not a list generated blindly from your
type. Write `result.json` last, after the other artifacts are ready.

If identity or essential connection evidence cannot be established, use
`decision: "needs-evidence"`, `conformance: null`, and explain precisely what
is missing. Do not fabricate a model to satisfy the queue. Describe unsuccessful
primary-source searches briefly so another researcher can continue efficiently.

## Research once, record what matters

Use manufacturer product pages, datasheets, selection tables and manuals.
Manufacturer-authored historical documents at distributor mirrors are acceptable
when identified as mirrors. Search snippets, reseller summaries, adjacent order
codes and generated text are leads, not terminal or rating evidence. Open the
sources you cite. Prefer one exact product sheet plus the relevant terminal
diagram over many redundant searches. Inspect diagrams visually when they
establish terminal identity; text extraction alone can scramble pinouts.

`research-tools.py` can fetch a public HTTPS document into `references/`, extract
PDF text, and render selected PDF pages. Invoke it using the Python command in
`job.json`. Read relevant downloaded pages or rendered images with your file
tool. Its `--help` explains commands. Use web tools for discovery and normal web
pages. Do not claim `diagramReviewed: true` unless you actually inspected a
relevant diagram visually. Record exact URLs, document title/revision/pages,
specific supported claims, and any source-versus-manufacturer disagreement.
Keep complete documents in this staging folder only; no manual redistribution.

For tiny contact numbers, first inspect the full page, then enlarge its diagram:
`<python> research-tools.py render references/manual.pdf --pages 12 --clip 100,200,300,400 --dpi 600`.
Replace `<python>` with the interpreter in `job.json`. Clip coordinates are PDF
page points (72 per inch), measured within the selected page rectangle; they
must increase and stay inside every selected page. Full pages remain limited to
72–180 DPI; clips allow 72–600 DPI, with at most 12 million pixels per image.
Crop filenames include the rectangle and DPI; stdout and PNG metadata sidecars
record the source page, rectangle and resolution. The original PDF is unchanged.
Inspect the exact order row **and its corresponding diagram**, preserving page
context: a sharper neighboring variant or unpopulated body position is still
not proof of this part's contacts. Enlargement cannot recover absent detail.

Allow roughly 10–15 minutes for one ordinary component. If difficult historical
evidence would need substantially longer, preserve a useful needs-evidence
result instead of chasing increasingly speculative matches. A timer is not a
reason to invent facts or mark an unverified item complete.

## Model electrical facts, not assumptions

- Exact order identity matters. Do not substitute a successor, complete an
  abbreviated code, remove meaningful punctuation, or transfer an optional
  accessory's terminals. A component suffix may describe only part of an assembly.
- Inventory every known power, return, PE/bond, shield, signal and communication
  connection, including optional actual contacts. Declare `connectionCoverage`
  with explicit notes; use `partial` when physical inventory is incomplete.
- Preserve verified terminal markings. If a functional alias is necessary,
  identify it explicitly; no guessed pin numbering, orientation or phase map.
- Set `required: true` only on universally required connections. Passive contact
  and terminal-block points are often application-dependent. Mechanical caps have
  no invented electrical pins; enclosing metalwork's bonding remains separate.
- A housing outline without a bonding label does not prove an exhaustive empty
  terminal inventory or an installed bond through the panel, insert or metalwork.
  If that interface remains undocumented, use zero documented terminals with
  partial coverage. Do not describe an assumed bonding path as a manufacturer fact.
- Electronic cards and terminal bases are separately ordered parts. Declare the
  selected, documented base for an assembled field-interface abstraction; do not
  combine optional clamps from incompatible arrangements. Distinguish a bare
  base's paths from paths that exist only with the electronic module fitted.
- Logical Ethernet `ports` and physical `connectorPorts` must use distinct keys.
  Document aliases when they describe the same socket; logical links must not
  manufacture pin-level electrical continuity.
- State ratings with units and applicable conditions in research/modeling notes.
  Do not flatten conditional switching-current/power tables into misleading
  scalar limits. A range maximum is a capability, not an assigned supply voltage.
  The current compiler compares `rating.nominal_voltage` exactly against circuit
  intent; it is not an allowable maximum. Leave voltage capability/ranges in
  notes for passive connectors, fuses and universal-input devices. Likewise do
  not assign AC-only metadata to a contact rated for both AC and DC.
- A neighboring order's numbered contacts do not prove this part's numbering.
  Do not infer 1–16 from another part marked 17–32. If the exact connection
  evidence cannot be opened, return needs-evidence. Describe unresolved PE
  assemblies without inventing a central pin or individual screw positions.
- Only explicit wires, jumpers and terminated cable cores join nets. Contact,
  bus, coil and connector metadata never manufactures continuity. Describe fixed
  hardware links in `conformance.fixedLinks`, with a source ID and reason. Never
  permanently join a switch or fuse merely because it normally conducts.
- Separate cable terminations from mating contacts when modeling a connector.
  `C.*`/`M.*` are authoring aliases. A fixed plug path needs an explicit fixed
  link; an interlocked socket's switched pole does not. Required PE presence can
  be satisfied by an internal link and does not establish external bonding.
- Map each function to an existing circuit symbol. Use supported single-terminal
  bus functions for separate connector endpoints. Do not author SVG geometry.
  Prefer a complete circuit view where applicable; zero-terminal accessories
  may use documentation views. If a function cannot be represented, record it.

## Standard result, central verification

The coordinator generates the isolated wiring fixture, byte lock, diagrams and
negative tests. Do not write a bespoke verifier or copy a whole example project.
The shared checker verifies identity, schema, terminal inventory, fixed links,
net separation, required-terminal diagnostics, stale-byte rejection and render
coverage. These checks do not establish manufacturer facts; your evidence record
must support those. Keep research concise enough for a reviewer to check the
identity, terminal diagram, ratings and remaining uncertainty quickly.

Finish with a short report naming the decision and saved files. Do not include
credentials, unrelated project data, source PDFs or a broad repository summary.
