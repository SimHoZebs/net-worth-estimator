import { type ReactNode, useEffect, useRef } from "react";
import { Brand } from "../components/Brand.tsx";
import { Button } from "../components/Button.tsx";
import { redirectToSignIn } from "./navigation.ts";
import { SessionContext } from "./sessionContext.ts";
import { useResourceSession } from "./useResourceSession.ts";

export function AuthBoundary({ children }: { children: ReactNode }) {
	const { session, error, refresh, phase, logout, logoutPending } =
		useResourceSession();
	// Automatic sign-in fires at most once per mount. Re-verification on
	// back-button restore or focus must land on the stable prompt with its
	// manual button instead of starting a second login that orphans the first.
	const redirected = useRef(false);
	useEffect(() => {
		if (
			phase === "denied" &&
			session?.authenticated === false &&
			!redirected.current
		) {
			redirected.current = true;
			redirectToSignIn();
		}
	}, [phase, session]);
	if (phase === "ready" && session?.allowed)
		return (
			<SessionContext
				value={{ session, logout, logoutPending, logoutError: error }}
			>
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
