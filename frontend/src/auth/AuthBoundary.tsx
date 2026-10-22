import { type ReactNode, useEffect, useState } from "react";
import { getApiBaseUrl } from "../api/runtime.ts";
import { Brand } from "../components/Brand.tsx";
import { Button } from "../components/Button.tsx";
import { clearResourceQueryCache } from "../state/serverQuery.ts";
import {
	resetWorkspaceForResource,
	useWorkspaceStore,
} from "../state/workspaceStore.ts";
import { redirectToSignIn } from "./navigation.ts";
import { SessionContext } from "./sessionContext.ts";
import { useResourceSession } from "./useResourceSession.ts";
import { announceSessionChange } from "./sessionChanges.ts";
import { getResourceScope, suspendResourceScope } from "./resourceScope.ts";

export function AuthBoundary({ children }: { children: ReactNode }) {
	const [logoutError, setLogoutError] = useState("");
	const [logoutPending, setLogoutPending] = useState(false);
	const { session, error: sessionError, refresh, ready } = useResourceSession();
	const error =
		logoutError ||
		sessionError ||
		(session?.authenticated && !session.allowed
			? "Your session could not be verified."
			: "");
	useEffect(() => {
		if (
			session?.enabled &&
			session.authenticated === false &&
			!session.allowed
		) {
			redirectToSignIn();
		}
	}, [session]);
	const logout = async () => {
		if (logoutPending) return;
		if (useWorkspaceStore.getState().volatile) {
			setLogoutError(
				"Your draft has recovery data. Export or discard the draft before signing out.",
			);
			return;
		}
		setLogoutError("");
		setLogoutPending(true);
		try {
			const scope = getResourceScope();
			const response = await fetch(`${getApiBaseUrl()}/v1/auth/logout`, {
				method: "POST",
				credentials: "same-origin",
				headers: scope.resource
					? { "X-Waypoint-Resource": scope.resource.id }
					: undefined,
			});
			if (!response.ok) throw new Error("Sign-out failed. Please retry.");
			if (scope !== getResourceScope())
				throw new Error("Your session changed. Retry the session check.");
			const signedOut = suspendResourceScope();
			resetWorkspaceForResource();
			await clearResourceQueryCache();
			announceSessionChange();
			const result = (await response.json()) as { logoutURL: string };
			if (signedOut !== getResourceScope())
				throw new Error("Your session changed. Retry the session check.");
			// The server supplies a configured OIDC logout URL, never a user redirect.
			window.location.assign(result.logoutURL);
		} catch (cause) {
			setLogoutError(
				cause instanceof Error ? cause.message : "Sign-out failed.",
			);
		} finally {
			setLogoutPending(false);
		}
	};
	if (ready && session && !session.enabled) return children;
	if (ready && session?.allowed)
		return (
			<SessionContext value={{ session, logout, logoutPending, logoutError }}>
				{children}
			</SessionContext>
		);
	return (
		<main className="mx-auto my-[12vh] max-w-2xl px-6">
			<Brand />
			<h1 className="mt-12 mb-4">
				{session?.authenticated
					? "Session access is unavailable"
					: "Your plan. Your access."}
			</h1>
			<p className="mb-6 text-muted">
				{session?.authenticated
					? "Retry the access check, or sign out and sign in again."
					: session
						? "Redirecting for sign-in or account creation…"
						: "Checking your session…"}
			</p>
			{error && (
				<p role="alert" className="mb-4 text-danger-text">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-3">
				{session && !session.authenticated && (
					<Button variant="primary" onClick={redirectToSignIn}>
						Continue to sign in
					</Button>
				)}
				{session?.authenticated && (
					<Button
						disabled={logoutPending}
						onClick={() => {
							void logout();
						}}
					>
						{logoutPending ? "Signing out…" : "Sign out"}
					</Button>
				)}
				{(error || session?.authenticated) && (
					<Button
						onClick={() => {
							void refresh();
						}}
					>
						Retry access check
					</Button>
				)}
			</div>
		</main>
	);
}
