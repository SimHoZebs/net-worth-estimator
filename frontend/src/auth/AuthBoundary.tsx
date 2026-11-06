import type { ReactNode } from "react";
import { Brand } from "@/components/Brand.tsx";
import { Button } from "@/components/Button.tsx";
import { SessionContext } from "@/auth/sessionContext.ts";
import { useResourceSession } from "@/auth/useResourceSession.ts";

export function AuthBoundary({ children }: { children: ReactNode }) {
	const { session, error, refresh, logout, logoutPending } =
		useResourceSession();
	// Verification runs beside the workspace, not in front of it. The same
	// wrapper stays mounted for the whole check so the workspace never
	// remounts when the answer arrives.
	if (!session && !error)
		return <SessionContext value={null}>{children}</SessionContext>;
	// A verified account stays mounted while later checks run or fail.
	// Re-checks own their retry notices; only an explicit denial blocks.
	if (session?.allowed)
		return (
			<SessionContext value={{ session, logout, logoutPending }}>
				{children}
			</SessionContext>
		);
	// A denial is a terminal state for this boundary. Guests are provisioned
	// automatically, so a denied guest means the guest identity is missing or
	// its grants are broken. Sign-in stays an explicit Configs action; this
	// screen offers retry instead of an automatic identity-provider redirect.
	return (
		<main className="mx-auto my-[12vh] max-w-2xl px-6">
			<Brand />
			<h1 className="mt-12 mb-4">
				{session
					? session.authenticated
						? "Session access is unavailable"
						: "Workspace access is unavailable"
					: "Cannot reach your data."}
			</h1>
			<p className="mb-6 text-muted">
				{session
					? session.authenticated
						? "Retry the access check, or sign out and sign in again."
						: "Retry the access check. If the problem continues, the workspace owner must restore guest access."
					: "Retry the access check below."}
			</p>
			{error && (
				<p role="alert" className="mb-4 text-danger-text">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-3">
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
				<Button
					onClick={() => {
						void refresh();
					}}
				>
					Retry access check
				</Button>
			</div>
		</main>
	);
}
