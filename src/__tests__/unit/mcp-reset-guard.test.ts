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
