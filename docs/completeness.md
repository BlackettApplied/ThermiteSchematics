# Connection completeness

`validate` checks source consistency. `diagnostics` adds an inventory of declared
terminals and communication ports, with required connections, review notes and
component-model coverage. It reads the project without changing it.

These commands run in the default initialized starter project:

```sh
thermite diagnostics --project .
thermite diagnostics --project . --device PLC1 --json
thermite diagnostics --project . --location "MAIN-PANEL"
thermite diagnostics --project . -o audit.json
thermite diagnostics --project . -o audit.csv
```

Text groups warnings before information and includes source locations. JSON uses
`electrical-completeness/0.1`: counts, every selected device and connection,
findings, and the analysis limits. CSV includes connected points and a model
coverage row for each device. Device and location filters use exact names and
intersect when combined; an unknown or empty selection fails instead of looking
like a clean audit. Compiler diagnostics remain on stderr for the whole project,
even when the completeness inventory is filtered.

Exit 0 means the audit ran successfully, including warnings. Invalid source or
selection returns 1; usage or infrastructure failures return 2. Existing
`validate --strict` can make compiler warnings fail a check. The six guarded
agent commands retain their existing request and result contracts; an agent can
also invoke `diagnostics --json` to answer completeness questions. Core 0.2.0
uses reviewed generic interfaces: a fresh starter has no I003 or W904, but its
required PS1.L/N feed is deliberately deferred (W905), so strict
validation exits 1 until the feed is designed and its review is completed. The
fresh cabinets template exits 0 under strict validation. Connected required points
and reviewed generic coverage do not by themselves prove a safe design.

## Library requirements

Mark a terminal or communication port `required: true` when every instance needs
a connection. Terminal `role` remains a descriptive string; neither its spelling
nor a label such as `24V` silently makes a terminal required.

```json
{
  "terminals": {
    "P": { "role": "supply_positive", "required": true },
    "N": { "role": "supply_return", "required": true },
    "IN1": { "role": "digital_input" },
    "IN2": { "role": "digital_input" }
  },
  "connectionCoverage": {
    "status": "partial",
    "notes": "Signal and DC power terminals are modeled; protective bonding connector still needs review."
  }
}
```

This is a fragment of a device type. `connectionCoverage` is optional for older
libraries, but new contributions should declare it. All three statuses require
nonblank `notes`:

- `complete`: every physical terminal and communication port of the exact part
  was reviewed and modeled, including power, returns, protective earth, shields,
  connectors and optional interfaces. It does not mean every pin must be used.
- `generic`: the type models an abstract interface and its terminals were
  reviewed for that interface. It is not an exact part. I005 discloses once per
  device that actual-part terminals beyond the interface cannot be checked,
  including the authored notes. This is information in the completeness audit,
  like I003, and does not introduce a compiler warning.
- `partial`: the model omits connections of its intended interface or exact
  part; notes must explain what is missing. W904 remains a compiler warning.
  A generic type modeling only part of its own interface must stay partial;
  relabeling it generic does not complete that review.

Absence remains **unreviewed** (I003), never silently complete. Generic coverage
cannot coexist with exact-part `catalog` facts: that object requires
`manufacturer`, `orderNumber` and `document`. The published schema rejects
`generic` on a cataloged type with E014 at `connectionCoverage/status`, listing
`complete` and `partial` as its allowed alternatives. Select the honest status;
never remove manufacturer facts to conceal an incomplete exact-part review.

For example, a port-only HMI intended to include power and bonding must stay
partial until those connections are modeled from evidence. A generic or proposed
interface is not a manufacturer pinout; its scope and actual-part limitations
belong in its notes. The diagnostic cannot discover omitted pins.

After a library edit, intentionally regenerate its project lock and validate.
Visible libraries already copied into a project do not update automatically.

## Project-specific requirements and review

Use `connectionReview` on a device for application-dependent connections:

```json
{
  "connectionReview": {
    "terminals": {
      "IN1": {
        "status": "required",
        "reason": "This application uses the pressure permissive input."
      },
      "IN2": {
        "status": "intentionally-unused",
        "reason": "Reserved for a future temperature switch."
      },
      "P": {
        "status": "deferred",
        "reason": "Field cable is drawn; upstream fused supply is still pending."
      }
    },
    "ports": {
      "ETH2": {
        "status": "intentionally-unused",
        "reason": "This application uses only ETH1."
      }
    }
  }
}
```

Every entry needs a nonblank reason and must name an existing terminal or port.
`required` promotes an application-dependent connection to required. An unused
or deferred entry cannot override a library requirement. Deferred work remains a
warning even if a conductor is attached; it may describe an unfinished upstream
feed. Remove or revise the review entry when that work is completed. An unused
entry that acquires a connection is also flagged for review.

Use the guarded patch workflow for these device-source edits. Do not classify
an unconnected point as unused merely to clear the report.

## Findings and limits

| Code | Meaning |
| --- | --- |
| E205 | Device review names an undeclared terminal or port; source error. |
| W903 | Non-deferred required connection missing or only a single-ended cable core attached. |
| W904 | Component connection model is explicitly partial. |
| W905 | Deferred work, or an unused review contradicts a requirement or connection. |
| I001 | Unconnected or dangling point without a declared requirement or unused disposition. A terminal used only by channels explicitly marked spare in `io` already has a disposition; a common also used by a channel that is in use or not marked spare does not. |
| I002 | Intentionally unused point, with its reason preserved. |
| I003 | Component connection coverage has not been declared. |
| I005 | Reviewed generic interface: actual-part terminals beyond that interface cannot be checked; includes the notes, once per device. |

A deferred required point without a complete connection emits W905 only; its
message preserves the requirement, connection state and review reason. Required
points marked `intentionally-unused` still emit both W903 and W905.

W903–W905 also appear during compilation and agent validation. Compiler warnings
aggregate each device/code while preserving the individual definition references;
the completeness report keeps individual findings. Information codes belong to
the completeness inventory and do not introduce warnings in legacy validation.

**Connected means connection presence only.** Wires, jumpers and fully terminated
cable cores qualify. A core with an unfinished far end occupies a terminal but
does not satisfy a required connection. A completely terminated spare core is
still conductive. A device function does not short its terminals or supply its
loads. Communication relations satisfy port topology, but do not prove that a
physical network cable has been scheduled.

This analysis does not yet prove an upstream supply path, adequate power,
protective bonding, conductor ampacity, fuse/breaker coordination, or machine
safety. A device can have every pin connected and still need an upstream feed.
The separate [declared continuity audit](continuity-checks.md) checks explicit
commoning, bond and direct-feed obligations against physical nets; it does not
traverse device functions or infer requirements.
Coverage declarations and review notes make those limits visible in the source.

The executable [completeness fixture](../packages/cli/fixtures/completeness/source.json)
demonstrates required, dangling, unused and deferred cases, including a port-only
HMI. Its deliberately unfinished connections are diagnostic examples.

See [validation coverage](validation.md) for the distinction between terminal
ratings and net potentials, and for checks that could not run.
