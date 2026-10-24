import { LogIn, LogOut, UserRound } from "lucide-react";
import { Button } from "../components/Button.tsx";
import { redirectToSignIn } from "./navigation.ts";
import { useSession } from "./sessionContext.ts";

export function SessionAccountControl() {
	const account = useSession();
	if (!account?.session.allowed) return null;
	const { session, logout, logoutPending, logoutError } = account;
	const authenticated = session.authenticated === true;
	return (
		<div className="mb-6 min-w-0 border-0 border-b border-solid border-line px-2 pb-5">
			<div className="flex min-w-0 items-start gap-2">
				<UserRound
					size={18}
					strokeWidth={1.7}
					className="mt-0.5 shrink-0 text-muted"
					aria-hidden="true"
				/>
				<div className="min-w-0">
					<p className="m-0 break-words text-sm font-semibold text-ink">
						{authenticated
							? session.user?.name || session.user?.subject || "Signed in"
							: "Guest"}
					</p>
					{!authenticated && (
						<p className="mt-1 mb-0 text-xs text-muted">Read-only preview</p>
					)}
				</div>
			</div>
			<div className="mt-3 grid gap-1">
				{authenticated && (
					<a
						href="#account"
						className="flex min-h-9 items-center rounded-control text-xs leading-relaxed font-medium text-muted underline decoration-line-strong underline-offset-4 hover:text-primary pointer-coarse:min-h-12"
					>
						Account settings
					</a>
				)}
				{authenticated ? (
					<Button
						variant="ghost"
						size="sm"
						className="justify-start px-0"
						disabled={logoutPending}
						onClick={() => {
							void logout();
						}}
					>
						<LogOut size={14} aria-hidden="true" />
						{logoutPending ? "Signing out…" : "Sign out"}
					</Button>
				) : (
					<Button
						variant="ghost"
						size="sm"
						className="justify-start px-0"
						onClick={redirectToSignIn}
					>
						<LogIn size={14} aria-hidden="true" />
						Sign in
					</Button>
				)}
			</div>
			{logoutError && (
				<p
					role="alert"
					className="mt-3 mb-0 break-words text-xs text-danger-text"
				>
					{logoutError}
				</p>
			)}
		</div>
	);
}
