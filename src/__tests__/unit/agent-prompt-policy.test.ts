import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

function triggerBlock(source: string, id: string) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`triggers \\{\\n  id: "${escapedId}"[\\s\\S]*?\\n\\}`));
  expect(match, `missing trigger ${id}`).not.toBeNull();
  return match![0];
}

describe('trading-agent prompt policy', () => {
  it('keeps Kalshi paper graduation strictly after the current trading decision', () => {
    const source = readRepoFile('../docs/agent-prompts/kalshi-prompts.proto');

    for (const id of ['commander', 'conservative_retro', 'high_freq_retro']) {
      const prompt = triggerBlock(source, id);
      expect(prompt).toContain('DECISION CHECKPOINT');
      expect(prompt).toContain('Graduation must not appear in the trade/no-trade reasons');
      expect(prompt).toContain('Historical graduation drawdown and policy flags are not current paper risk stops');
      expect(prompt).toContain('always call save_report before ending');
      expect(prompt).toContain('Copy `strategy.risk_config` from get_strategy_context verbatim');
    }
  });

  it('forbids manufacturing graduation volume in the real commander handoff', () => {
    const prompt = triggerBlock(readRepoFile('../docs/agent-prompts/kalshi-prompts.proto'), 'commander_real');

    expect(prompt).toContain('Never instruct the paper strategy to manufacture, document, or reject proposals for graduation volume');
    expect(prompt).toContain('Copy `strategy.risk_config` from get_strategy_context verbatim');
  });

  it('keeps Polymarket US high frequency directional and reports server risk config verbatim', () => {
    const source = readRepoFile('../docs/agent-prompts/polymarket-us-prompts.proto');
    const prompt = triggerBlock(source, 'high_freq_retro');

    expect(prompt).toContain('STRATEGY IDENTITY CHECKPOINT');
    expect(prompt).toContain('Arbitrage is neither required nor the primary scan objective');
    expect(prompt).toContain('Copy `strategy.risk_config` from get_strategy_context verbatim');
    expect(prompt).toContain('DECISION CHECKPOINT');
    expect(triggerBlock(source, 'conservative_retro')).not.toContain('STRATEGY IDENTITY CHECKPOINT');
  });

  it('keeps MCP report guidance and generated builds on report-memory-v3', () => {
    for (const path of [
      'kalshi-mcp/src/index.ts',
      'kalshi-mcp/build/index.js',
      'polymarket-us-mcp/src/index.ts',
      'polymarket-us-mcp/build/index.js',
    ]) {
      const source = readRepoFile(path);
      expect(source).toContain('report-memory-v3');
      expect(source).toContain('current server risk_config verbatim');
    }
  });
});
