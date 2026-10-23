import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "../api/runtime.ts";
import { isRecord } from "../domain/guards.ts";
import {
	cancelResourceQueries,
	clearResourceQueryCache,
} from "../state/serverQuery.ts";
import { hydrateFinancialPreferences } from "../state/useSafeSpendingSettings.ts";
import {
	resetWorkspaceForResource,
	suspendWorkspaceForVerification,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	getResourceScope,
	resourceScopeKey,
	suspendResourceScope,
} from "./resourceScope.ts";
import {
	announceSessionChange,
	listenForSessionChanges,
} from "./sessionChanges.ts";
import type { Session } from "./sessionContext.ts";
import { discoverSession, sessionScopeInput } from "./sessionDiscovery.ts";

interface SessionOwner {
	session: Session;
	apiBaseUrl: string;
}

interface LogoutAttempt extends SessionOwner {
	checkedSession?: SessionOwner;
}

interface Verification {
	controller: AbortController;
	pending?: Promise<void>;
	error?: string;
}

function sameOwner(a: SessionOwner, b: SessionOwner): boolean {
	return (
		canonicalApiBaseUrl(a.apiBaseUrl) === canonicalApiBaseUrl(b.apiBaseUrl) &&
		a.session.resource.id === b.session.resource.id &&
		a.session.user?.subject === b.session.user?.subject
	);
}

/** React owns the display state; refs guard work before the next render. */
export function useResourceSession() {
	const [session, setSession] = useState<Session | null>(null);
	const [status, setStatus] = useState<{
		phase: "checking" | "ready" | "denied" | "unavailable";
		error: string;
	}>({ phase: "checking", error: "" });
	const [logoutPending, setLogoutPending] = useState(false);
	const owner = useRef<SessionOwner | null>(null);
	const verification = useRef<Verification | null>(null);
	const signingOut = useRef<LogoutAttempt | null>(null);
	const mounted = useRef(false);

	const verify = useCallback((): Promise<void> => {
		verification.current?.controller.abort();
		const check: Verification = { controller: new AbortController() };
		verification.current = check;
		const { signal } = check.controller;
		const pending = suspendResourceScope();
		const apiBaseUrl = getApiBaseUrl();
		suspendWorkspaceForVerification();
		check.pending = (async () => {
			try {
				await cancelResourceQueries();
				if (signal.aborted) return;
				const next = {
					session: await discoverSession(signal, apiBaseUrl),
					apiBaseUrl,
				};
				if (signal.aborted) return;
				if (
					canonicalApiBaseUrl(apiBaseUrl) !==
					canonicalApiBaseUrl(getApiBaseUrl())
				)
					throw new Error("The API address changed. Retry the session check.");
				// Verification during logout must not remount financial screens.
				if (signingOut.current) {
					signingOut.current.checkedSession = next;
					return;
				}
				const previous = owner.current;
				const input = sessionScopeInput(next.session, apiBaseUrl);
				const changed =
					!previous ||
					resourceScopeKey(
						sessionScopeInput(previous.session, previous.apiBaseUrl),
					) !== resourceScopeKey(input);
				if (changed) {
					resetWorkspaceForResource({
						preserveVolatile: !!previous && sameOwner(previous, next),
					});
					await clearResourceQueryCache();
				}
				if (signal.aborted) return;
				if (!next.session.allowed) {
					owner.current = next;
					setSession(next.session);
					setStatus({
						phase: "denied",
						error: "This account does not have access to this plan.",
					});
					return;
				}
				const verified = acceptResourceScope(input, pending);
				if (
					!verified ||
					!(await hydrateFinancialPreferences(verified)) ||
					signal.aborted
				)
					return;
				owner.current = next;
				setSession(next.session);
				setStatus({ phase: "ready", error: "" });
				if (changed) announceSessionChange();
			} catch (cause) {
				if (signal.aborted) return;
				check.error =
					cause instanceof Error
						? cause.message
						: "Authentication status is unavailable.";
				setStatus({ phase: "unavailable", error: check.error });
			}
		})().finally(() => {
			check.pending = undefined;
		});
		return check.pending;
	}, []);
	const refresh = useCallback(() => {
		setStatus({ phase: "checking", error: "" });
		return verify();
	}, [verify]);

	const logout = useCallback(async () => {
		if (signingOut.current || !owner.current) return;
		if (useWorkspaceStore.getState().volatile) {
			setStatus((previous) => ({
				...previous,
				error:
					"Your draft has recovery data. Export or discard the draft before signing out.",
			}));
			return;
		}
		const attempt: LogoutAttempt = { ...owner.current };
		signingOut.current = attempt;
		setLogoutPending(true);
		setStatus((previous) => ({ ...previous, error: "" }));
		try {
			const response = await fetch(`${attempt.apiBaseUrl}/v1/auth/logout`, {
				method: "POST",
				credentials: "same-origin",
				headers: { "X-Waypoint-Resource": attempt.session.resource.id },
			});
			if (signingOut.current !== attempt) return;
			if (!response.ok) {
				if (response.status === 409) await refresh();
				throw new Error("Sign-out failed. Please retry.");
			}
			suspendResourceScope();
			resetWorkspaceForResource();
			// Local logout can complete even when prior discovery failed.
			if (verification.current) verification.current.error = undefined;
			setStatus({ phase: "checking", error: "" });
			await clearResourceQueryCache();
			announceSessionChange();
			const result: unknown = await response.json();
			while (verification.current?.pending) await verification.current.pending;
			if (signingOut.current !== attempt) return;
			if (verification.current?.error)
				throw new Error(verification.current.error);
			if (
				attempt.checkedSession?.session.authenticated &&
				!sameOwner(attempt, attempt.checkedSession)
			)
				throw new Error("Your session changed. Retry the session check.");
			if (!isRecord(result) || typeof result.logoutURL !== "string")
				throw new Error("Sign-out failed. Please retry.");
			window.location.assign(result.logoutURL);
		} catch (cause) {
			if (signingOut.current !== attempt) return;
			signingOut.current = null;
			const error = cause instanceof Error ? cause.message : "Sign-out failed.";
			if (
				getResourceScope().status === "pending" &&
				!verification.current?.error
			)
				await refresh();
			if (mounted.current) setStatus((previous) => ({ ...previous, error }));
		} finally {
			if (
				mounted.current &&
				(!signingOut.current || signingOut.current === attempt)
			) {
				signingOut.current = null;
				setLogoutPending(false);
			}
		}
	}, [refresh]);

	useEffect(() => {
		mounted.current = true;
		void verify();
		const check = () => void refresh();
		const stopChanges = listenForSessionChanges(check);
		const visible = () => {
			if (document.visibilityState === "visible") check();
		};
		const restored = (event: PageTransitionEvent) => {
			if (event.persisted) check();
		};
		window.addEventListener("focus", check);
		window.addEventListener("waypoint:authentication-required", check);
		window.addEventListener("pageshow", restored);
		document.addEventListener("visibilitychange", visible);
		return () => {
			stopChanges();
			window.removeEventListener("focus", check);
			window.removeEventListener("waypoint:authentication-required", check);
			window.removeEventListener("pageshow", restored);
			document.removeEventListener("visibilitychange", visible);
			mounted.current = false;
			verification.current?.controller.abort();
			signingOut.current = null;
			owner.current = null;
			suspendResourceScope();
			resetWorkspaceForResource();
			void clearResourceQueryCache();
		};
	}, [refresh, verify]);
	return { ...status, session, logoutPending, refresh, logout };
}
