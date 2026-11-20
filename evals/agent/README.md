# Fresh-agent evaluator (E2 v1.20.5)

This kit measures task outcomes, workflow violations and context cost. It ports
the GI prototype shim/scorer/T02 checker. It does not launch models in `check`.
All transcripts, runtime copies, projects and timing evidence stay under the
already gitignored `evals/out/agent/<checkpoint>/`.

```sh
bun evals/agent/run.mjs --agent reference --task T02 --checkpoint reference-t02
bun evals/agent/run.mjs --agent reference --all --checkpoint references
bun evals/agent/run.mjs --agent reference --task T05 --context source --commit 38720de --checkpoint source-t05
```

Use Bun 1.4.2, Git, installed frozen dependencies and a built engine. Runtime
context (default) builds `bun run package:pack --preview` in a detached worktree
of `--commit` (default HEAD), then extracts the verified ZIP. Source context
builds and copies that pinned worktree, including dependencies; its lock must
match the installed dependency lock. Engine source is never patched by the kit.
The prepared context is retained for reproducibility and resumption.

Every case has its own copied runtime, project, home/config/memory and audit
folder in a temporary run directory. The runner initializes the template, runs
setup, substitutes the guide, and commits a local Git baseline. It renames the
launcher to `thermite.real.mjs` and installs the shim. After the agent/reference,
it flushes a shim `validate`, checks independently with the real CLI, scores and
copies evidence out. Per-run workspaces are removed after success or failure;
Only `--keep` retains ordinary workspaces, including command-only runs. An unresolved explicit checker infrastructure error retains its workspace for a checker-only retry; its isolated auth is removed unless `--keep` was requested. `--keep` can retain a disposable, credential-bearing auth.json in the run workspace. Reference mode uses the
same pipeline without a model or auth requirement.

## Authentication and command inspection

These commands never request a model:

```sh
bun evals/agent/run.mjs --agent claude --check-auth
bun evals/agent/run.mjs --agent codex --check-auth
bun evals/agent/run.mjs --agent codex --task T02 --checkpoint inspect-command --print-agent-command --keep
```

Both normal and command-only runs execute `claude auth status` or
`codex login status` before a model could launch. Auth failure is infrastructure
failure. `--check-auth` needs neither task nor checkpoint and exits 0/1 for
ready/not ready. It prints only readiness, intended billing route and a generic
failure reason. Status commands do not prove provider/model availability.

Claude subscription OAuth recipe (run token setup in your normal CLI session):

```sh
claude setup-token
# Paste the resulting token at the silent prompt, then press Enter.
read -rs CLAUDE_CODE_OAUTH_TOKEN
export CLAUDE_CODE_OAUTH_TOKEN
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
bun evals/agent/run.mjs --agent claude --check-auth
```

This uses the Claude account's subscription OAuth route. Existing keychain login
alone does not carry into a fresh HOME/config. For API billing, set
`ANTHROPIC_API_KEY` instead and unset `CLAUDE_CODE_OAUTH_TOKEN` before checking.
No setup token or API value is written to the manifest, printed command or log.

Codex API billing recipe:

```sh
read -rs CODEX_API_KEY
export CODEX_API_KEY
unset OPENAI_API_KEY
bun evals/agent/run.mjs --agent codex --check-auth
```

`OPENAI_API_KEY` is also supported; `CODEX_API_KEY` takes precedence. The runner
imports the key locally with `codex login --with-api-key` on stdin into the fresh
CODEX_HOME, then checks status. No model call is part of this import.

Codex ChatGPT-login recipe:

```sh
bun evals/agent/run.mjs --agent codex --codex-auth "$HOME/.codex/auth.json" --check-auth
bun evals/agent/run.mjs --agent codex --codex-auth "$HOME/.codex/auth.json" --task T02 --checkpoint codex-smoke --print-agent-command --keep
```

`--codex-auth` copies **only** `auth.json`; config, memory and instructions are
rejected. This explicit option suppresses inherited Codex API keys so billing
follows the supplied auth file. A ChatGPT-login file uses that account's login
route; an API-key auth file uses API billing. The supplied file remains the
operator's authoritative copy. The runner gathers redaction values before
launch and discards the isolated `auth.json` without reading it back or
writing to the operator's copy.

Before each run and during `--check-auth`, the harness refuses to seed a
ChatGPT login if its `last_refresh` is missing, invalid, or in the future,
or if eight days from that timestamp or the access token's readable JWT
expiry falls within the run timeout plus a ten-minute margin. Before a batch,
run your own Codex installation once, then use `--check-auth` against its
current auth file. If the freshness check still fails, sign in again there
and retry. A provider rejection such as a 401 can still cause an unexpected
refresh. Rotation in the disposable copy can leave the operator's refresh
token already used, which can break later runs and require signing in again
in the operator's installation. [Codex refresh implementation](https://github.com/openai/codex/blob/rust-v0.169.0/codex-rs/login/src/auth/manager.rs)

The transcript (agent stdout) and agent stderr redact the credentials known
before launch and common token shapes, including JWTs and prefixed API and
OAuth tokens. Shape matching can redact ordinary text that resembles a token
and can miss unfamiliar or opaque credentials issued during a run.

`--check-auth` checks local credential readiness. Dummy tokens can pass.
Invalid tokens surface as structured provider-auth failures on a live run.
Codex warns that temporary CODEX_HOME cannot install PATH helper aliases.
Verify apply_patch availability in the first live smoke run.

The recipe contracts have offline tests with stub status/import CLIs. Non-model
checks on the development host also passed for an isolated ChatGPT login and a
synthetic local API-key import. Fresh Claude config correctly reports not ready
without an explicit token/key; a paid Claude request was not used for validation.

Fresh environment forwarding is a small allowlist including the five supported
credential variables. Checkout paths are removed from PATH and asserted absent
from public agent environment values. Audit paths and TMPDIR point inside the
run directory, which Codex's workspace sandbox can write. Live evidence is kept
in the harness home instead; see E2 1.20.3. Claude-agent runs bypass
permissions as the harness user and have no filesystem boundary. Claude imports the
project guide through a harness-authored `CLAUDE.md` containing only
`@AGENTS.md`; Codex loads `AGENTS.md` normally. Assertions reject inherited
ancestor instructions, user memory/config and unexpected project settings.
The only initial CODEX_HOME file permitted is the chosen `auth.json`.

`agents.json` pins Codex to `gpt-6.1-sol` with reasoning effort `xhigh` and
Claude to `claude-opus-5-5`. Codex receives both `-m gpt-6.1-sol` and
`-c model_reasoning_effort="xhigh"` explicitly, independent of user config.
Claude receives `--model` only. Codex effort overrides are limited to the installed
0.164.0 bundled gpt-6.1-sol catalog: low, medium, high, xhigh, max and ultra.
The catalog advertises max/ultra explicitly; none/minimal are not advertised
and are rejected. Claude 2.1.280 help lists low/medium/high/xhigh/max, but this
model-only Claude protocol continues to reject effort overrides. Manifests record CLI versions. Claude's updater
is disabled in the environment and Codex receives
`-c check_for_update_on_startup=false`. Commands otherwise follow GI §7.
`--print-agent-command` prints the exact argv and an empty-environment launch;
credential variables are referenced, never expanded into the printed text.
Without `--keep` its paths are intentionally cleaned after inspection.

Use `--model <id>` to override the model for one invocation and `--effort <level>`
to override Codex reasoning effort. Claude and reference runs reject `--effort`;
reference runs also reject `--model`. For example, this only prints a command:

```sh
bun evals/agent/run.mjs --agent codex --codex-auth "$HOME/.codex/auth.json" --task T02 --checkpoint inspect-override --model gpt-6.1-sol --effort high --print-agent-command
```

Every record, including command-only and failed runs, stores effective `model`
and `effort`, the committed `modelPin`, and requested `modelOverrides`. Both
effective values and override provenance enter the run key and directory suffix.
Even an explicit override equal to a pin has a separate history. Resume cannot
reuse a pinned result for an override. Analyze each configuration separately;
the analyzer rejects mixed model/effort/override configurations and never pairs
different configurations across arms. Changing agents.json changes harnessHash.
The price table has no verified rates for these new pins: their cost estimates
are explicitly partial with null amounts and unknownModels, never inherited
from the previous models' rates.

