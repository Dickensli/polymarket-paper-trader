import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const skillRoot = new URL('../../../.agents/skills/strategy-prompt-flywheel/', import.meta.url);
const readSkillFile = (path: string) => readFileSync(new URL(path, skillRoot), 'utf8');

describe('strategy prompt flywheel skill', () => {
  const skill = readSkillFile('SKILL.md');
  const repositoryMap = readSkillFile('references/repository-map.md');
  const reportTemplate = readSkillFile('assets/flywheel-report-template.md');
  const exporter = readSkillFile('scripts/export-evidence.mjs');

  it('uses verified evidence and explicit anti-overfit gates', () => {
    expect(skill).toContain('server-verified');
    expect(skill).toContain('oldest roughly 70%');
    expect(skill).toContain('newest roughly 30%');
    expect(skill).toContain('At least 3 relevant reports span at least 7 days');
    expect(skill).toContain('at least 3 independent markets or event/risk groups');
  });

  it('maps prompts by platform, mode, and strategy id', () => {
    expect(repositoryMap).toContain('kalshi:paper:commander');
    expect(repositoryMap).toContain('kalshi:real:commander_real');
    expect(repositoryMap).toContain('polymarket_us:paper:high_freq_retro');
    expect(repositoryMap).toContain('Never group by `strategy_name` alone');
  });

  it('requires a user-facing audit and remote publication', () => {
    expect(reportTemplate).toContain('## Strategy scorecard');
    expect(reportTemplate).toContain('## Rejected overfit candidates');
    expect(reportTemplate).toContain('## Publication');
    expect(skill).toContain('Push the current branch');
  });

  it('keeps the evidence exporter read-only and reset-aware', () => {
    expect(exporter).toContain('set default_transaction_read_only = on');
    expect(exporter).toContain("metadata->>'performance_baseline_at'");
    expect(exporter).not.toMatch(/\b(insert into|update strategies|delete from|drop table|truncate)\b/i);
  });
});
