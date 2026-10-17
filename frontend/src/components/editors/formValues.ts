export const textValue = (data: FormData, name: string) =>
	String(data.get(name) ?? "").trim();
export function parseDisplayNumber(raw: string): number | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}
export const numberValue = (data: FormData, name: string) =>
	parseDisplayNumber(textValue(data, name)) ?? 0;