## Arms, external tasks and attempts

`--arm B --guide /absolute/path/compact-guide.md` substitutes a project guide
before the baseline. A defaults to the current generated guide. Both arms use
the same engine; the kit does not supply a compact guide or claim an A/B result.
`--tasks-dir /absolute/path` loads trusted external task modules, with the same
`task.json`, optional setup, checker and reference contract. H1/H2 are held by
scorers and are absent here. `--concurrency 1|2` caps the batch at two.

A checkpoint is resumable; commit, context, harness hash, checker hash and evalVersion must match. Creation stores hashes and version in context.json/checkpoint.json. checkerHash also includes the entire task catalog, including --tasks-dir outside the repo; checkerHarnessHash identifies the framework. A mid-run source/catalog change is unscored. A mismatch refuses before any run; --allow-harness-mismatch records the old/new identity and an explicit override, retained in context/checkpoint history and new run records. Overrides permit collection, but analysis rejects mixed selected identities. The **first complete attempt counts**, including task failures. Completed cases are skipped. Quotas/usage limits and billing errors halt dispatch while in-flight runs finish. Their `halted-infra` records are incomplete history, consume no automatic retry budget, and reopen automatically on the next invocation. A stored halt never re-stops a batch. This includes legacy billing records.

Transient rate limits and nonzero unstructured CLI exits share a cap of two automatic reruns per key (three failures including the original), including across resume. Backoff starts at 5 seconds and doubles, honoring structured reset/retry-after hints. A reset over 15 minutes away is a quota. Other infrastructure failures require explicit resume after repair. To reset an exhausted counter without deleting evidence, pass `--reopen-infra all` or `--reopen-infra '<runKey>'` (copy runKey from the manifest). A key must match this invocation's selected configuration. The new record retains the request and previous failure count; analysis history retains the reset. Reopening never replaces a completed score. `--force-rerun` is separate: it creates another completed attempt, recorded in warnings, but cannot replace the first score.

Evidence lives at `<checkpoint>/<task>-<agent>-<arm>-<seed>-<configuration-hash>/attempt-001/manifest.json` (reference directories omit the suffix). Keys include context, task, arm, agent, seed, effective model/effort, override provenance and attempt. Originals and adjudicated copies coexist. Analysis reports attempt counts and forced reruns, and blocks unresolved infrastructure/checker faults.

An exception while evaluating agent output is a completed task failure with its reason. Missing or invalid deliverables never request a paid retry. A checker module may throw the exported `CheckerInfrastructureError` only for an infrastructure fault (for example a missing checker installation). This yields `checker-error`, keeps the original workspace, and saves recheck.json. Resume re-runs only that checker in the same attempt; no agent process launches and usage is unchanged. Checker revisions retain `checker-history-001.json` and record checkerHarnessHash. An unavailable kept workspace blocks rechecking; it never starts the agent. Recheck refusals print the task and reason to stderr. Rechecks refuse changes to the task directory unless `--force-recheck` is supplied; the new tree hash and forced revision are recorded. The original agent harness hash remains immutable, while checkerHarnessHash and checkerTaskTreeHash identify the actual checker. Analysis compares both agent and effective checker identities. Reference exceptions and agent-side error results/timeouts are task failures. Provider/auth/transport signals, CLI crashes and shim/harness failures are infrastructure; classification uses structured codes/status or embedded provider JSON, never domain words in agent prose. Successful terminal completion is judged by the checker, including a nonzero shutdown exit (recorded in warnings and exitAfterCompletion). Recovered conditions clear on agent progress; a later specific terminal agent error such as error_max_turns decides the outcome. Earlier retry/error rows become retryCount/retryEvents. Generic execution-error wrappers preserve only an immediately pending, unrecovered typed provider cause. invalid_request_error alone is an agent outcome; only structured model/auth subtypes make it infra. Prompt/context-length errors remain agent outcomes. Known terminal agent errors remain failures. An unrecognized terminal error becomes needs-adjudication, never a scored failure. Infra counts by kind are reported per arm, including resolved attempts.

One exception does not abort siblings. On SIGINT, owned model **and reference** process groups terminate and the runner returns 130. `--timeout <seconds>` defaults to 900; killed usage remains partial.

## Audit and file-state rules

The shim logs argv, file/stdin requests, status/signal/error code, byte counts,
compiler diagnostics, before/after project states, changes since the previous
call and changes during the call. Calls serialize on a PID-owned audit lock.
Queued/start/command-end timestamps distinguish waiting from the actual call
interval. This prevents a legitimate overlapping packet and apply from being
misattributed as direct edits. Returned patch-integrity hashes also detect a
subsequent unguarded edit to a committed patch target.

The log/state live under the run directory, not in the checkout. Each record
is hash-chained; the runner verifies the chain/head and records the final log
hash. Audit failures write a `shim-error` marker and become infrastructure
failures. If the project/log configuration is missing or the audit lock cannot
be acquired, the shim exits 2 before running the CLI. On Windows only,
lock-create `EPERM`, `EACCES` and `EBUSY` retry like `EEXIST` within the existing
120-second deadline; other platforms fail these create errors immediately.
A timeout or fatal failure remains audited. An existing empty lock or an owner
whose liveness probe returns `EPERM` is never reaped. If this process creates a
lock but cannot write its PID or close the descriptor, it removes that lock.
Once the CLI starts under its lock, audit failures never change that CLI's
stdout, stderr or exit code.
The real CLI inherits the caller's output descriptors. A small preload observer records writes out of band; no intermediate stdout pipe can absorb a downstream EPIPE. The CLI itself determines the exit code (including `| head`), and signals are forwarded. The observer and marker files are ephemeral and contain no checkout environment path. The evaluation protocol uses non-TTY streams.

Project snapshots exclude `.git`; runtime hashes include all directories,
including newly created empty `.git` directories. The runtime baseline is after
shim installation. Initial, per-call and final snapshots close the before-first,
after-last and child-process-write holes. A quiet real-CLI `validate --json`
labels each boundary's invalid JSON separately from schema-invalid files; an
unchanged invalid file keeps that state. Only E002/E003 (including duplicate
keys rejected by the strict parser) grant ordinary JSON repair. The independent
`invalidJsonFiles` metadata prevents an authored `$invalidJSON` property from
granting permission. A schema-invalid or JSON-valid non-object root receives no
ordinary-edit exemption; a non-object root cannot be replaced through JSON Patch,
so report it for explicit correction rather than bypassing the guarded loop. Permissions never depend on the immediately preceding command.
Human `validate`, `--help` and other calls cannot revoke a valid repair exception.

The current generated guide is normative. Updating its edit permissions requires
a reviewed scorer change and eval-version bump.

> Write new files completely before listing them in `sources` in `system.json`.
> Once listed, use guarded patches for every edit, including E011 repairs,
> except for JSON syntax repair. Then run `thermite validate .`.

| File/change                                         | Direct edit permission                                      | Guide provenance                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Existing referenced source/presentation             | Guarded dry-run then apply                                  | “To edit existing source/presentation files:” followed by the guarded workflow.                                                    |
| New source files and `system.json` source listing   | Ordinary edits to write and register new files              | The quoted rule requires validation after registration and guarded patches for later edits.                                        |
| Libraries, including visible core                   | Ordinary edits, then CLI lock                               | “After library edits, run `thermite lock .` before validation.”                                                                    |
| JSON-invalid existing source/presentation           | Ordinary repair while its before-state has E002/E003 (A006) | “An E002 syntax error or a duplicate key needs an ordinary syntax repair, then validation.”                                        |
| Schema-invalid existing source/presentation         | Guarded repair; explicit raw-byte hash permitted            | “For E011 shape errors, patch the parsed value.” The guide prescribes raw-byte guards and UID tests when compilation fails.        |
| Schema-valid source with a compile error, e.g. E102 | Guarded repair; explicit byte hash permitted                | The guide prescribes raw-byte guards and UID tests for semantic repairs when compilation fails.                                    |
| Library lock                                        | Successful CLI `lock` writes only                           | The guide calls for `thermite lock .`. The offline project workflows topic explains that `electrical-system.lock.json` pins bytes. |
| Project `AGENTS.md` and Claude import wrapper       | Frozen after arm setup                                      | The guide excludes itself from patch eligibility; the evaluator freezes instructions as V3.                                        |
| Requests, notes and generated artifacts             | Ordinary files; source remains authoritative                | “Electrical JSON is authoritative. PDF/SVG/HTML are generated.”                                                                    |

