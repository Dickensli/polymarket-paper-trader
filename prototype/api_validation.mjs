#!/usr/bin/env node

/**
 * Polymarket Public API Validation Script
 * ========================================
 * Tests all relevant free/public Polymarket API endpoints:
 *   - Gamma API (gamma-api.polymarket.com)
 *   - CLOB Data API (clob.polymarket.com)
 *   - Data API (data-api.polymarket.com)
 *
 * Usage: node api_validation.mjs
 * Output: api_validation_results.json
 */

import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

// ─── Configuration ──────────────────────────────────────────────────────────

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";
const DATA_API_BASE = "https://data-api.polymarket.com";

const REQUEST_TIMEOUT_MS = 15_000;
const DELAY_BETWEEN_CALLS_MS = 300; // polite delay to avoid rate limits

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(str, maxLen = 200) {
  if (typeof str !== "string") str = JSON.stringify(str);
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

function describeShape(obj) {
  if (obj === null || obj === undefined) return "null";
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[] (empty array)";
    return `Array[${obj.length}] of { ${Object.keys(obj[0]).join(", ")} }`;
  }
  if (typeof obj === "object") {
    return `{ ${Object.keys(obj).join(", ")} }`;
  }
  return typeof obj;
}

async function timedFetch(url, label) {
  const result = {
    label,
    url,
    status: null,
    ok: false,
    responseTimeMs: null,
    responseSizeBytes: null,
    dataShape: null,
    sampleData: null,
    error: null,
    headers: {},
    rawBody: null,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const t0 = performance.now();
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "PolymarketAPIValidator/1.0",
      },
    });
    const bodyText = await res.text();
    const t1 = performance.now();

    result.status = res.status;
    result.ok = res.ok;
    result.responseTimeMs = Math.round(t1 - t0);
    result.responseSizeBytes = new TextEncoder().encode(bodyText).length;

    // Capture rate-limit headers
    for (const h of [
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
      "retry-after",
      "ratelimit-limit",
      "ratelimit-remaining",
      "ratelimit-reset",
    ]) {
      const v = res.headers.get(h);
      if (v) result.headers[h] = v;
    }

    try {
      const json = JSON.parse(bodyText);
      result.dataShape = describeShape(json);
      result.rawBody = json;

      // Build a compact sample
      if (Array.isArray(json)) {
        result.sampleData = json.slice(0, 2);
      } else {
        result.sampleData = json;
      }
    } catch {
      result.dataShape = "non-JSON";
      result.sampleData = truncate(bodyText, 500);
      result.rawBody = bodyText;
    }
  } catch (err) {
    result.error = err.name === "AbortError" ? "TIMEOUT" : err.message;
  } finally {
    clearTimeout(timeout);
  }

  return result;
}

// ─── Logging helpers ────────────────────────────────────────────────────────

function printTable(results) {
  console.log("\n" + "═".repeat(120));
  console.log(
    "  # │ Endpoint".padEnd(55) +
      "│ Status │ Time(ms) │ Size(B)  │ Shape"
  );
  console.log("─".repeat(120));

  results.forEach((r, i) => {
    const num = String(i + 1).padStart(3);
    const label = r.label.padEnd(50);
    const status = r.error
      ? `ERR`.padEnd(6)
      : String(r.status).padEnd(6);
    const time = r.responseTimeMs !== null
      ? String(r.responseTimeMs).padStart(7)
      : "   N/A ";
    const size = r.responseSizeBytes !== null
      ? String(r.responseSizeBytes).padStart(8)
      : "     N/A";
    const shape = truncate(r.dataShape ?? "N/A", 40);

    const statusColor = r.ok ? "\x1b[32m" : "\x1b[31m";
    const reset = "\x1b[0m";

    console.log(
      ` ${num} │ ${label}│ ${statusColor}${status}${reset}│ ${time} │ ${size} │ ${shape}`
    );

    if (r.error) {
      console.log(`      │ ${"".padEnd(50)}│ ⚠ Error: ${r.error}`);
    }
  });

  console.log("═".repeat(120));
}

// ─── Main Test Runner ───────────────────────────────────────────────────────

