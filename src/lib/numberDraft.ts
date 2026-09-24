const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseDecimalDraft(value: string): number | null {
	const trimmed = value.trim();
	if (!DECIMAL_NUMBER.test(trimmed)) return null;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}