| Rule | Meaning                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1   | Existing referenced source/presentation edited outside a successful guarded patch, except an E002/E003 before-state JSON repair. Includes run boundaries, deletions and child writes.                                                                                             |
| V2   | Library lock edited except by successful CLI `lock`.                                                                                                                                                                                                                              |
| V3   | Project instructions/import wrapper changed after the baseline. Successful `init` may create instructions for a new project.                                                                                                                                                      |
| V4   | Apply has no identical successful earlier dry run. Canonicalize the whole request except `dryRun`, retaining guards and operation order.                                                                                                                                          |
| V5   | Runtime tree changed, per call or across the run.                                                                                                                                                                                                                                 |
| V6   | Invented facts; rubric only.                                                                                                                                                                                                                                                      |
| V7   | A checker-declared warning set disappears, an unsupported `intentionally-unused` disposition appears, or T10 changes electrical bytes. Expected W903/W904/W905 alternatives key by designation, not the reference UID or modeling choice.                                         |
| V8   | Runtime-context transcript tools access known engine checkouts or the project's GitHub source. T07 alone permits declared optional-library GET acquisitions; the guide-required read-only bug tracker is permitted. Engine-source reads still fail. Source context permits reads. |

V8 covers Read/Grep/Glob/LS/WebFetch/Task/Agent and shell/exec events, including
bare-root `cd`, `rg`, `ls`, `git -C`, `find`, `cat` and realpath aliases.
A small write-only tool list is excluded. This is transcript evidence, not a
filesystem security audit; ambiguous/indirect accesses require scorer review.
Snapshots also cannot detect an edit reverted entirely between observations.
Hash chaining detects damaged/inconsistent audit data; it is not a defense
against a malicious actor rewriting the entire audit and state together.

`undocumented-shape` matches checker-declared `(code, pointer)` discovery gaps;
it does not label every schema error as a documentation defect. Raw codes and
reports are retained. Update declarations when discovery ships and replay the
previous checkpoint with the new checker version.

## Independent checks and dogfoods

Checkers resolve electrical objects through `system.json` source patterns,
using the compiler's glob implementation/options. Unlisted JSON with `objects`
cannot supply devices, connections or provenance. Library types likewise come
from declared library sources. Checkers rebuild outputs with the real CLI in a
separate copy and write fresh outputs outside it. They compare artifacts with
the regenerated outputs; view metadata must match the requested root/intent.
Buffered stdin requests can be replayed from the audit. PDFs need a real page
count and extractable text, not just `%PDF-`.

T01–T12 have thirteen executable cases because T09a/T09b split task 9. T09a
compares semantic JSON with sorted keys; T11 permits only the label change;
T12 accepts `p2 line 7`, `page 2, line 7` and `p2 line7`. T04's message, T07,
T09b and T12 remain two-judge rubric tasks.

Each D task includes its exact frozen `brief.source.txt` and a separately
headed **Deliverable format** appendix. The task prompt embeds the frozen bytes
verbatim. Historical paths in the quoted brief are provenance; the appendix
instructs the agent to use the supplied launcher in the already-initialized
project. Every matrix ID quotes only the relevant verbatim clause, declares must/may and lists
its roles. Roles use the engine SYMBOL_PROFILES catalog, alias resolver and library function metadata, tested against both installed core versions; start/stop use the pushbutton profile and NO/NC sense, level uses a level-family profile, and indicator uses the lamp profile. Notes never establish a role. Only the plc/analog-input pair may share a designation, when the PLC has that onboard function. Every other pair of different roles requires distinct designations. Core 0.2.0 supplies a level-family model; a generic limit-switch cannot stand in for it or claim that capability is absent. Rows have `id`, `status`, `designations`, `evidence`; fixed statuses
are `satisfied`, `substituted`, `deferred`. Display wording/capitalization does
not affect scoring.

Satisfied/substituted rows must resolve to validated source and actual drawing
appearances. A deferred must row needs non-empty source designations and a final compiler diagnostic on its own named device fitting the requirement role. D-task version 1.5.0 declares no library gaps: current core 0.2.0 supplies all eight previously listed capabilities, including a NO start button and a PLC with at least three DI. External task catalogs may still declare specific inventory-verified gaps; an existing unrelated object cannot represent a missing component. Optional conditional items
may be deferred with a reason. Blanket `deferred: n/a` fails. Visual inspection
is explicitly rubric-only, not a falsely satisfied matrix row.

Coverage requires every modeled non-terminal device on a schematic and drawn
PSU input feeds where designed. A source-level deferral and the PSU's own
final W905 justify an undesigned input. The separately required matrix checks
the brief roles and their on-drawing evidence. Both change rows accept a changed
source wire UID with visible schematic route ink. Report, index and
reference-table mentions do not count. XT1/Q2/HL1/PX1 and other valid tags work. The packet used for coverage is
regenerated from source; an agent-written `packet.json` is never authority.
All eight deliverable items are checked, including independent reports/review,
requirement matrix and local-type/source-read/failure counts. The counts item requires zero attempted GitHub writes for recorded D prompts
at version 1.6.0 or later. Older runs report attempts alongside violations
with the write rule marked as not in force.

A separate analog device is not automatically a PLC expansion module. The checker's existing non-failing `pending` channel flags its integration for judge review; it does not verify a modeled link to the controlling PLC or infer a backplane. This is a known automation limit, not an additional must.

The D references now model the generic starter, real field/start wiring,
indexed packets, reports and guarded review. The pump uses core 0.2.0's generic
two-wire transmitter, analog-input PLC, level switch, NO pushbutton and HMI.
PT1's passive two-wire interface runs through the field cable and terminal strip
to PLC1.AI0+/AI0-, with explicit spare cores and a signal-loop drawing. The same PLC drives the contactor and connects to the HMI, following the shipped RM3 topology; the extra AI1 controller is removed. Loop power, AI mode, compatibility and
selected hardware remain engineering selections; no operational loop is claimed.
Conveyor stop monitoring retains W905 for the selected two-DI compact PLC's unfinished third input; core also supplies an eight-DI alternative.
the conditional indicator is deferred with a reason. Both references leave PS1 AC input unwired and cite its own W905: no input rating or branch protection is invented. They exercise produce → guarded rendered-label change → regenerate, so final outputs match final sources. These are explicit gaps,
not blanket fulfillment claims. Judges assess their adequacy and substitutions.

E3 remains optional. A run's checker can consume `draw-evidence.json`:

```json
{
  "format": "thermite-agent-draw-evidence/1.0",
  "files": {
    "drawings/packet.pdf": "<sha256 hex>",
    "drawings/packet.html": "<sha256 hex>"
  },
  "V1": true,
  "V5": true,
  "checker": "<E3 or independent visual-review evidence>"
}
```

Digests must match. Without this evidence, PDF V1/V5 is `null`/pending, never a
visual pass. There is no import/dependency on the in-flight `evals/draw` work.

## Measurements, judgements and A/B

Both Claude Code stream-json and Codex exec JSON normalize to tools, results,
messages and usage. Repeated partial Claude messages use the latest/max counters.
Killed/noisy streams retain lower-bound usage marked partial. `modelUsage` includes
auxiliary models, and provider-reported cost is retained separately. The committed
price table estimates each model at its own rate; unknown rates remain partial,
not zero. Subscription authentication does not turn that API-equivalent estimate
into an asserted subscription charge.

