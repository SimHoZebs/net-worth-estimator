import { type ReactNode } from "react";
import { Brand } from "@/components/Brand.tsx";
import { Button } from "@/components/Button.tsx";
import { redirectToSignIn } from "@/auth/navigation.ts";
import { SessionContext } from "@/auth/sessionContext.ts";
import { useResourceSession } from "@/auth/useResourceSession.ts";

export function AuthBoundary({ children }: { children: ReactNode }) {
	const { session, error, refresh, logout, logoutPending } =
		useResourceSession();
	// Automatic sign-in is owned by session verification's explicit denial
	// decision (once per boundary mount). This boundary keeps only the
	// stable prompt with its manual sign-in retry.
	// Stale-while-revalidate: a verified account stays mounted while a
	// later check runs or fails transiently. Only an explicit denial or a
	// first load without any verified session takes over the full screen.
	// Transient outages float a retry toast instead of wiping the UI.
	if (session?.allowed)
		return (
			<SessionContext value={{ session, logout, logoutPending }}>
				{children}
			</SessionContext>
		);
	// A first load with no verified session and a failed check names the
	// failure instead of idling on the loading state. Retry is the action;
	// sign-in stays hidden because it cannot succeed while the server is
	// unreachable.
	const failed = !session && error;
	return (
		<main className="mx-auto my-[12vh] max-w-2xl px-6">
			<Brand />
			<h1 className="mt-12 mb-4">
				{session?.authenticated
					? "Session access is unavailable"
					: failed
						? "Cannot reach your data."
						: "Your data. Your access."}
			</h1>
			<p className="mb-6 text-muted">
				{session?.authenticated
					? "Retry the access check, or sign out and sign in again."
					: session
						? "Redirecting for sign-in or account creation…"
						: error
							? "Retry the access check below."
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
