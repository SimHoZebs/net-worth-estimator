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

function buildApiBaseUrl(): string | null {
	return normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL);
}

function configuredBaseUrl(
	config: WaypointRuntimeConfig | null | undefined,
): string | null {
	return (
		normalizeBaseUrl(
			config?.apiBaseUrl ?? config?.apiBase ?? config?.baseUrl,
		) ?? buildApiBaseUrl()
	);
}

export function getRuntimeConfig(): WaypointRuntimeConfig {
	const configured =
		typeof window === "undefined" ? undefined : window.__WAYPOINT_CONFIG__;
	return {
		apiBaseUrl: configuredBaseUrl(configured) ?? DEFAULT_RUNTIME_API_BASE_URL,
	};
}

export function getApiBaseUrl(
	config: WaypointRuntimeConfig | string | null = getRuntimeConfig(),
): string {
	if (typeof config === "string")
		return normalizeBaseUrl(config) ?? DEFAULT_RUNTIME_API_BASE_URL;
	return configuredBaseUrl(config) ?? DEFAULT_RUNTIME_API_BASE_URL;
}

export const runtimeConfig = getRuntimeConfig;
export const getRuntimeApiBaseUrl = getApiBaseUrl;