Metrics include calls, failures by code, tools, wall time, tokens/cache usage,
source reads, topic retrieval and guide bytes. Guide bytes include the normally
loaded project guide, successful shim `guide` stdout once, and observed reads of
declared guide/engine-doc files. The guide pipeline's tool result is not counted
again, and agent-authored notes do not count as guides. Missing read outputs
remain unmeasured. Setup/checker/final-flush calls do not inflate agent counts.
Required topics must precede the task's declared first related command.

Manifests include engine commit; harness/task hashes; arm, context, model, effort, seed
and attempt; prompt/guide/runtime/log hashes; CLI versions; authentication route;
timings; usage and cost estimate. Judge packets include final message, source
and library diff, outputs and rubric, without run identity fields. Outputs are
read without following links; see E2 1.20.4. Text/path
blinding covers provider/model aliases (Anthropic, OpenAI, GPT, Claude, Codex,
Opus, Sonnet, Haiku, Fable, o-series and peers). Base64 PDF bytes are never redacted.
Assign neutral packet IDs outside the packet and give `judge-prompt.md` to one
Claude judge and one Codex judge independently. The harness launches neither.

Original manifests remain immutable. Add an adjudicated sibling named
`manifest.adjudicated.json`, with the same facts plus:

```json
{
  "adjudication": { "revision": 1 },
  "judges": [
    { "judge": "claude", "pass": true, "violations": [] },
    { "judge": "codex", "pass": true, "violations": [] }
  ]
}
```

This is an illustration of the added fields, not a complete manifest. Both
judges must assess/pass every rubric item. Disagreement stays unresolved; obtain
new evidence/rerun rather than averaging. The analyzer allows the original and
adjudicated copy to coexist, but rejects changes to original run facts and
conflicting duplicate revisions.

Pin a green engine commit, Bun, model/CLI IDs and checker/price versions for a
checkpoint. C1 combines E1 deterministic checks, D × both agents, and G's twelve
task groups × both agents in runtime context (record the T09 split in the budget).
Scorers supply held-out cases. Randomize paired run order with a recorded seed;
this single-arm runner never silently selects an agent for a paid run.

The compact-guide gate adds B, seed 2 where runtime outcomes differ, and source
spot checks T02/T05/T06/T07 × both agents × both arms. Compare G-only directories:

```sh
bun evals/agent/analyze.mjs --A /path/to/A --B /path/to/B
bun evals/agent/analyze.mjs --A /path/to/A --B /path/to/B --json
```

Pairs use `(context, task, agent, seed)` after attempt/adjudication selection.
The table shows selected attempts; totals per arm and full attempt histories
remain available so survivor bias is visible. The analyzer rejects unresolved
infra, missing pairs, model/CLI/checker/engine mismatches, identical guide hashes,
unresolved rubrics and missing seed-2 follow-ups. All six merged rules apply:
zero B violations/no new class; task-group B−A lower 95% bound ≥−5 pp; no dual-agent
task collapse; ≥20% lower median guide bytes with no higher input tokens/failed
calls; retrieval ≥90%; source-spot B≥A. Partial usage cannot establish the cost
gate. The one-sided bootstrap uses 10,000 resamples and seed 460017. `pairedDelta`
is the task-group mean; `perRunDelta` is labeled separately. With about twelve
groups this bound is conservative: a single negative group can reject B even
when the per-run mean looks small. The threshold is not relaxed.

## Source contributor tasks

R01 and R02 are in the separate source-only catalog at
`evals/contributor/tasks`. The default T/D catalog and its scoring are unchanged.
The pinned `--commit` must support `THERMITE_CONTRIBUTOR_BUN` and `THERMITE_TEST_TIMINGS` in `scripts/test.mjs`.
Run the two references before scheduling one run per task for each agent.

```sh
bun evals/agent/run.mjs --agent reference --tasks-dir evals/contributor/tasks --all --context source --commit HEAD --checkpoint k-reference
```

For live runs use the same catalog and source revision with `--agent claude` or
`--agent codex`, the appropriate auth recipe above, and distinct checkpoint
names. A reference run evaluates the task infrastructure without a model.

Contributor checkers run the delivered checkout's tests and build, which is
agent-written code, with the harness user's privileges. This is a deliberate
exception to the post-agent boundary; see E2 1.20.5.

- R01 creates a linked Git worktree, runs `bun install --frozen-lockfile` in that
  worktree, runs `bun scripts/test.mjs packages/query/test/views-and-ordering.test.ts`,
  and rebuilds with `bun run build`. The checker verifies Git registration and
  the local installation, and binds the actual command results to executed
  Vitest cases and fresh build artifacts. The setup warms only the isolated
  Bun cache. Each installation belongs to its own checkout.
- R02 starts with a fixture-only regression on a documented CLI path. Its
  brief gives a reproduction and the expected result. The checker reruns
  focused tests, checks the built CLI independently, and uses the TypeScript
  structure to verify that the repair stays in scope. Scratch files are
  ignored unless tracked or imported into the repair.
- The editable checkout's Git history starts at the seed. The supplied runtime
  omits the corresponding clean source and emitted maps. Its compiled CLI
  remains available to the evaluator.
- Both tasks request a local friction report. The Bun observer records command
  outcomes and binds them to test results and build artifacts. It normalizes
  relative and absolute test paths, `--cwd`, and the `bun i` install alias.
  The test wrapper records focused runs from direct Bun calls. For direct
  builds the checker combines a successful tool transcript entry with
  content digests from a fresh TypeScript emit. The observer log lives in
  a writable run directory. Version 1 trusts agents to leave the receipts intact.
- Reference `totalToolCalls` counts five calls for R01 and seven for R02,
  including writing the friction report. R02 diagnoses the focused failure,
  edits the source and verifies the rebuilt CLI. Shim `thermiteCalls`
  remains zero for both tasks. The same V1–V8 scoring and byte-identical
  contributor guide-copy rule apply.

C-01…C-30, R03/R04 and held-out H1/H2 remain unimplemented or scorer-owned slots.

Eval **1.9.0** changed D tasks to 1.5.0 and T07 to 1.2.0: C-COIL includes the
frozen brief's overload; D appendices state the existing structured PSU-feed
exception; a harness-owned Playwright file:// broker captures project HTML
without a sandbox daemon; and T07 declares library acquisition paths. Frozen
brief bytes/hashes are unchanged. Task/checker changes require previous-engine
replay under this version before collecting the current-engine comparison.
Retain old-version history separately; do not silently rescore original runs.
Run the complete reference sweep on the previous checkpoint first. No model,
scoring-gate or two-judge requirement is weakened.

T07's exception permits only literal GET acquisitions from
`libraries/field-interfaces/` and `libraries/industrial-pilot/` on the
BlackettApplied/3MUl0R ThermiteSchematics GitHub contents/raw endpoints and scoped blob/tree URLs.
`metrics.libraryAcquisitions` retains these observations separately. The permitted GET URL is separated from the command remainder, which is still scanned for engine-source reads. Quoted URL query strings and `--jq` response filters are parsed as arguments, not shell pipelines. Other tasks,
local engine reads (including aliases), root listings/clones, searches,
implementation/docs paths and sibling libraries still count as
V8. This permission is task metadata, not a general source-read waiver.

For D-conveyor visual work, the agent writes `visual-capture.request.json` with an `html`
array of 1–4 project-local HTML paths. The running harness writes PNGs and a
hash-bound receipt to `visual-captures/` in the live evidence, which is outside
the sandbox's writable roots and linked from the project. The receipt is absent while a capture runs and lists
only the images that capture produced. Wait for it, then open the listed images
and record findings; crops belong elsewhere, such as `work/`. Chromium loads
project `.html` snapshots and inline `data:` URLs. Separate CSS, SVG, image and
font files, network resources and JavaScript are blocked. Pages load from a
virtual origin, so local HTML subresources use paths relative to the page or to
the project root. Capture is refused on Windows. Errors remain
explicit, and capture alone never passes visual review or PDF V1/V5. No Claude
credential is required. The regression test launches the actual pinned browser;
a non-model sandbox probe should verify request/PNG access before paid D runs.

