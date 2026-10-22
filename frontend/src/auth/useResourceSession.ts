import { QueryClient, useQuery } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { getApiBaseUrl } from "../api/runtime.ts";
import { clearResourceQueryCache } from "../state/serverQuery.ts";
import { resetWorkspaceForResource } from "../state/workspaceStore.ts";
import { hydrateFinancialPreferences } from "../state/useSafeSpendingSettings.ts";
import { discoverSession, sessionScopeInput } from "./sessionDiscovery.ts";
import {
	announceSessionChange,
	listenForSessionChanges,
} from "./sessionChanges.ts";
import {
	acceptResourceScope,
	getResourceScope,
	resourceScopeKey,
	subscribeResourceScope,
	suspendResourceScope,
} from "./resourceScope.ts";
import type { Session } from "./sessionContext.ts";

export function useResourceSession() {
	// Discovery must survive projection-cache cancellation and removal.
	const [client] = useState(
		() => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	);
	const [check, setCheck] = useState(0);
	const [accepted, setAccepted] = useState<Session | null>(null);
	const lastKey = useRef<string | null>(null);
	const scope = useSyncExternalStore(
		subscribeResourceScope,
		getResourceScope,
		getResourceScope,
	);
	const query = useQuery(
		{
			queryKey: ["auth-session", getApiBaseUrl(), check],
			queryFn: ({ signal }) => discoverSession(signal),
			staleTime: 0,
			gcTime: 0,
			refetchOnWindowFocus: false,
		},
		client,
	);
	const refresh = useCallback(() => {
		suspendResourceScope();
		setCheck((value) => value + 1);
	}, []);
	useEffect(() => {
		suspendResourceScope();
		const stopChanges = listenForSessionChanges(refresh);
		const visible = () => {
			if (document.visibilityState === "visible") refresh();
		};
		const restored = (event: PageTransitionEvent) => {
			if (event.persisted) refresh();
		};
		window.addEventListener("focus", refresh);
		window.addEventListener("waypoint:authentication-required", refresh);
		window.addEventListener("pageshow", restored);
		document.addEventListener("visibilitychange", visible);
		return () => {
			stopChanges();
			window.removeEventListener("focus", refresh);
			window.removeEventListener("waypoint:authentication-required", refresh);
			window.removeEventListener("pageshow", restored);
			document.removeEventListener("visibilitychange", visible);
			suspendResourceScope();
			resetWorkspaceForResource();
			void clearResourceQueryCache();
		};
	}, [refresh]);
	useEffect(() => {
		if (query.isFetching) return;
		const session = query.error ? null : query.data;
		const pending = getResourceScope();
		let active = true;
		const accept = async () => {
			if (!session || (session.enabled && !session.allowed)) {
				resetWorkspaceForResource();
				await clearResourceQueryCache();
				return;
			}
			const input = sessionScopeInput(session);
			const key = resourceScopeKey(input);
			const changed = lastKey.current !== key;
			resetWorkspaceForResource({ preserveVolatile: !changed });
			await clearResourceQueryCache();
			if (!active) return;
			const verified = acceptResourceScope(input, pending);
			if (
				!verified ||
				!(await hydrateFinancialPreferences(verified)) ||
				!active
			)
				return;
			lastKey.current = key;
			setAccepted(session);
			if (changed) announceSessionChange();
		};
		void accept();
		return () => {
			active = false;
		};
	}, [query.data, query.error, query.isFetching]);
	const ready =
		!query.isFetching &&
		!query.error &&
		accepted === query.data &&
		scope.status !== "pending";
	return {
		session: query.error
			? null
			: ready || (query.data?.enabled && !query.data.allowed)
				? query.data
				: undefined,
		error: query.error?.message ?? "",
		refresh,
		ready,
	};
}
