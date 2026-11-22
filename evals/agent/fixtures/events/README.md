# CLI event evidence

Fixtures are small synthetic transcripts, except for the anonymized captured
Codex success envelope. They contain no credentials or private conversation
text. Retry sequences test compatibility, not a claim that a rate limit was
deliberately induced.

Verified locally on 2026-11-04:

- `codex-cli 0.164.0` help exposes `exec --json`. Its installed binary contains
  `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, item events,
  `error`, and the `Reconnecting...` retry text.
- One authorized trivial Codex request used the existing eval auth-only route,
  fresh configuration and the committed `gpt-5.4` model pin. It exited 1 because
  that model was unavailable for the ChatGPT login route. Actual events were
  thread.started → item.completed (metadata warning) → turn.started → error →
  turn.failed. Both error envelopes wrapped a provider JSON object in a string
  message: status 400, invalid_request_error, code model_not_found. The terminal
  fixture preserves this structure with anonymous identifiers and short text.
- Offline `codex app-server generate-json-schema` confirms camelCase
  codexErrorInfo, rateLimitExceeded, usageLimitExceeded, httpConnectionFailed and
  httpStatusCode in that protocol. These are compatibility inputs; app-server
  schemas do not prove exec uses identical fields. Existing snake_case shapes
  remain accepted as inferred compatibility variants.
- Claude Code 2.1.280 help exposes stream-json. The installed native binary's
  string pool contains assistant/provider identities authentication_failed,
  rate_limit, billing_error, server_error, result subtype error_during_execution,
  and rate_limit_event. Exact JSON field placement and recovered rate-limit /
  successful result sequences are inferred from the existing harness fixtures and
  review examples. No installed unbundled agent SDK schema was found.

Decision 15 approved a second, separately authorized trivial Codex capture with
`gpt-6.1-sol` and explicit `-c model_reasoning_effort="xhigh"`. On codex-cli
0.164.0 it exited 0 with thread.started → turn.started → item.completed
(agent_message text OK) → turn.completed (usage fields input_tokens,
cached_input_tokens, output_tokens). No tool calls occurred. The anonymized
`codex-success.jsonl` fixture preserves the captured field layout. Local exec
help verifies the TOML `-c key=value` override mechanism; the installed binary
contains model_reasoning_effort. Offline debug prompt-input accepts the explicit
setting (but also accepts an unknown effort, so that check alone does not prove
validation). The successful invocation used the exact explicit xhigh argument.

Claude's isolated auth status was not authenticated; no Claude model call ran.
Codex reconnect/recovered retry ordering, and Claude success/retry envelopes
remain inferred synthetic compatibility fixtures. Provider JSON is parsed as
JSON; domain prose containing words such as rate limit or connection is never
used as an infrastructure signal.

Reproduction logs and generated public schemas live only in gitignored
`evals/out/agent/`. Authentication uses the existing env allowlist/auth-only
CODEX_HOME; capture files are redacted with the harness credential filter.