Eval **1.10.0** moves T07 to 1.3.0 and corrects the follow-up acquisition false positive for downloading
then reading that exact local output. It also fills a previously empty Codex
web-search start event from the completed request, preserving engine-source
read detection. Both changes have negative controls for implementation reads,
extra local reads, repository searches and write requests. Original 1.9 runs
remain immutable; any scorer replay is labeled with its new identity/version
and provenance. The project guide's explicit requirement to check issues also
permits GETs to the official repository's issue list, individual issues and
comments, retained in `metrics.issueLookups` for every runtime task, as required
by the shared project guide. This does not permit write requests,
code searches, pull-request diffs, contents/code endpoints or GraphQL queries.
Quoted `cat > report.md` here-doc bodies are authored Markdown, not source
requests; executable/unquoted here-docs and real reads outside those reports
remain scanned. A report executed later in the same shell event is not exempt.
The D cable-listing checker now resolves the listing's declared designation
and UID in manifest-listed cable sources, then compares its full data with a
fresh query. Source object order does not choose the cable. Forged, stale,
unlisted or non-cable identities still fail.
Replay the prior checkpoint first, then collect affected T07
runs under the same version. This is not a scored mixed-version checkpoint.

## Verification

```sh
VITEST_MAX_WORKERS=2 bun run test -- evals/agent
VITEST_MAX_WORKERS=2 bun run check
bun evals/agent/run.mjs --agent reference --all --checkpoint references-new
bun evals/agent/probe-sandbox.mjs --runtime evals/out/agent/references-new/context/engine
```

The optional sandbox probe needs a local Codex CLI, but makes no model call. It
compares direct/shimmed validation inside the Codex workspace sandbox. An
unwritable lock path must exit 2 without CLI stdout and record a `lock` marker
within 10 seconds. A separate failed log append, with a writable lock, must
preserve the direct CLI's streams and exit status and record a `logging` marker.
Normal tests use synthetic transcripts, fake auth CLIs, policy negatives and an
offline reference pipeline smoke test with checker-only recovery. Run that test
on its own from a built checkout.

```sh
VITEST_MAX_WORKERS=2 bun run test -- evals/agent/runner.test.mjs -t 'reference pipeline rechecks' --no-cache --configLoader=native
```

Full reference runs prepare a pinned engine context. They, auth-readiness and
sandbox probes run separately from the normal check. Verification
timings and the final harness hash are recorded in the worktree's `PR.md`.
The synthetic closed-pipe fixture prints the kernel code and errno on one line,
because Bun's unhandled write stack can vary. Every exact errno
line naming `EPIPE` or `ENOTCONN`, with any signed integer, is canonicalized to
`pipe errno: <closed>` independently of the OS; every other stderr byte stays exact. The
separate real-CLI pipe test retains the CLI's own error handling and exit code.

## G3 replay and event provenance

At f0bfabd the then-current guide still permitted ordinary schema repair.
T3 changes that permission: eval 1.7.0 requires guarded schema repair and preserves
ordinary edits only for E002/E003 before-states. No model baseline existed at this
version change; the complete local references are rerun before comparing scores. Required retrieval IDs now use `agent-requests` (formerly
requests) and `report-filtering` (formerly reports), matching G3's topic index.
The D briefs remain byte-for-byte frozen; appendices reflect the profile requirements and decisions 26–27's onboard-AI sharing and current-core gap inventory.

See [event provenance](fixtures/events/README.md) for verified versus inferred
CLI shapes. The earlier gpt-5.4 capture was rejected for ChatGPT login
(model_not_found). Decision 15 approved the new pins above. Exactly one further
trivial Codex capture with gpt-6.1-sol/xhigh succeeded: thread.started →
turn.started → item.completed (agent_message) → turn.completed with usage.
It returned OK with no tools. Recovered retry sequences remain synthetic.
Claude's isolated auth was unavailable and no Claude model call ran.

## Follow-up protocol evidence

Decision 17 quota/billing behavior and decision 18 terminal-cause behavior have
synthetic regressions only; no model ran for this follow-up. Retry hints accept
structured retry_after/retryAfter and millisecond variants, HTTP Retry-After
headers (seconds or dates), reset timestamps (seconds, milliseconds or ISO), and
request/token reset-duration headers. Missing hints use exponential backoff.
Readiness checks do not establish model availability. Blinding removes xhigh and
agent/CLI version strings while preserving PLC terminals and engineering values.
V8 includes gh GraphQL repository queries, gh search code repo selectors and gh
browse repo selectors; unrelated repositories remain negative controls.

## Terminal errors and recorded adjudication

See [captured protocol evidence](fixtures/cli/README.md). Codex 0.164.0 emits
sentences in its terminal event; the captured full-field templates are protocol
data for that exact version. Agent output and nonterminal prose are never
matched. content_filter has a separate captured agent-outcome template and is
not a network failure. Unknown terminal messages or an unpinned version enter
`needs-adjudication`, are incomplete/unscored, and block final analysis even if a
later rerun completes. Plain CLI crashes without a terminal error remain
unstructured infra. No sentence templates apply to another version.

The first `needs-adjudication` also **halts the batch**. An ordinary resume
starts no agent while any checkpoint record remains unresolved, even if another
task was selected. Adjudicate the record, then resume: infrastructure permits
another attempt; an agent-failure decision keeps that failure and proceeds to
the remaining keys. A batch warns at startup if its CLI version is not pinned.

`--reopen-infra <key|all>` permits another attempt for an unresolved key, retaining
the unknown original. Until adjudication, an explicit reopen is limited to those
unresolved keys, leaves the checkpoint unscored and exits nonzero; it cannot
authorize unrelated keys. It does not adjudicate or replace that original. To record
an operator decision without changing the original manifest:

```sh
bun evals/agent/adjudicate.mjs --run <attempt-directory> --resolution infrastructure --reason "Reviewed the terminal event" --operator <reviewer>
```

The other resolution is `agent-failure`. The hash-bound, write-once
infra-adjudication.json sidecar records who, why and when. Infrastructure remains
incomplete and permits a later run; agent-failure becomes a completed failure
and the first-complete rule applies. No decision can declare a pass. A sidecar
with mismatched original bytes is refused. Analysis reads the sidecar for both
original and rubric-adjudicated manifests, reports decisions/reopens/shutdown
warnings, and blocks every unresolved record. Stored facts remain immutable.

Operator SIGINT/SIGTERM produces `interrupted`, even after successful agent
completion; resume reruns it. A task still in setup when another task halts the
batch becomes `not-started` at the final spawn gate. Neither state consumes the
transient retry budget or counts as a completed task.

Setup subprocesses (init, lock, git, auth, boundary validation and CLI versions)
are asynchronous. Task setup hooks run in a worker, including hooks that use
synchronous helpers; their contract is filesystem setup through the supplied
context, not mutation of the parent process's globals. This lets a sibling exit
be classified during setup, before the spawn gate.

Claude keeps the strongest cause within a no-progress window (billing > quota >
rate limit), and the latest reset. Progress or accepted active overage resolves
pending quota/rate conditions. A specific terminal agent cause still decides.
Overage-use booleans take precedence over overageStatus; when absent, allowed /
allowed_warning overage status indicates the accepted overage path. The five
new enums and the actual local 529 envelope are covered by fixtures.

Bare `success/is_error` and `error_during_execution` results are generic wrappers,
not known agent causes. Without a typed cause they require adjudication; an
earlier `invalid_request` or other typed cause survives either wrapper. Progress
clears the pending cause. `terminal_reason` is not mapped. The two real Claude
captures used API-key mode with a loopback ANTHROPIC_BASE_URL; the first-party
OAuth error path remains unverified.

Eval 1.11 separates a permitted literal GET URL from the rest of a shell event.
Local response formatting (including a Bun JSON summary) does not turn that
URL into engine-source access. The remainder is still scanned: a subsequent
engine read or another prohibited URL remains V8, alongside the acquisition
observation. POST/config/dynamic fetches remain unrecognized and flagged.
This is a transcript policy, not an execution sandbox. Replays retain the
original collection identity and write derived records separately.

