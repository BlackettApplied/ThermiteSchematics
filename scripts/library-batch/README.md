# Component research batches

Research one exact component per worker, using Claude CLI and Codex CLI together.
Workers return proposals in separate folders. A coordinator reviews the evidence
and promotes accepted parts into the visible libraries. No worker edits a shared
library or runs the whole repository test suite.

## Capacity and runtime

Use Bun 1.4.2 on Apple Silicon macOS, with `bun install --frozen-lockfile` and
`bun run build` completed. Both CLIs need working authentication. The PDF helper
uses a Python installation with PyMuPDF; `--pdf-module-path` can point to an
existing matching-architecture module installation.

Concurrency is configurable separately for each CLI. Start with a small health
check, then increase while observing memory and account limits. The observed
run covered 36 one-component assignments across two overlapping batches: an
initial 24-component batch and a second 12-component batch. Peak simultaneous
work was 18 independent CLI processes, comprising 6 Claude and 12 Codex workers
across both runners. These are observed operating figures, not provider maxima
or a guarantee of capacity on another account or machine. Each runner applies
its own limits; account for the combined load when batches overlap. The queue
can be much longer than the active pool; an available slot starts the next
component automatically.

Current [Claude documentation](https://code.claude.com/docs/en/sub-agents#concurrent-subagent-limit)
describes a default of 20 nested subagents, configurable with
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` starting in 2.1.217. That setting does not
describe this runner's independent CLI processes, and the installed 2.1.169 used
in the first batch predates it. There is no documented universal maximum for
independent processes. Account limits and local resources still apply.
[Codex subagent limits](https://learn.chatgpt.com/docs/agent-configuration/subagents)
likewise concern nested agents; this runner disables nested delegation in each
worker. Each process has exactly one component.

The first run used Claude 2.1.169 with the working `opus` alias and an isolated
Codex 0.154.0 installation. The system Codex 0.144.1 could not use the configured
model. Supply a compatible `--codex-cli` path instead of replacing a user's global
installation. The Codex model is explicit; no account settings are changed.

## Prepare an immutable queue

The inventory input is the reference project's generated library coverage JSON.
Only `research-needed` entries with a make and order number are eligible. Items
with incomplete identities need separate investigation, not guessed completion.

A selection file contains exact inventory IDs and unique destination type IDs:

```json
{
  "jobs": [
    {
      "id": "PART-0063",
      "backend": "codex",
      "library": "abb-pilot",
      "slug": "2cds271001r0044",
      "manufacturer": "ABB"
    },
    {
      "id": "PART-0495",
      "backend": "claude",
      "library": "stahl-pilot",
      "slug": "8570002140",
      "manufacturer": "R. STAHL"
    }
  ]
}
```

Each pick can also include `hints` (strings) and `referenceFiles` (local document
paths). A seed document is evidence to inspect, not permission to copy another
part's terminals.

```sh
bun scripts/library-batch/prepare.mjs \
  --inventory /absolute/project/evidence/library-coverage.json \
  --selection /absolute/selection.json \
  --batch /absolute/new-batch \
  --python /absolute/python3 \
  --claude-cli /absolute/claude \
  --codex-cli /absolute/codex \
  --codex-model gpt-6-astra --codex-effort medium
```

Preparation checks the complete selection before creating jobs and refuses an
existing queue, status or runner lock. It copies the worker guide, schemas and
format examples into each job folder. Review the resulting `queue.json` and run
with `--dry-run` before starting paid CLI work. Keep queues, raw documents,
runtime installations and transcripts outside tracked library source.

## Read small diagram labels

Use the prepared job's Python interpreter and run its helper from that job:

```sh
<python> research-tools.py render references/manual.pdf --pages 12 --dpi 120
<python> research-tools.py render references/manual.pdf --pages 12 \
  --clip 100,200,300,400 --dpi 600
```

`--clip x0,y0,x1,y1` selects a region in PDF page points (72 per inch), within
the selected page rectangle. Coordinates must be finite, increase on both axes,
and remain inside every selected page. Full pages support 72–180 DPI; clipped
regions support 72–600 DPI. Every image is limited to 12 million pixels before
allocation, with at most 12 pages per request. Use a smaller clip if necessary.

Full-page filenames are unchanged. Cropped PNG names include their rectangle
and DPI, and each PNG receives a metadata sidecar; the same source/page/rectangle/
resolution record is printed on stdout. Original PDFs are preserved. Inspect
the exact order row and its own diagram together before accepting contact
numbers. Magnification does not validate a neighboring variant, distinguish
unpopulated body positions automatically, or recover detail absent from a scan.
Helper updates apply to newly prepared jobs; do not replace active job copies.

## Run and adjust capacity

Write `limits.json` containing `{"claude":6,"codex":6}`, then:

```sh
bun scripts/library-batch/run.mjs --batch /absolute/new-batch \
  --limits-file /absolute/new-batch/limits.json --dry-run
bun scripts/library-batch/run.mjs --batch /absolute/new-batch \
  --limits-file /absolute/new-batch/limits.json
```

Edit the limits file while the runner is active to increase capacity or let work
drain to a lower limit. Invalid edits retain the last valid values. Zero stops
new launches for that backend. Running workers keep their slot until finished.

`status.json` records attempts, timestamps, process IDs, outcomes and diagnostic
paths. Worker stdout and stderr remain separate. A process outcome of `completed`
means its proposal contract is present; it does **not** mean accepted library
content. `needs-evidence` preserves a researched gap without inventing a model.

Quota failures pause new work for that backend. There are no automatic retries.
After resolving a failure, an explicit `--resume` archives previous failed
attempt artifacts and retries eligible jobs. Completed and needs-evidence jobs
are retained. Do not edit the queue to retry or append items; create a new batch
for a different selection. Ctrl-C stops this runner's own worker groups and
records interrupted work. A worker has a default 25-minute execution timeout.

## Verify, review and integrate

Format final proposal files before verification so later formatting cannot
invalidate the recorded source hashes. Never edit an active worker's files.

```sh
bun scripts/library-batch/verify.mjs \
  --job /absolute/new-batch/jobs/PART-0063 \
  --output /absolute/new-batch/checks/PART-0063
```

The shared verifier checks strict JSON/schema, exact identity, terminal inventory,
fixed links, physical net separation, disconnected required terminals, stale
library locks and generated drawing coverage. It retains diagnostics and review
flags. It uses an unenergized synthetic fixture with independent endpoints; this
does not establish supply sizing, protective coordination or installed bonding.

Review the exact manufacturer identity and connection diagram for each part.
For repeated variants, reuse an already-reviewed family diagram only after
checking that each exact selection belongs to it. Inspect new drawing patterns
and all flagged exceptions. Open the generated HTML and sheet SVGs listed in
`report.outputs` and inspect terminal labels, functions and explicit conductors
at their intended print size. The verifier checks the declared model and cannot
prove the underlying manufacturer facts. Conditional ratings, placeholder labels
and historical document conflicts remain explicit. Mechanical accessories use
documentation views rather than invented electrical terminals.

A `verified-candidate` still requires a coordinator's explicit acceptance record
after source and visual review. Save a review JSON with this shape, copying the
entire `inputs` object **exactly** from the completed `report.json`. The values
below are placeholders for its four 64-character SHA-256 digests; the notes must
record the actual evidence reviewed and any accepted model limitations.

```json
{
  "decision": "accept",
  "inputs": {
    "job.json": "<copy report.inputs job.json hash>",
    "result.json": "<copy report.inputs result.json hash>",
    "research.md": "<copy report.inputs research.md hash>",
    "type.json": "<copy report.inputs type.json hash>"
  },
  "notes": "Record the checked manufacturer pages, visual review and accepted limitations."
}
```

The destination library directory and its `library.json` must already exist.
Its `name` must match `job.targetLibrary`, and the job's expected type ID must
match that name plus its type filename slug. Its declared sources must include
the new `types/<slug>.json`; a manifest using `"sources": ["types/*.json"]`
includes these files. Promotion uses the existing manifest version and does not
create or rewrite the manifest.

```sh
bun scripts/library-batch/promote.mjs \
  --job /absolute/new-batch/jobs/PART-0063 \
  --report /absolute/new-batch/checks/PART-0063/report.json \
  --review /absolute/new-batch/reviews/PART-0063.json \
  --library /absolute/checkout/libraries/abb-pilot
```

`promote.mjs` rechecks reviewed bytes and generated evidence, then copies the
canonical type, research note and minimal wiring example. It refuses stale
reviewed bytes and existing destination artifacts. Source changes require fresh
verification and review. The example references the canonical library and
retains `promotion.json` with accepted-input, review and report hashes.
Promotion never publishes or commits a library. See
[component examples](../../libraries/COMPONENT_EXAMPLES.md) for packet generation
and the limits of these fixtures.

Once the batch is integrated, refresh locks for examples using changed libraries,
including examples promoted earlier in the same batch. Promotion locks the new
example, but adding another type changes the library bytes for every example
that references it. Refresh and validate each affected project:

```sh
bun thermite.mjs lock libraries/abb-pilot/examples/2cds271001r0044
bun thermite.mjs validate libraries/abb-pilot/examples/2cds271001r0044
```

Then regenerate the reference project's coverage inventory and run the shared
Mac alpha check once. Preserve partial-coverage warnings and keep held identities
on the research list. Do not count a candidate, a compatible substitute or a
mechanical cover as an electrically complete installed system.

The normal test suite exercises these tools using synthetic workers. It never
launches paid research sessions or accesses manufacturer sites.
