# Strategy Prompt Flywheel Audit

- Generated at: `YYYY-MM-DDTHH:MM:SSZ`
- Evidence window: `START` to `END`
- Source commit: `SHA`
- Reset/baseline boundaries: `SUMMARY`
- Scope: `PLATFORMS / MODES / STRATEGIES`

## Executive summary

Summarize the strongest verified result, the most important recurring failure, how many prompts changed, and the largest evidence limitation. Do not claim future improvement.

## Evidence quality

| Strategy | Reports | Span | Independent markets/events | Verified coverage | Holdout | Quality |
| --- | ---: | --- | ---: | ---: | --- | --- |
| `platform:mode:id` | 0 | 0 days | 0 | 0% | insufficient | low |

Document missing data, reset truncation, unpriced positions, external flows, report/ledger conflicts, and incomparable venue/mode segments.

## Strategy scorecard

| Strategy | Comparable verified result | Risk/data discipline | Assessment | Decision |
| --- | --- | --- | --- | --- |
| `platform:mode:id` | `TWR / drawdown / samples` | `pass/fail/unknown` | doing well / mixed / weak / insufficient | keep / tighten / clarify / experiment / no change |

Explain which strategies did well and why. Separate “disciplined but unproven” from “verified profitable.”

## Prompt changes

### `platform:mode:strategy_id`

- Classification: `correctness_or_safety | durable_process`
- File/block: `path and trigger id`
- Prior behavior: `concise description`
- Change: `concise description`
- Supporting evidence: `report timestamps/filenames plus verified ledger facts`
- Holdout evidence: `newest 30% result`
- Why this should generalize: `venue/time-invariant mechanism`
- Expected metric: `what should improve and over what future window`
- Rollback trigger: `observable condition`

Repeat for each changed strategy. If none changed, state that explicitly.

## Kept strategies and no-change decisions

List every mapped strategy not changed and one evidence-based reason. Include insufficient evidence and cooldown decisions.

## Rejected overfit candidates

List tempting but rejected changes tied to one event, one winner/loser, small samples, narrative-only claims, threshold searches, or same-window optimization.

## Correctness and engineering findings

List code/data defects separately from strategy behavior. State whether code was fixed, a follow-up is required, or evidence was insufficient. Never encode a workaround in the prompt.

## Validation

- Skill validation: `PASS/FAIL`
- Prompt identity/schedule/mode audit: `PASS/FAIL`
- Diff check: `PASS/FAIL`
- Tests/typecheck/build: `commands and results or not required`

## Publication

- Branch: `BRANCH`
- Commit: `SHA`
- Remote push: `RESULT`
- Deployment/activation: `not requested or result`
