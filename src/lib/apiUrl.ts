export function buildApiUrl(
	path: `/${string}`,
	baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
	const normalizedBaseUrl = baseUrl?.trim().replace(/\/+$/, "") ?? "";
	return `${normalizedBaseUrl}${path}`;
}
