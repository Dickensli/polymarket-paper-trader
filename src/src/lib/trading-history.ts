export type HistoryType = 'orders' | 'executions' | 'settlements';
export function parseTradingHistoryQuery(params: URLSearchParams) {
  const requestedType = params.get('type');
  const type: HistoryType = requestedType === 'executions' || requestedType === 'settlements' ? requestedType : 'orders';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get('page_size') ?? '25', 10) || 25));
  return { type, page, pageSize, strategyId: params.get('strategy_id'), platform: params.get('platform'), market: params.get('market'), status: params.get('status'), dateFrom: params.get('date_from'), dateTo: params.get('date_to'), format: params.get('format') };
}
const csvCell = (value: unknown) => { const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
export function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\r\n');
}
