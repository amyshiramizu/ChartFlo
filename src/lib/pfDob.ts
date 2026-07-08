// Normalize a free-text DOB ("1/4/1958", "01/04/1958", "1958-01-04") into
// strict ISO "YYYY-MM-DD". Returns null if it cannot be parsed.
export function normalizeDob(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  // Already ISO
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // US: M/D/YYYY or M-D-YYYY
  const us = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (us) {
    let [, m, d, y] = us;
    if (y.length === 2) y = (Number(y) > 30 ? '19' : '20') + y;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}
