import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "../api/runtime.ts";
import { logout as logoutRequest } from "../api/generated/endpoints.ts";
import { sessionQueryClient } from "./sessionQuery.ts";
import { isRecord } from "../domain/guards.ts";
import {
	cancelResourceQueries,
	clearResourceQueryCache,
} from "../state/serverQuery.ts";
import { hydrateFinancialPreferences } from "../state/useSafeSpendingSettings.ts";
import {
	resetWorkspaceForResource,
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
import { dismissKey, notifyError } from "../state/notifications.ts";

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

	const verify = useCallback(function verifySession(): Promise<void> {
		verification.current?.controller.abort();
		const check: Verification = { controller: new AbortController() };
		verification.current = check;
		const { signal } = check.controller;
		const previous = owner.current;
		const apiBaseUrl = getApiBaseUrl();
		// Stale-while-revalidate: the first check fails closed, but later
		// rechecks keep the verified scope, workspace, and query results
		// mounted until discovery proves the owner changed or denies access.
		// Suspending upfront wiped the UI on every focus event and on
		// transient outages, which flickered and hid usable data.
		const pending = previous ? null : suspendResourceScope();
		check.pending = (async () => {
			try {
				if (!previous) await cancelResourceQueries();
				else await Promise.resolve();
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
				const input = sessionScopeInput(next.session, apiBaseUrl);
				const changed =
					!previous ||
					resourceScopeKey(
						sessionScopeInput(previous.session, previous.apiBaseUrl),
					) !== resourceScopeKey(input);
				if (!previous) {
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
					const verified = acceptResourceScope(input, pending!);
					if (
						!verified ||
						!(await hydrateFinancialPreferences(verified)) ||
						signal.aborted
					)
						return;
					owner.current = next;
					setSession(next.session);
					setStatus({ phase: "ready", error: "" });
					dismissKey("session");
					if (changed) announceSessionChange();
					return;
				}
				// A rejected request needs a fresh scope even if the same plan returns.
				if (!changed && getResourceScope().status === "ready") {
					if (!next.session.allowed) {
						suspendResourceScope();
						await cancelResourceQueries();
						if (signal.aborted) return;
						const activeLogout = signingOut.current as LogoutAttempt | null;
						if (activeLogout) {
							activeLogout.checkedSession = next;
							return;
						}
						resetWorkspaceForResource({ preserveVolatile: true });
						await clearResourceQueryCache();
						if (signal.aborted) return;
						owner.current = next;
						setSession(next.session);
						setStatus({
							phase: "denied",
							error: "This account does not have access to this plan.",
						});
						return;
					}
					if (signal.aborted) return;
					owner.current = next;
					setSession(next.session);
					setStatus({ phase: "ready", error: "" });
					dismissKey("session");
					return;
				}
				const hardPending = suspendResourceScope();
				await cancelResourceQueries();
				if (signal.aborted) return;
				const activeLogout = signingOut.current as LogoutAttempt | null;
				if (activeLogout) {
					activeLogout.checkedSession = next;
					return;
				}
				resetWorkspaceForResource({
					preserveVolatile: sameOwner(previous, next),
				});
				await clearResourceQueryCache();
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
				const verified = acceptResourceScope(input, hardPending);
				if (
					!verified ||
					!(await hydrateFinancialPreferences(verified)) ||
					signal.aborted
				)
					return;
				owner.current = next;
				setSession(next.session);
				setStatus({ phase: "ready", error: "" });
				dismissKey("session");
				if (changed) announceSessionChange();
			} catch (cause) {
				if (signal.aborted) return;
				check.error =
					cause instanceof Error
						? cause.message
						: "Authentication status is unavailable.";
				setStatus({ phase: "unavailable", error: check.error });
				// First-load outages use the full-screen fallback; only a
				// revalidation floats, since a verified workspace is mounted.
				if (previous)
					notifyError("session", check.error, {
						label: "Retry access check",
						onAction: () => {
							void verifySession();
						},
					});
			}
		})().finally(() => {
			check.pending = undefined;
		});
		return check.pending;
	}, []);
	const refresh = useCallback(() => {
		// Background revalidation keeps the verified workspace mounted.
		// Only the first check (no owner yet) uses the full-screen
		// checking state; later checks stay silent until discovery proves
		// a new owner, a denial, or an outage that keeps stale data visible.
		if (!owner.current) setStatus({ phase: "checking", error: "" });
		return verify();
	}, [verify]);

	const logout = useCallback(async () => {
		if (signingOut.current || !owner.current) return;
		if (useWorkspaceStore.getState().volatile) {
			const blocked =
				"Your draft has recovery data. Discard the draft before signing out.";
			setStatus((previous) => ({ ...previous, error: blocked }));
			notifyError("session-logout", blocked);
			return;
		}
		const attempt: LogoutAttempt = { ...owner.current };
		signingOut.current = attempt;
		setLogoutPending(true);
		setStatus((previous) => ({ ...previous, error: "" }));
		dismissKey("session-logout");
		try {
			const response = await sessionQueryClient
				.getMutationCache()
				.build(sessionQueryClient, {
					mutationKey: [
						"auth-logout",
						attempt.apiBaseUrl,
						attempt.session.user?.subject,
					],
					mutationFn: () => {
						if (signingOut.current !== attempt)
							throw new Error("The active session changed.");
						return logoutRequest({
							baseUrl: attempt.apiBaseUrl,
							headers: { "Waypoint-Resource": attempt.session.resource.id },
						});
					},
				})
				.execute(undefined);
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
			// Notify last: the refresh above can drive a scope transition
			// that clears the stack, which must not swallow this failure.
			notifyError("session-logout", error);
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