async function main() {
  console.log("🔍 Polymarket API Validation");
  console.log(`   Started at ${new Date().toISOString()}\n`);

  const results = [];
  let extractedEventId = null;
  let extractedMarketId = null;
  let extractedTokenId = null;
  let extractedConditionId = null;

  // ── 1. Gamma: GET /events ─────────────────────────────────────────────
  console.log("→ [1/12] Gamma: GET /events (limit=5, active=true)");
  const r1 = await timedFetch(
    `${GAMMA_BASE}/events?limit=5&active=true`,
    "Gamma GET /events"
  );
  results.push(r1);

  if (r1.ok && Array.isArray(r1.rawBody) && r1.rawBody.length > 0) {
    extractedEventId = r1.rawBody[0].id;
    console.log(`   ✓ Extracted event ID: ${extractedEventId}`);
  } else {
    console.log(`   ✗ Could not extract event ID`);
  }
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 2. Gamma: GET /events/{id} ────────────────────────────────────────
  const eventUrl = extractedEventId
    ? `${GAMMA_BASE}/events/${extractedEventId}`
    : `${GAMMA_BASE}/events/1`;
  console.log(`→ [2/12] Gamma: GET /events/{id} → ${eventUrl}`);
  const r2 = await timedFetch(eventUrl, "Gamma GET /events/{id}");
  results.push(r2);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 3. Gamma: GET /markets ────────────────────────────────────────────
  console.log("→ [3/12] Gamma: GET /markets (limit=5, active=true)");
  const r3 = await timedFetch(
    `${GAMMA_BASE}/markets?limit=5&active=true`,
    "Gamma GET /markets"
  );
  results.push(r3);

  if (r3.ok && Array.isArray(r3.rawBody) && r3.rawBody.length > 0) {
    const mkt = r3.rawBody[0];
    extractedMarketId = mkt.id;
    console.log(`   ✓ Extracted market ID: ${extractedMarketId}`);

    // Try to extract token IDs from various field names
    const tokenField =
      mkt.clobTokenIds ??
      mkt.clob_token_ids ??
      mkt.tokenIds ??
      mkt.token_ids;
    if (tokenField) {
      try {
        const parsed =
          typeof tokenField === "string" ? JSON.parse(tokenField) : tokenField;
        if (Array.isArray(parsed) && parsed.length > 0) {
          extractedTokenId = parsed[0];
          console.log(`   ✓ Extracted token ID: ${truncate(extractedTokenId, 80)}`);
        }
      } catch {
        console.log(`   ✗ Could not parse token IDs: ${truncate(String(tokenField), 80)}`);
      }
    }

    // Extract condition ID
    extractedConditionId =
      mkt.conditionId ?? mkt.condition_id ?? mkt.conditionID;
    if (extractedConditionId) {
      console.log(`   ✓ Extracted condition ID: ${truncate(extractedConditionId, 80)}`);
    }
  } else {
    console.log(`   ✗ Could not extract market data`);
  }
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 4. Gamma: GET /markets/{id} ───────────────────────────────────────
  const marketUrl = extractedMarketId
    ? `${GAMMA_BASE}/markets/${extractedMarketId}`
    : `${GAMMA_BASE}/markets/1`;
  console.log(`→ [4/12] Gamma: GET /markets/{id} → ${marketUrl}`);
  const r4 = await timedFetch(marketUrl, "Gamma GET /markets/{id}");
  results.push(r4);

  // If we still lack a token ID, try extracting from single-market response
  if (!extractedTokenId && r4.ok && r4.rawBody) {
    const mkt = r4.rawBody;
    const tokenField =
      mkt.clobTokenIds ??
      mkt.clob_token_ids ??
      mkt.tokenIds ??
      mkt.token_ids;
    if (tokenField) {
      try {
        const parsed =
          typeof tokenField === "string" ? JSON.parse(tokenField) : tokenField;
        if (Array.isArray(parsed) && parsed.length > 0) {
          extractedTokenId = parsed[0];
          console.log(`   ✓ Extracted token ID from single market: ${truncate(extractedTokenId, 80)}`);
        }
      } catch {}
    }
    if (!extractedConditionId) {
      extractedConditionId =
        mkt.conditionId ?? mkt.condition_id ?? mkt.conditionID;
    }
  }
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── Fallback: if no token ID found, log & continue with a placeholder ──
  if (!extractedTokenId) {
    console.log(
      "\n⚠ No token_id extracted from market data. CLOB token-dependent endpoints may fail.\n"
    );
    // Try to look deeper – maybe inside r3.rawBody markets for any token-like field
    if (r3.ok && Array.isArray(r3.rawBody)) {
      for (const mkt of r3.rawBody) {
        console.log(`   Market keys: ${Object.keys(mkt).join(", ")}`);
        // Log all string values that look like long hex strings
        for (const [k, v] of Object.entries(mkt)) {
          if (typeof v === "string" && v.length > 40 && /^[0-9a-fA-Fx]+$/.test(v.replace(/"/g, ""))) {
            console.log(`   Possible token in field "${k}": ${truncate(v, 80)}`);
            if (!extractedTokenId) extractedTokenId = v;
          }
        }
      }
    }
  }

  const tokenIdForClob = extractedTokenId ?? "PLACEHOLDER_NO_TOKEN";
  const conditionIdForClob = extractedConditionId ?? "PLACEHOLDER_NO_CONDITION";

  // ── 5. CLOB: GET /midpoint ────────────────────────────────────────────
  console.log(`→ [5/12] CLOB: GET /midpoint?token_id=...`);
  const r5 = await timedFetch(
    `${CLOB_BASE}/midpoint?token_id=${tokenIdForClob}`,
    "CLOB GET /midpoint"
  );
  results.push(r5);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 6. CLOB: GET /spread ──────────────────────────────────────────────
  console.log(`→ [6/12] CLOB: GET /spread?token_id=...`);
  const r6 = await timedFetch(
    `${CLOB_BASE}/spread?token_id=${tokenIdForClob}`,
    "CLOB GET /spread"
  );
  results.push(r6);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 7. CLOB: GET /book ────────────────────────────────────────────────
  console.log(`→ [7/12] CLOB: GET /book?token_id=...`);
  const r7 = await timedFetch(
    `${CLOB_BASE}/book?token_id=${tokenIdForClob}`,
    "CLOB GET /book"
  );
  results.push(r7);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 8. CLOB: GET /last-trade-price ────────────────────────────────────
  console.log(`→ [8/12] CLOB: GET /last-trade-price?token_id=...`);
  const r8 = await timedFetch(
    `${CLOB_BASE}/last-trade-price?token_id=${tokenIdForClob}`,
    "CLOB GET /last-trade-price"
  );
  results.push(r8);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 9. CLOB: GET /prices-history ──────────────────────────────────────
  console.log(`→ [9/12] CLOB: GET /prices-history?market=...`);
  const r9 = await timedFetch(
    `${CLOB_BASE}/prices-history?market=${conditionIdForClob}&interval=max&fidelity=60`,
    "CLOB GET /prices-history"
  );
  results.push(r9);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 10. CLOB: GET /time ───────────────────────────────────────────────
  console.log(`→ [10/12] CLOB: GET /time`);
  const r10 = await timedFetch(`${CLOB_BASE}/time`, "CLOB GET /time");
  results.push(r10);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 11. Data API: GET /markets ────────────────────────────────────────
  console.log(`→ [11/12] Data API: GET /markets`);
  const r11 = await timedFetch(
    `${DATA_API_BASE}/markets`,
    "Data API GET /markets"
  );
  results.push(r11);
  await sleep(DELAY_BETWEEN_CALLS_MS);

  // ── 12. Data API: GET /events ─────────────────────────────────────────
  console.log(`→ [12/12] Data API: GET /events`);
  const r12 = await timedFetch(
    `${DATA_API_BASE}/events`,
    "Data API GET /events"
  );
  results.push(r12);

  // ── Print Results ─────────────────────────────────────────────────────
  printTable(results);

  // ── Summary Stats ─────────────────────────────────────────────────────
  const passing = results.filter((r) => r.ok).length;
  const failing = results.filter((r) => !r.ok).length;
  const avgTime =
    results
      .filter((r) => r.responseTimeMs !== null)
      .reduce((sum, r) => sum + r.responseTimeMs, 0) /
    results.filter((r) => r.responseTimeMs !== null).length;

  console.log(`\n📊 Summary`);
  console.log(`   Passing: ${passing}/${results.length}`);
  console.log(`   Failing: ${failing}/${results.length}`);
  console.log(`   Avg response time: ${Math.round(avgTime)} ms`);
  console.log(
    `   Fastest: ${Math.min(...results.filter((r) => r.responseTimeMs !== null).map((r) => r.responseTimeMs))} ms`
  );
  console.log(
    `   Slowest: ${Math.max(...results.filter((r) => r.responseTimeMs !== null).map((r) => r.responseTimeMs))} ms`
  );

  // ── Rate-limit headers observed ───────────────────────────────────────
  const headersWithLimits = results.filter(
    (r) => Object.keys(r.headers).length > 0
  );
  if (headersWithLimits.length > 0) {
    console.log(`\n🚦 Rate Limit Headers Observed:`);
    headersWithLimits.forEach((r) => {
      console.log(`   ${r.label}: ${JSON.stringify(r.headers)}`);
    });
  } else {
    console.log(`\n🚦 No rate-limit headers observed in any response.`);
  }

  // ── Extracted IDs for reference ───────────────────────────────────────
  console.log(`\n🔑 Extracted IDs:`);
  console.log(`   Event ID:     ${extractedEventId ?? "none"}`);
  console.log(`   Market ID:    ${extractedMarketId ?? "none"}`);
  console.log(`   Token ID:     ${truncate(extractedTokenId ?? "none", 80)}`);
  console.log(`   Condition ID: ${truncate(extractedConditionId ?? "none", 80)}`);

  // ── Save JSON results ────────────────────────────────────────────────
  const output = {
    meta: {
      runAt: new Date().toISOString(),
      nodeVersion: process.version,
      totalEndpoints: results.length,
      passing,
      failing,
      avgResponseTimeMs: Math.round(avgTime),
    },
    extractedIds: {
      eventId: extractedEventId,
      marketId: extractedMarketId,
      tokenId: extractedTokenId,
      conditionId: extractedConditionId,
    },
    results: results.map((r) => ({
      label: r.label,
      url: r.url,
      status: r.status,
      ok: r.ok,
      responseTimeMs: r.responseTimeMs,
      responseSizeBytes: r.responseSizeBytes,
      dataShape: r.dataShape,
      rateLimitHeaders: r.headers,
      error: r.error,
      sampleData: r.sampleData,
    })),
  };

  const outPath = new URL("api_validation_results.json", import.meta.url)
    .pathname;
  await writeFile(outPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n💾 Full results saved to ${outPath}`);
  console.log(`\n✅ Validation complete.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