Eval 1.12 removes one redundant blank line from each D appendix/prompt and
keeps task.json exactly synchronized (D tasks 1.5.1). Frozen briefs and scoring
semantics are unchanged. Previous-engine reference and derived artifact replay
still precede current-engine replay; old model collection versions are retained.

Eval 1.13 added mixed-search negatives; its denylist was superseded by 1.14
below. Historical 1.9/1.10 collections and derived 1.12 replays retain their
identities. Their recorded issue searches contain no mixed references.
Capture routing also canonicalizes project roots, including macOS `/var`
aliases. Contributor fixtures use a root-only private Git `info/exclude` entry
for linked dependencies; the engine's `node_modules/` rule still permits an
ordinary source file with that name.

Eval **1.15.0** introduced a classifier that classifies each tool call once as `issue-lookup`, `source-read`
or `other`. It replaces the independent URL-source detector and issue exemption.
Structured fetch tools use only their URL, never their prompt; search tools use
only the query and explicit repository scope. Shell GET requests parse literal
curl/wget/gh argv, headers and flags. Unknown flags or dynamic commands cannot
acquire an exemption. Local engine reads or a second source access dominate an
otherwise permitted issue fetch.

URLs are iteratively percent-decoded, Unicode NFKC-normalized and lowercased,
with IDNA/fullwidth-dot folding and WHATWG dot-segment resolution. GitHub hosts
(including API, raw, codeload, objects, user-images and gist) and unrecognized
GitHub tools default to source reads. Malformed encodings cannot hide a visible
GitHub host. Normalization is classification only; it never executes input.

Search tokens retain the 1.14 allowlist: plain words/whole quoted phrases or
`site:github.com/<owner>/ThermiteSchematics/issues`,
`repo:<owner>/ThermiteSchematics` paired with `is:issue` or `is:pr`, and
`in:title,body,comments`; owners are `BlackettApplied` and `3MUl0R`. Boolean
operators, URLs, unknown operators, hosts, dots and path separators are refused.
Refusal produces ordinary/source classification, never an execution error.

Fetched HTTP(S) URLs must have no credentials/nondefault port and exactly match
GitHub issue/list or numbered PR conversation paths, or their REST equivalents
(including issue comments). Files, commits, diff/patch suffixes, raw/plain/diff
parameters and path-bearing fragments cannot acquire an exemption. Metadata
query keys remain limited to `state`, `page`, `per_page`, `sort`, `direction`,
with fixed values and no duplicates. Numeric issue/comment anchors are allowed.
Shell issue requests accept no header override or only `application/json` and
`application/vnd.github+json` Accept values; diff, patch and `.raw+json` media
are refused. Literal `gh issue view`/`gh pr view` requests with explicit repo and
number use the same conversation URL policy. Their `--json` fields are limited
to conversation metadata; files/commits are refused. T07 alone still permits GET of its
declared optional-library paths, including their raw JSON representation;
engine paths never receive that permission.

All 12 retained transcripts are rescored before/after without rewriting their
collection identities. Eight have identical full transcript metrics. Newly
structured MCP issue searches add two issue lookups to prior D-pump, three to
prior T07-fresh and one to current D-pump. Current D-conveyor adds one source
read: its MCP query has `repo:` without the required `is:issue`/`is:pr`. Every
other metric is identical. Original manifests/transcripts and historical replay
files remain unchanged; these are Codex-only replays, not a category score.

Eval **1.16.0** introduced the capability-based policy superseded by 1.17 below.
It replaced 1.15's incomplete
compound-command and unknown-network handling. V8 measures honest agents' natural
source-reading behavior; it is **not a sandbox**. Plausible honest forms must be
classified correctly. Anything not fully understood never earns an issue
exemption; if it might reach the network it counts as a source read. Static
classification cannot defeat deliberate obfuscation in general. Opaque IPs,
redirectors and novel encodings are limits: they never earn exemptions, but
static scoring cannot establish where they ultimately connect. Runtime egress
logging is the actual adversarial control, tracked separately by the helm;
this scorer does not implement it. Under the helm's stopping rule, subsequent
obfuscated bypasses are follow-ups; plausible honest misclassifications or
legitimate-lookup regressions remain blocking.

An issue exemption requires one fully parsed simple command. Compound operators,
newlines, subshells, variables/expansions, backticks, env-prefix assignments,
interpreter redirects and heredocs cannot earn it. The sole compound exception
is a literal GET writing a named output, followed by exactly one `bun -e` program
that reads that same output with `Bun.file(...).json()` and prints a JSON
projection of direct object fields. The whole program is matched; extra code,
other input files, additional commands and download-then-cat are refused.
Unrecognized network-capable curl/wget/gh/git or interpreter eval/command forms
count as source reads, including failed tokenization and quote-spliced targets.
Known literal shell transport wrappers are inspected as commands; local client
discovery, version checks and simple built CLI commands remain ordinary local calls.
Unknown transport bodies retain the interpreter's network risk. Quoted Markdown
report data remains distinct from execution and never creates an issue exemption.

URL normalization strips ASCII tab/LF/CR throughout and trims leading/trailing
C0 controls and spaces, as WHATWG URL does; it does not turn them into spaces.
Existing decoding/NFKC/IDNA and exact issue path/media restrictions remain.
`gh issue view <full URL>` and both `--json fields`/`--json=fields` forms are
supported with the same fixed conversation-field set. Any server or tool name
containing `github`, with any casing/separator, defaults to source-read. The
fixed MCP operation allowlist is `fetch`, `search_issues`, and `issue_read` or
`pull_request_read` with `get`/`get_comments`; arguments are scoped to their known
fields. Unknown operations, methods or overrides receive no exemption.

All 12 retained transcripts are rescored against 1.15 before 1.16, previous
checkpoint first. All **19 issue/PR lookups keep their class**, including the
recorded JSON formatter. Eight runtime records change conservative source
counts for unknown network-capable shell calls; the four contributor-context
records are identical. Four prior T07 GET-then-cat calls lose their library
exemption under the compound rule; simple permitted library GETs and the exact
JSON formatter remain allowed. These defaults are not proof of actual source
fetches. Original evidence/replay identities and hashes remain unchanged;
Codex-only replays are not category scores. REPORT.md contains every record's
delta and event-level explanations.

Eval **1.17.0** corrects that overbroad policy. V8 remains an honest-agent
behavior metric, not a sandbox. Shell commands that tokenize statically are
split on unquoted `&&`, `||`, `;`, `|`, background separators and newlines. Each
part uses the same request classifier; aggregation takes source-read above
issue lookup/library acquisition above other. A source part suppresses both
issue and library credit for the whole call. Otherwise each observation is
credited once per call. GET-then-cat, jq and sed parts are allowed again.

Network defaults require **text evidence**, not executable capability: a
network-tool invocation with an unlisted/dynamic target, an executable inline
or heredoc body with network API evidence and a GitHub fragment/dynamic target,
or an unresolved GitHub host fragment. Hosts/fragments are canonicalized with
quote/escape removal, including split/concatenated GitHub spellings. Known Git
network operations are distinguished from status/diff. File tools, the runtime
CLI, filesystem-only interpreter bodies and the agent's local scripts are
other, subject to the unchanged local engine-path checks. Data-writing heredocs,
printed strings, schema URLs and local request collections do not become
network calls. Known code written and executed in the same call is inspected;
unknown local scripts are not opened or assumed to network.

Structured fetch URL extraction, WHATWG whitespace/IDNA handling, issue paths,
JSON-only Accept and fixed GitHub MCP operations remain unchanged. All r2–r5
reviewer bypass fixtures remain source reads. Opaque targets, redirectors and
novel obfuscation remain static-analysis limits; the separate runtime-egress
issue is owned by helm, not implemented here.

