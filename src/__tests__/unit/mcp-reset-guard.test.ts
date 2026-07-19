import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8');
}

describe('MCP destructive reset guard', () => {
  const mcpEntries = [
    'kalshi-mcp/src/index.ts',
    'kalshi-mcp/build/index.js',
    'polymarket-us-mcp/src/index.ts',
    'polymarket-us-mcp/build/index.js',
    'mcp/src/index.ts',
    'mcp/build/index.js',
  ];

  it.each(mcpEntries)('%s requires explicit confirmation before init_account can reset state', (path) => {
    const source = readRepoFile(path);

    expect(source).toContain('confirm_destructive_reset');
    expect(source).toContain('init_account is destructive and requires confirm_destructive_reset=true');
    expect(source).toContain('required:');
    expect(source).toContain('requireDestructiveResetConfirmation');
  });

  for (const path of [
    'kalshi-mcp/src/index.ts',
    'kalshi-mcp/build/index.js',
    'polymarket-us-mcp/src/index.ts',
    'polymarket-us-mcp/build/index.js',
  ]) {
    it(`${path} also requires server-verified human reset authorization`, () => {
      const source = readRepoFile(path);
      expect(source).toContain('AGENT_RESET_SECRET');
      expect(source).toContain('reset_authorization');
      expect(source).toContain('human-issued reset_authorization token');
    });
  }
});

describe('MCP verified report routing', () => {
  const reportMcpEntries = [
    'kalshi-mcp/src/index.ts',
    'kalshi-mcp/build/index.js',
    'polymarket-us-mcp/src/index.ts',
    'polymarket-us-mcp/build/index.js',
  ];

  it.each(reportMcpEntries)('%s uses the server-verified agent report API', (path) => {
    const source = readRepoFile(path);

    expect(source).toContain('/agent/reports');
    expect(source).not.toMatch(/callPolyTrader\([`"]\/reports/);
  });

  it('keeps the legacy report POST as a verified-handler compatibility alias', () => {
    const source = readRepoFile('src/app/api/reports/route.ts');

    expect(source).toContain("POST as postVerifiedReport");
    expect(source).toContain('return postVerifiedReport(request)');
  });
});

describe('Polymarket US MCP sell-all resolution', () => {
  for (const path of ['polymarket-us-mcp/src/index.ts', 'polymarket-us-mcp/build/index.js']) {
    it(`${path} resolves ALL against the open portfolio before submitting`, () => {
      const source = readRepoFile(path);
      expect(source).toContain('No matching open position was found for this sell request');
      expect(source).toContain('/polymarket-us/portfolio');
      expect(source).not.toContain('shares: typeof quantity === "number" ? quantity : undefined');
    });
  }
});
