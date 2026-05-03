export function filterRows<TRow extends object>(rows: TRow[], query: string): TRow[] {
  if (!query.trim()) return rows;
  const q = query.toLowerCase();
  return rows.filter((row) =>
    Object.values(row).some((v) =>
      String(v ?? "").toLowerCase().includes(q),
    ),
  );
}