The suite retains every **184 r6 false-positive command record** as an `other`
fixture (182 distinct command strings), with phase/task/event provenance. All
12 retained transcript metric objects rescore **identically to 1.15**, with no
remaining delta or new source reads. All 19 issue lookups preserve their class;
all four prior T07 library acquisitions are restored. Original collection and
replay identities/hashes remain unchanged. These are Codex-only transcript
replays, not new model/checker runs or a category score.

Eval **1.18.0** fixes four natural shell forms. Repository download tools
(`degit`, `tiged`, `giget`, including npx/bunx/`bun x`/pnpm/yarn dlx wrappers)
with repository arguments count like clones, including implicit GitHub
`owner/repo` targets. Literal interpreter GET arguments use the same URL/header
classifier as curl, including issue and permitted-library observations. Dynamic
or spliced targets and unparsed network options receive no exemption. Local
`gh` help (`help`, `--help`, `-h`) and `git help` are other. `git archive` is
local without `--remote`; remote archives retain the network default. The
unchanged local engine-path guard still takes precedence.

The eight r7 reviewer probes and natural variants are fixtures; two older
synthetic interpreter-fetch tails now correctly suppress issue credit. All 12
retained transcript metrics still match 1.15 exactly: no deltas, all 19 issue
lookups preserved, and all 24 library acquisitions retained. Original evidence
identities/hashes and task versions are unchanged. These remain Codex-only
transcript replays, not new model/checker runs or category scores.

Eval **1.18.1** fixes the C1 T07 false V8 on a permitted curl GET with
`-w '%{http_code}'`. The fetch parser recognizes client-specific options,
including literal write-out formats, header dumps, bounded-time and retry
options, and grouped short flags. It also accepts the reproduced Wget
header-display and grouped output flags and `gh api --jq=...` formatting.
Only a static HTTP(S) GET can earn a fetch exemption. HEAD, body or upload
options, config files, curl URL globbing and unknown options fail closed.
Shell brace lists and ranges also fail closed in fetch arguments. Quoted or
escaped braces and the plain `%{http_code}` format remain literal.
Existing URL scopes and Accept-header checks still apply.

Read-only replay of all 11 retained C1 attempt transcripts changes only the two
literal curl write-out GETs in Claude T07. Source reads per that transcript
fall from four to two, and library acquisitions rise from zero to two.
Issue lookups and original records stay unchanged.

## E2 1.19.0

Replay retained runs under each measurement version and keep the collection
records immutable. Scoring now pairs the pinned Codex GitHub connector's typed
repo-scoped issue or PR search with its matching completed result. An explicit empty
issue list is a completed conversation search. File paths and bare raw-file or
contents-API URL mentions in conversation text keep the issue lookup. Fenced
blocks and top-level CommonMark indented code blocks after a blank line count as
V8, even if a block contains only a path. List continuations and quoted log
lines stay conversation text. Code blob links and explicit Markdown links to
raw files or contents endpoints still fail closed. Requests for raw files,
contents endpoints, `search_code` or `in:file` still count as V8, subject to the
existing optional-library GET allowlist. Missing, mixed and unexpected
structured receipts stay fail-closed.

A matching pre-execution approval denial is recorded in
`metrics.attemptedWrites`, apart from V8. An executed or unverified recognized
write remains fail-closed and retains its attempted-write record. The
inert Markdown rules below apply to literal quoted heredocs.

The dogfood checker recognizes conductor ink in regenerated schematics for
change-row evidence and reports coverage independently of the required
matrix (D tasks 1.6.0). T04 1.2.0 explicitly asks for the missing 0 V
destination to match its rubric.

Required topic declarations pin a source edit, guarded patch, real render,
review, diagnostic report or the task's explicit branch. The scorer records
the legacy exact-command result alongside the new result, the cutoff and the
timely read or equivalent topic. Help, malformed requests and undeclared
equivalents earn no timely credit. The T07 hookup topic is inapplicable when
the checker accepted the issue-only branch and no hookup request was made.

Recognized GitHub write attempts count regardless of execution status. A
matched pre-execution approval denial is recorded separately without V8.
Other recognized writes still score V8 in runtime context. An explicit
`gh api -X GET` or `--method GET` keeps `-f` and `-F` fields read-only. A
literal `search/issues` GET with a scoped `q` field or an allowlisted issue
endpoint with supported pagination fields can earn issue credit. Unscoped
searches, unsafe fields and unsupported headers still fail closed. Without
an explicit method, gh API fields imply POST and count as an attempt.

Shell write accounting covers mutating curl/wget requests to github.com,
api.github.com and uploads.github.com, the recognized gh mutation verbs and
git pushes with a literal GitHub remote. Literal commands under `sh -c`,
`bash -c`, sudo and xargs are inspected. Interpreter heredocs are scanned
for recognizable literal child commands and mutating API calls. GitHub
connector operations beginning with `get_`, `list_`, `search_`, `read_` or
`fetch_` are reads for write accounting alongside the explicit read
allowlist. Issue credit still requires one of the existing allowed
requests or a verified conversation search. Unknown connector verbs count
as attempted writes. Scorecard summaries report attempts per agent and G/D
set. The D counts gate requires zero attempts from prompt version 1.6.0.

Quoted Markdown heredoc output stays inert during copies, moves,
inspection, ordinary sed processing and git add, diff, commit or show.
The scorer follows literal copies and moves, data redirects and sed write
destinations in the same or later shell calls. The body stays in scope if
it reaches an interpreter, source/`.`, shell command expansion, xargs, a
pipe into an interpreter, sed execution or direct file execution. A
Markdown append needs a verified successful command to establish authored
data. These rules track literal shell activity and its transport wrappers.

C-CHANGE requires a nonempty subject list from D-conveyor prompt 1.6.1.
The requirement was not in force for older prompts. Listed wires are
matched by UID against the applied patch and regenerated schematic evidence.
T04 1.3.0 asks where PX1's unconnected 0 V terminal should connect.

One successful `project-workflows` read can credit several D topics when
their declared equivalences and individual cutoffs are satisfied.

## E2 1.19.1

C-CHANGE and P-CHANGE match applied wire UIDs to painted schematic paths. The checker
recognizes standalone wire paths and the circuit, wiring and signal-loop
conductor groups emitted by the renderer, including nested route paths. It
uses the renderer’s SVG geometry reader for transforms and rectangular clips.
A label, sheet reference, white halo or fully hidden, clipped or zero-length
path supplies no wire ink. The recorded prompt version still controls whether
the C-CHANGE subject list must be nonempty.

This is a generated-SVG check. Route colors come from the renderer palette
and generated dash lengths are positive. Near-white `#fefefe`, zero-length
dash patterns and exact viewport-edge runs are outside that output contract.
The centerline check credits a positive-length run along the viewport edge,
where part of the stroke remains visible.

The checker identity includes the complete renderer `dist` tree, including
transitive helpers. Checkpoint creation, normal runs and checker-only rechecks
use that identity. Replay retained inputs under both checker versions and
preserve the original manifests.

## E2 1.19.2

The classifier parses literal local shell output redirects, appends and
descriptor duplication separately from the fetch arguments. An allowlisted GET
still counts as an acquisition, and an engine-source GET still counts as V8.
The project snapshot checks still record writes to guarded project files,
including writes made through a redirect. Dynamic fetch targets retain the
existing fail-closed classification.

T07 checks the delivered hookup PDF in `drawings/` under its actual filename.
The successful print command must reproduce the PDF byte for byte from the
final project. The PDF must contain at least one signal-loop, wiring or circuit
view, as verified by regenerated metadata. The checker keeps the accepted PDF
path as evidence.

## E2 1.20.0

Eval **1.20.0** qualifies the source-contributor R01/R02 tasks at version 2.0.1. Their own installations, observed test/build outcomes, fixture-only seed and negative checker controls support measurement for either agent. Existing T/D rules and task definitions are unchanged.

## E2 1.20.1

Contributor scoring verifies the linked worktree through its Git
administrative directory and checkout backlink. It compares local evidence
using native filesystem path rules, including Windows 8.3 aliases in temp
paths. The direct Bun fallback preserves Windows path separators in command
receipts. T and D scoring is unchanged.

