# Installed CLI protocol evidence

On 2026-11-05, the real installed **codex-cli 0.164.0** and **Claude Code
2.1.280** were run against a loopback-only HTTP server. Fresh homes/configs and
public dummy environment keys were used. No user auth file/token was loaded, no
request headers or bodies were logged, no external service was used, and no
model produced a response. Captures preserve the emitted error envelopes with
anonymous identifiers, ports, timestamps and paths. provenance.json records each
fixture's origin and hash.

Reproduce outside the normal check:

```sh
bun evals/agent/capture-cli.mjs --agent codex
bun evals/agent/capture-cli.mjs --agent claude
```

The tool binds 127.0.0.1 and configures only that provider/base URL, with dummy
keys, update/telemetry disabled and local proxies. It checks the installed CLI
version before exec and writes only under the specified --output directory
(default: gitignored evals/out/agent/cli-captures). It never copies credentials.
Codex request/stream retries are zero to capture the terminal envelope quickly;
the runner's later backoff is tested separately by replaying these captures.
Captures use UTC. Identifiers use `fixture-<field>` (including
`fixture-thread_id`); the relative `usage-today` reset date/time slot is
canonicalized to `12:00 PM`. These anonymous temporal fields, rather than the
current clock, make repeated JSONL capture outputs byte-identical. Capture proof
timings are intentionally not deterministic.

## Codex captures

- usage_limit_reached, usage-today, usage-no-reset, usage-pro and
  usage-pro-no-reset: HTTP 429 usage_limit_reached; fixed future/current-day or
  missing reset and plus/pro plan fields exercise the usage-limit formatter.
- usage_not_included: HTTP 429 usage_not_included; CLI upgrade-plan sentence.
- insufficient_quota: HTTP 429 insufficient_quota; CLI quota/billing sentence.
- rate-limit and rate-limit-no-id: HTTP 429 rate_limit_exceeded, with/without a
  request ID; CLI exhausted-retry sentence.
- disconnect: SSE response.created followed by EOF without completion.
- content-filter: SSE response.incomplete with reason content_filter. This
  deliberately resembles the network sentence but is an agent outcome.

Only **turn.failed.error.message** enters the version-pinned template matcher.
The duplicate error.message notice and all agent/tool content are excluded.
Every regex is anchored on the entire message, with a full-match length check
(including a trailing-newline negative test). Variable slots are limited to the
observed English date/time format and request-ID alphabet. Unobserved sentences,
ASCII-apostrophe variants and unpinned CLI versions require adjudication; they
are never guessed from words such as quota, rate or disconnected. Structured
provider JSON/codes still use their structured classification path.

## Claude captures versus synthetic enum fixtures

The two real captures used **API-key mode**, with a dummy ANTHROPIC_API_KEY and
the loopback ANTHROPIC_BASE_URL gateway. The first-party **OAuth error path is
unverified**. Account-condition enums remain synthetic schema fixtures, not
OAuth captures; no terminal_reason values are mapped from inference.

server-overload.jsonl is a real local HTTP 529 capture. This installed CLI emits
assistant.error=server_error plus result.api_error_status=529 and subtype=success
with is_error=true. The classifier handles this actual envelope as transient.

unknown-400.jsonl is also a real capture, from a local HTTP 400
invalid_request_error response. This installed gateway path emits assistant.error
unknown, followed by the generic success/is_error result. It remains unscored;
words in its message are not used to guess an agent or infrastructure outcome.

invalid_request-enum.jsonl is a synthetic installed-schema enum fixture that
confirms a known agent identity survives that same generic wrapper.

The five named account/provider enum files are **synthetic**, derived from the installed zod
assistant.error enum verified in the native binary: overloaded, account_on_hold,
oauth_org_not_allowed, verification_required, cloud_credential_error. They test
those exact structured identities; no claim is made that each account condition
was induced by the HTTP stub. Overloaded backs off. The other four halt as
configuration/auth infra. Subscription quota/overage sequences remain explicitly
synthetic compatibility fixtures, supported by the installed rate_limit_info
schema (isUsingOverage, overageInUse, overageStatus).

No live quota reset, billing account condition or recovery was induced.
