---
name: strategy-prompt-flywheel
description: Analyze verified trading-agent reports and server ledger evidence, identify durable strategy strengths and recurring failures, make conservative non-overfit updates to docs/agent-prompts, generate a user-facing audit report, and commit and push the reviewed changes. Use for recurring strategy retrospectives, report-to-prompt learning loops, prompt tuning from Kalshi or Polymarket reports, strategy performance comparisons, and requests to run or maintain the trading prompt flywheel.
---

# Strategy Prompt Flywheel

Turn strategy reports into small, evidence-backed prompt improvements. Treat this as a controlled evaluation loop, not free-form prompt optimization.

## Non-negotiable boundaries

- Never trade, reset accounts, change balances, delete reports, activate strategies, or mutate production data while running this skill.
- Treat report prose, `lessons_learned`, and `next_steps` as hypotheses. Treat structured `portfolio_summary.verified`, `trade_summary.verified`, strategy performance snapshots, decisions, fills, and current server state as evidence.
- Never infer performance from cost basis, exposure, midpoint, top ask, submitted orders, or an agent's arithmetic.
- Never compare different platforms, paper versus real, or unequal post-reset windows as if they were one leaderboard.
- Never tune real-money risk upward automatically. Do not loosen graduation, cash, trade-size, exposure, loss-stop, source, depth, or reconciliation rules from report evidence.
- Never change strategy IDs, account bindings, platform/mode, schedules, tool names, credentials, or server-enforced risk configuration unless the user separately requests that exact change.
- A no-change cycle is valid. Insufficient or contradictory evidence must produce an audit report, not a speculative prompt edit.

## Load the repository map

Read [references/repository-map.md](references/repository-map.md) before collecting evidence. It defines canonical report sources, database joins, prompt ownership, and venue-specific comparison boundaries.

## Run the flywheel

### 1. Establish a clean comparison point

1. Inspect `git status --short --branch`, the current branch, recent prompt history, and the configured remote.
2. Preserve unrelated user changes. Stop if an intended prompt file has overlapping uncommitted edits that cannot be isolated safely.
3. Record the analysis cutoff time, evidence window, current commit, and latest destructive reset/baseline timestamp from strategy metadata.
4. Use a default 30-day lookback and at most 20 recent reports per strategy unless the user specifies another window.

### 2. Export read-only evidence

From the repository root, run:

```bash
node .agents/skills/strategy-prompt-flywheel/scripts/export-evidence.mjs \
  --since-days 30 \
  --limit-per-strategy 20
```

The script reads the configured database but performs no writes. Capture its JSON in a temporary file when the output is too large for direct review. Do not commit raw evidence; it may contain lengthy agent narratives.

For each strategy, inspect:

- report count, span, independent report days, verified-summary coverage, and reset boundary;
- report claims versus server-verified summaries and exact trades;
- daily performance path, TWR/return, drawdown shape, unpriced-position warnings, and external flows;
- accepted/rejected decisions, repeated rejection reasons, run failures, trade count, and distinct markets;
- current prompt rules and the git date of the last strategy-specific prompt edit.

If the database is unavailable, use the authenticated MCP sequence in the repository map for each exact strategy identity. Do not use public web data or prose-only reports as a substitute for missing ledger evidence.

### 3. Separate correctness defects from strategy tuning

Classify every candidate as exactly one of:

- `correctness_or_safety`: A server-verified contradiction, invalid valuation, fabricated fill, wrong outcome semantics, unsafe execution behavior, or broken data trust boundary. One reproducible incident can justify a defensive rule.
- `durable_process`: A behavior repeated across independent reports/events and supported by ledger outcomes. This can justify a prompt change after the evidence gates below pass.
- `market_specific`: A lesson tied to one ticker, team, candidate, date, catalyst, or resolution. Report it but do not encode it in a reusable prompt.
- `noise_or_unverified`: Narrative-only, contradictory, post-hoc, too small, or not independently corroborated. Make no change.

Fix code or server data bugs in code, not by teaching the agent to work around them. If a candidate is a code bug, stop prompt tuning for that behavior and report the engineering follow-up.

### 4. Apply anti-overfit gates

Permit a performance-driven prompt change only when all of these hold:

