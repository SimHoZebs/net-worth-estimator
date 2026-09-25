export const RUNTIME_CONFIG_KEY = "__WAYPOINT_CONFIG__";
export const DEFAULT_RUNTIME_API_BASE_URL = "";

export interface WaypointRuntimeConfig {
	apiBaseUrl?: string;
	apiBase?: string;
	baseUrl?: string;
}

declare global {
	interface Window {
		__WAYPOINT_CONFIG__?: WaypointRuntimeConfig;
	}
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return trimmed.replace(/\/+$/, "") || DEFAULT_RUNTIME_API_BASE_URL;
}

export function getRuntimeConfig(): WaypointRuntimeConfig {
	if (typeof window === "undefined")
		return { apiBaseUrl: DEFAULT_RUNTIME_API_BASE_URL };
	const configured = window.__WAYPOINT_CONFIG__;
	const baseUrl = normalizeBaseUrl(
		configured?.apiBaseUrl ?? configured?.apiBase ?? configured?.baseUrl,
	);
	return { apiBaseUrl: baseUrl ?? DEFAULT_RUNTIME_API_BASE_URL };
}

export function getApiBaseUrl(
	config: WaypointRuntimeConfig | string | null = getRuntimeConfig(),
): string {
	if (typeof config === "string")
		return normalizeBaseUrl(config) ?? DEFAULT_RUNTIME_API_BASE_URL;
	return (
		normalizeBaseUrl(
			config?.apiBaseUrl ?? config?.apiBase ?? config?.baseUrl,
		) ?? DEFAULT_RUNTIME_API_BASE_URL
	);
}

export const runtimeConfig = getRuntimeConfig;
export const getRuntimeApiBaseUrl = getApiBaseUrl;
