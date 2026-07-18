import { describe, expect, it } from 'vitest';
import { isValidAgentSecret } from '@/lib/agent-auth';
import { readFileSync } from 'node:fs';

describe('agent secret authentication', () => {
  it('accepts only the configured server secret', () => {
    expect(isValidAgentSecret('configured-secret', 'configured-secret')).toBe(true);
    expect(isValidAgentSecret('jetski_migration_2024', 'configured-secret')).toBe(false);
    expect(isValidAgentSecret(null, 'configured-secret')).toBe(false);
    expect(isValidAgentSecret('configured-secret', undefined)).toBe(false);
  });

  it('does not retain the retired migration bypass in either authentication boundary', () => {
    const authSource = readFileSync(new URL('../../src/lib/auth.ts', import.meta.url), 'utf8');
    const proxySource = readFileSync(new URL('../../src/proxy.ts', import.meta.url), 'utf8');
    expect(authSource).not.toContain('jetski_migration_2024');
    expect(proxySource).not.toContain('jetski_migration_2024');
  });
});