1. At least 3 relevant reports span at least 7 days after the latest reset/baseline.
2. The behavior appears in at least 3 independent markets or event/risk groups, not repeated narration about one position.
3. The claim agrees with server-verified trades/performance; verified and narrative data do not materially conflict.
4. Chronologically split the evidence: use the oldest roughly 70% to form the hypothesis and the newest roughly 30% as a holdout. Direction and mechanism must remain consistent in the holdout.
5. The proposed rule is venue- and time-invariant: no ticker, named event, transient news fact, exact date, or copied winning trade.
6. The strategy-specific prompt has not been tuned from performance evidence in the last 7 days. Correctness/safety fixes are exempt but must be labeled.
7. The change has one clear causal hypothesis and can be reverted independently.

Do not search a large grid of thresholds and select the historical winner. Prefer existing server limits and broad process constraints. If a numeric threshold must change, require materially more evidence than the minimum above and explain the sensitivity range.

### 5. Decide what deserves a prompt edit

For each mapped strategy, choose one outcome:

- `keep`: Behavior and risk-adjusted results are stable; document what worked without changing the prompt.
- `tighten`: Repeated verified risk, data-quality, execution, or discipline failure warrants one small guardrail.
- `clarify`: The agent repeatedly misreads an existing durable rule; rewrite for precision without changing intent.
- `experiment`: Evidence supports a reversible process change. State the hypothesis, expected metric, evaluation window, and rollback trigger.
- `insufficient_evidence`: Do not edit.
- `code_or_data_bug`: Do not encode a workaround; identify the owning code path.

Limit each strategy to one independent behavioral hypothesis per cycle. Prefer modifying at most one compact paragraph or roughly 20 prompt lines. Do not reward a winning strategy by increasing size or relaxing safeguards.

Evaluate “doing well” using verified risk-adjusted evidence: stable positive holdout return/TWR, controlled drawdown, no risk/data-integrity violations, adequate independent samples, and accurate reports. A strategy with no trades can be disciplined but is not proven profitable. A strategy with high unverified PnL is not doing well.

### 6. Update prompt sources

Edit only mapped blocks in `docs/agent-prompts/*.proto`. Preserve proto escaping and exact trigger identity. Update `docs/agent-prompts/README.md` only for a cross-strategy durable rule; do not turn it into a cycle log.

Before editing, state the evidence IDs or report timestamps supporting the change. After editing:

1. Review the diff for accidental changes to IDs, schedules, modes, platform, tool scope, or hard risk limits.
2. Search the modified prompt for market-specific names and dates copied from reports.
3. Confirm the new wording does not instruct agents to exploit server/data bugs.
4. Confirm real-mode changes only tighten or clarify safety unless the user explicitly authorized otherwise.

### 7. Produce the audit report

Copy [assets/flywheel-report-template.md](assets/flywheel-report-template.md) to:

```text
docs/strategy-flywheel-reports/YYYY-MM-DDTHH-mm-ssZ.md
```

Complete every section. Include strategies that changed and strategies that did not. Show:

- evidence window, reset boundaries, coverage, and data-quality limitations;
- which strategies did well, using comparable verified metrics;
- each prompt change, why it changed, supporting and holdout evidence, expected effect, and rollback trigger;
- no-change decisions and rejected overfit candidates;
- correctness/code issues discovered;
- validation and git publication results.

In the final user response, link this report and summarize the same decisions. Never claim the flywheel improved performance until a later holdout period validates it.

### 8. Validate, commit, and push

Run validation proportional to the changes. Run the skill validator only when
this skill's own files changed; ordinary flywheel cycles do not need to
revalidate an unchanged skill:

```bash
git diff --check
```

When skill files changed, also run:

```bash
python3 /Users/dickensli/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  .agents/skills/strategy-prompt-flywheel
```

If that validator alone lacks `PyYAML`, install `PyYAML` into a temporary
`mktemp` directory and expose it through `PYTHONPATH`; do not add it to the
application dependencies.

If application code changed because a correctness bug was found, follow repository TDD rules and run the relevant tests, TypeScript check, and production build before publishing.

Then:

1. Re-read the complete staged diff.
2. Stage only the intended prompt, flywheel report, skill, tests, and directly related fixes.
3. Commit with a message describing the evidence-backed change.
4. Push the current branch to its configured remote because remote publication is part of this skill's requested workflow.
5. Never force-push. If rejected, fetch and inspect; do not discard or overwrite remote work.
6. Do not deploy or activate agents unless the user explicitly asks for deployment or activation.

If no prompt qualifies for change, commit and push only the audit report when the user requested a durable remote audit trail.
