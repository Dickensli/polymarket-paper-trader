type FillRow = { officialOrderId: string | null; quantity: unknown; price: unknown; fee: unknown; filledAt: Date | string };
type EventRow = { officialOrderId: string; requestedQuantity: unknown; filledQuantity: unknown; remainingQuantity: unknown; status: string; occurredAt: Date | string | null };

function numeric(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function iso(value: Date | string | null | undefined) { return value ? new Date(value).toISOString() : null; }

export function buildOfficialOrderHistory(fills: FillRow[], events: EventRow[]) {
  const result = new Map<string, Record<string, unknown>>();
  const latest = new Map<string, EventRow>();
  for (const event of events) {
    const prior = latest.get(event.officialOrderId);
    if (!prior || (iso(event.occurredAt) ?? '') > (iso(prior.occurredAt) ?? '')) latest.set(event.officialOrderId, event);
  }
  const grouped = new Map<string, FillRow[]>();
  for (const fill of fills) if (fill.officialOrderId) grouped.set(fill.officialOrderId, [...(grouped.get(fill.officialOrderId) ?? []), fill]);
  for (const orderId of new Set([...latest.keys(), ...grouped.keys()])) {
    const rows = grouped.get(orderId) ?? []; const event = latest.get(orderId);
    const filled = rows.reduce((n, row) => n + numeric(row.quantity), 0);
    const notional = rows.reduce((n, row) => n + numeric(row.quantity) * numeric(row.price), 0);
    const times = rows.map((row) => iso(row.filledAt)!).sort();
    result.set(orderId, {
      requested_quantity: event ? numeric(event.requestedQuantity) : filled,
      filled_quantity: event ? numeric(event.filledQuantity) : filled,
      remaining_quantity: event ? numeric(event.remainingQuantity) : 0,
      average_fill_price: filled > 0 ? Number((notional / filled).toFixed(6)) : 0,
      fees: Number(rows.reduce((n, row) => n + numeric(row.fee), 0).toFixed(6)),
      status: event?.status ?? (filled > 0 ? 'EXECUTED' : 'SUBMITTED'),
      first_fill_at: times[0] ?? null, last_fill_at: times.at(-1) ?? null,
      venue_updated_at: iso(event?.occurredAt), fill_count: rows.length,
    });
  }
  return result;
}
