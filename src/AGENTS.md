<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Strategy ID & Reporting Guardrails
1. **STRATEGY ID LOCK**: All trading agents MUST use their exact assigned trigger ID (e.g. `high_freq_retro`, `high_freq_real`) for all tool calls. You are STRICTLY forbidden from dynamically calling `register_strategy` with custom, invented, or modified strategy IDs (e.g. adding `_sol` or `_v2` suffixes). The MCP servers enforce this at runtime.
2. **ZERO HALLUCINATION REPORTING**: When calling `save_report`, every trade price, share count, and P&L figure you write MUST correspond EXACTLY to a transaction fetched in your Bootstrap/History step or returned by a write tool in this active session. NEVER guess or make up trade execution prices or P&L. If no trades executed, report: 'No trades executed in this session'. Every number must be 100% verified.

# Test-Driven Development (TDD) Enforcement
1. **TEST-DRIVEN**: When implementing any new feature or modifying existing logic, you MUST verify if appropriate tests (unit, integration, or E2E via Playwright) exist. If new features do not have covering test cases, you MUST write them. Never consider a feature complete without automated verification.
