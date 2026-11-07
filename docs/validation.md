# Ratings, potentials and validation coverage

A terminal `rating` describes equipment capability; a `potential` declares the
net's electrical intent. Ratings never establish the voltage present on a wire.
Declare voltage facts in a potential at a terminal to assess its derived net. Only wires, jumpers
and cable cores terminated at both ends join nets; device functions do not.

The compiler reports these assessment limits:

| Code | Severity | Meaning |
| --- | --- | --- |
| W303 | Warning | Terminals have conflicting comparable declared ratings in a voltage field left undeclared by the net's potentials. The message names the net, terminals, rating facts and declaration locations. |
| I304 | Info | One project summary lists connected nets with at least two terminal ratings declaring `voltage_type` or `nominal_voltage`, and no potential declaring either voltage fact. Voltage compatibility remains unassessed, even when the ratings agree. |
| I305 | Info | One project summary lists connected nets with exactly one voltage-rated terminal that passes the comparison exclusions, and no potential declaring either voltage fact. It identifies no supply. |
| I208 | Info | One project summary names checks blocked by failed prerequisites and their affected nets, terminals or source locations. |

I304, I305 and I208 list at most ten affected entries per group, naturally sorted,
followed by the omitted count. Info diagnostics do not change exit status,
including `validate --strict`; warnings retain the existing strict-mode policy.
Errors still prevent compilation from returning IR. No diagnostic repairs source
or invents an electrical fact.

W303 uses the same explicit AC/DC inequality and unequal positive nominal-value
comparisons as E301/E302, with additional conservative exclusions because a voltage field
is left undeclared by the net's potentials:

- Explicit reference/return roles, including negative/neg/minus role tokens,
  and terminals with nonpositive nominal ratings do not establish a conflict.
  Shared negative terminals of supplies with different positive nominal ratings
  are excluded from comparison; their actual voltage is never inferred.
- Conventional names N, PE, FE, GND, COM, COMMON, RETURN,
  M and `-` are comparison exclusions, as are V-/L-, -V/-L, numbered M commons,
  numeric 0V suffixes and numbered GND keys. An explicit non-reference role
  takes precedence only over ambiguous N, M/numbered M, COM and COMMON keys:
  a `contact` named COM or a `digital_input` named M is compared. All other listed
  reference/return names stay excluded even with generic roles such as `output`,
  `dc_output` or `supply`. These exclusions never infer polarity or voltage.
- Explicit mixed or multi-rated roles do not select a single rating class. The
  scalar rating schema cannot encode alternative voltage classes; omitted fields
  are not evidence of a conflict. Ratings on other terminals of a mixed AC/DC
  device are never applied to the connected terminal.
- Unequal AC nominal ratings may use line-to-line and line-to-neutral references;
  the schema does not declare that reference. W303 therefore compares positive
  nominal values only when both terminals explicitly declare DC. An explicit
  AC/DC disagreement remains comparable regardless of AC nominal reference.
- A partial potential assesses only the voltage fields it declares. W303 compares
  the undeclared fields and names them in its message; compatible partial
  declarations collectively assess the fields they declare. Fully declared
  potentials retain their existing diagnostics. I304 membership is unchanged:
  any potential declaring `voltage_type` or `nominal_voltage` keeps the net out
  of that summary. Empty, polarity-only and current-only potentials do not
  silence W303/I304. Current/power/frequency-only
  terminal ratings do not create a voltage-compatibility obligation. Existing
  E300/E301/E302/W902 still analyze authored potential facts, including compatible
  partial declarations; no potential is removed, inferred or repaired.

I305 reports the single-rated connected-net assessment gap, not a conflict or identified supply. Author potential intent only from known design facts. Reference/return, mixed-rating and zero/negative nominal exclusions apply. Like I304, I305 excludes nets with either potential voltage field; partial declarations assess only their authored fields.

I208 preserves the compiler's gates. Structural, loading, library-lock and
resolution failures prevent trustworthy IR construction; net rules do not run
on partial or fabricated IR. Loading/structural gates also name skipped lock
verification and reference resolution (E1xx); a lock gate names skipped
resolution. I208 consistently says "Checks not completed", including when an
unexpected failure prevents a complete validation result; that report also lists
lock verification and reference resolution as having no complete results.
With valid IR, E200/E201 block potential and rating
rules only on affected nets. E300 blocks E301/E302 only on conflicting nets;
E301 blocks E302 only on the same terminals. Independent faults on other nets
remain reportable in the same run. Tool failures also announce incomplete
validation, retaining exit 2.