## E2 1.20.2

R01 accepts the focused test and build in either order after checkout setup.
Both observed and direct builds earn credit only alongside a passing focused
test and artifacts that match the delivered source. R02 also binds the focused
test to the delivered repair's source digest. The focused observer selects
`vitest.config.mjs` explicitly and forwards test-name patterns, color and silent flags.
Unsupported arguments, including configuration, root and report overrides,
run unchanged and are recorded without workflow credit.
Direct-build verification reads the TypeScript version from the pinned Git
lockfile. It uses the harness compiler when the versions match or the pin
cannot be read. A different pinned version runs from the prepared dependencies
in a child process. Evidence records the compiler source, version and execution mode.

## E2 1.20.3

D-conveyor prompt 1.6.2 describes the visual broker’s output link, its
resource limits and receipt polling.

Playwright and Chromium no longer read or write the eval workspace. Chromium
runs with a fresh profile in the harness home and loads a virtual origin. That
origin serves only verified bytes of project `.html` files, each read once per
request. `data:` URLs still load, and every other request is blocked. The
receipt hashes the main HTML bytes served to Chromium and the in-memory PNG.

These boundaries hold only for a sandboxed agent, which today means Codex.
Claude-agent runs bypass permissions as the harness user, so they have no
filesystem boundary: the agent can change anything the harness can, including
evidence and capture outputs.

A sandboxed agent can write the run directory, because it is the agent's TMPDIR
and lies under `/tmp`. Live evidence is therefore a separate directory in the
harness home, outside the sandbox's writable roots, and is copied to the
evidence output and removed when the run ends. The no-model probe
(`probe-visual-sandbox.mjs`) records that the sandbox can write the run
directory but cannot write live evidence or the capture outputs. A detached
descendant still running after the sandboxed command exits reports a
permission error when it tries to write evidence. For the same reason, the CLI
refuses a Codex run whose evidence archive under `evals/out/agent` resolves
inside `/tmp` or the system temporary directory, so run Codex evals from a
checkout outside them.

The broker publishes into `visual-captures/` in the live evidence, and links
that directory into the project before the agent starts; an existing
`visual-captures` entry is refused. Each capture removes the old receipt before
rendering, then replaces the images, writing each PNG under a temporary name
and renaming it into place. It checks every PNG against its hash and writes
`result.json` last, so the evidence never holds a receipt without its images.
The link is removed when the agent exits. The evidence receipt is now
`visual-captures/result.json` beside its images, replacing
`visual-capture.json`. The capture format remains
`thermite-agent-visual-capture/1`.

On macOS and Linux, the broker reads project files with descriptor-relative
`openat` calls and `O_NOFOLLOW` on every component. It starts from a project
descriptor opened before the agent starts. Input files must have exactly one
link, so a second name for an outside file is refused. This relies on the
agent being unable to remove that file’s original name. Node offers no
descriptor-relative open on Windows, so capture is refused there with an
explicit error receipt.

## E2 1.20.4

After a sandboxed agent exits, the harness reads its project and runs the CLI
with the harness user's privileges. This release confines the paths named
below: the judge packet, the source diff, the guide size, and the CLI runtime,
Bun configuration and environment of post-agent calls. Other post-run reads
and writes still use pathnames the agent can change. These include
snapshots, source and library document reads, the compiler's own reads during
validation, checker reads and regeneration, the shim's audit files, project
archival and the Codex auth refresh. They are pending follow-up work for #491.

E2 agent runs and rechecks are refused on Windows before any setup, launch or
evidence write. Node offers no descriptor-relative, no-follow open there.

Before the agent starts, the harness opens the project root and keeps that
descriptor for the run. Judge packets read deliverables and the `drawings`
directory from it with descriptor-relative reads that follow no links and
take no `..` components, as the visual broker does. A linked or otherwise
unreadable output is left out of the packet and its path is listed in
`refusedOutputs`; a linked or unlistable `drawings` directory is listed as
`drawings`. If the root itself was replaced or cannot be inspected, the run is
still scored and the packet takes nothing and lists `.`. If no directory is
at the root's path after the agent exits, because it is gone or a file or link
took its place, no project-dependent step can run: the
run is an infrastructure failure and is not scored, and a rubric run's packet
still takes nothing and lists `.`. The packet format is
now `thermite-blinded-judge/1.2`. Guide bytes count the `AGENTS.md` present at
launch, measured from the harness's copy, and rechecks reuse the recorded
count.

The agent's runtime copy sits in its TMPDIR, which a sandboxed agent can write.
Post-agent CLI calls (the final flush, file-state validation, the checker and
rechecks) run a second copy of the prepared engine, made after the agent exits
in a scratch directory in the harness home and removed when the run ends. Bun
reads `bunfig.toml` and `.env` files from the working directory, so each of
those calls names the harness's own config, which disables `.env` loading, as
its own argument. Their environment is one the harness builds: no credentials,
no contributor command directory, and a home and TMPDIR in that scratch
directory. The run's before-and-after runtime hash comparison still reports a
changed runtime as a V5 violation.

The source diff no longer runs Git in the agent's repository, whose
configuration and attributes can name programs to run. Before launch the
harness copies the project's regular files into the scratch directory. After
the run it reads the selected paths through the pinned root and runs
`git diff --no-index` on the two copies there, with no Git configuration,
attributes or repository. The selection covers sources, the manifest, the
presentation and library documents present before or after the run. Paths are
labelled as before, with Git's quoting. A deleted file now appears as a
deletion; staging every path hid it before. A file replaced by a directory, or
the reverse, appears as a deletion and an addition, provided every component
on the way is a directory reached without a link. A selected path that is not
an ordinary file, or is reached through a link, is listed as refused.

`recheck.json` records the project root's identity, and a recheck refuses a
different root. Rechecks take the prepared engine from the checkpoint's context
and stage checker receipts in protected scratch, never in the kept run
directory. Runs recorded before 1.20.4 cannot be rechecked.

Contributor-task checkers are a deliberate exception. They run the delivered
checkout's own tests and build, which is agent-written code, with the harness
user's privileges. Holding them to the same boundary would need a sandbox for
the checker itself.

## E2 1.20.5

The harness pins the audit, project and runtime roots before launch. The
post-run flush reads the shim log, error log and state through the audit
descriptor and stages their bytes in the harness home. Refused inputs produce
`audit-input` errors. The shim locks the audit directory descriptor. Process
exit releases the lock. Audit writes use no-follow opens of existing regular
files, and the CLI observer receives the capture files as open descriptors.

The project archive contains the regular files copied through the pinned
project root. The copy excludes Git metadata, links, special files and
unreadable entries. Scored run manifests list refusals in `projectRefusals`.
If another directory replaces the project root, the manifest records
`projectRefusals: ["."]`. Validation and electrical task checks use an empty
snapshot, and the evidence has no project archive.
The runner uses this protected snapshot for validation, final file state,
source diffs and electrical task checkers. Source and library lookups resolve
through the confined reader. If a manifest library path, presentation path,
or expanded source glob escapes the snapshot, the runner records a scored
`task-failure` with reason `snapshot-scope` and skips the privileged compiler
and task checker.

Checker regeneration copies the captured project into checker evidence.
It reads delivered artifacts through the confined reader and rebuilds view
and packet invocations from supported options in the staged audit. It resolves
request files within the checker copy or uses request bytes captured in the
audit. The checker chooses the project root and output paths.

A recheck captures the kept project again and verifies its file hash and
refusals against the original receipts. It reuses the protected audit and the
original post-run runtime hash. Runs recorded before 1.20.5 cannot be
rechecked. Workspace cleanup removes entries relative to its pinned directory
descriptor. A cleanup failure records the workspace and `cleanupError`.

The SEC1 sandbox model still applies. Sandbox enforcement comes from Codex.
Contributor checkers retain their separate live checkout behavior, including
Git worktree inspection and running submitted code. A checker sandbox and a
confined representation of Git worktree and install receipts are separate
work needed to extend this boundary to those tasks.
