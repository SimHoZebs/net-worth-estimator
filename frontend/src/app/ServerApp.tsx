import { useEffect, useRef } from "react";
import { Outlet, useMatches } from "@tanstack/react-router";
import { Button } from "@/components/ui/button.tsx";
import { FieldError } from "@/components/ui/field.tsx";
import { useSession, type Session } from "../auth/sessionContext.ts";
import { useUserScope } from "../state/useUserScope.ts";
import { useServerStatus } from "../state/workspaceResources.ts";
import { useWorkspaceSyncMonitor } from "../state/useWorkspaceSyncMonitor.ts";
import {
	WorkspaceHeading,
	WorkspaceTopbar,
} from "../workspace/WorkspaceHeader.tsx";
import { WorkspaceLayout } from "../workspace/WorkspaceLayout.tsx";
import { WorkspaceSidebar } from "../workspace/WorkspaceSidebar.tsx";
import { pageDefinition } from "../workspace/navigation.ts";
import { useWorkspaceOverlays } from "../workspace/useWorkspaceOverlays.ts";
import {
	WorkspaceDialogs,
	WorkspaceEvidence,
	WorkspaceInvalidLink,
} from "../workspace/WorkspaceDialogs.tsx";
import { GuestFrame } from "./GuestFrame.tsx";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";

export function ServerApp({ invalidLink = false }: { invalidLink?: boolean }) {
	// Startup enables resource queries. Screens subscribe to their own data.
	// No fetched data travels as props anywhere in this tree.
	const enabled = useUserScope().status === "ready";
	// Presence is a status flag, not a model read. Only the projection and
	// detail views that need the document fetch it.
	const status = useServerStatus({ enabled });
	useWorkspaceSyncMonitor(enabled);
	const overlays = useWorkspaceOverlays();

	const page = useMatches({
		select: (matches) =>
			matches.some((match) => match.status === "notFound" || match._notFound)
				? null
				: (matches.find((match) => match.staticData.page)?.staticData.page ??
					null),
	});
	const currentPage = page
		? pageDefinition(page)
		: {
				...pageDefinition("outlook"),
				label: "Page not found",
				title: "Page not found",
			};
	const headingRef = useRef<HTMLHeadingElement>(null);
	const pageRef = useRef(page);
	useEffect(() => {
		// Only a page switch moves focus to the heading. Search-only changes
		// (opening or closing an overlay) leave it alone: the dialog owns
		// focus while open and restores it on close.
		if (pageRef.current !== page) {
			pageRef.current = page;
			requestAnimationFrame(() => headingRef.current?.focus());
		}
	}, [page]);

	const sessionState = useSession();
	const session = sessionState?.session ?? null;
	const phase = sessionState?.phase ?? "checking";
	const sessionError = sessionState?.error ?? "";
	const refresh = sessionState?.refresh ?? (async () => {});
	const logout = sessionState?.logout ?? (async () => {});
	const logoutPending = sessionState?.logoutPending ?? false;

	// The layout stays mounted once. Only the body switches: session
	// denial or outage, recovery when the server holds no model, otherwise
	// the matched route. No state shows a whole-app skeleton; each page
	// and sidebar slot shows its own skeleton while its own query is
	// pending. A pending status is not a reason to withhold navigation, and
	// the sidebar, topbar, and heading keep their identity across loading
	// and workspace states.
	const blocked =
		!session?.allowed && (phase === "denied" || phase === "unavailable");
	const recovery = !blocked && status.data?.hasModel === false;
	// `authenticated` is the sign-in status, so its false value names the
	// guest session. Data access comes from the resource grants, not this.
	const guest = session !== null && !session.authenticated;
	return (
		<>
			{guest && <GuestFrame />}
			<WorkspaceLayout
				navigation={(close) => (
					<WorkspaceSidebar
						page={page}
						onClose={close}
						pending={status.isPending}
					/>
				)}
				header={(open) => (
					<WorkspaceTopbar page={currentPage} onOpenNavigation={open} />
				)}
			>
				{!recovery && !blocked && (
					<WorkspaceHeading page={currentPage} headingRef={headingRef} />
				)}
				{blocked ? (
					<SessionErrorBody
						session={session}
						error={sessionError}
						logoutPending={logoutPending}
						onRetry={() => {
							void refresh();
						}}
						onLogout={() => {
							void logout();
						}}
					/>
				) : recovery ? (
					<ServerWorkspaceRecovery />
				) : invalidLink ? (
					<WorkspaceInvalidLink onClose={overlays.closeUnavailable} />
				) : (
					<>
						<Outlet />
						{page && <WorkspaceEvidence overlays={overlays} />}
						{page && <WorkspaceDialogs overlays={overlays} />}
					</>
				)}
			</WorkspaceLayout>
		</>
	);
}

// A denial is terminal for this boundary. Guests are provisioned
// automatically, so a denied guest means the guest identity is missing or
// its grants are broken. Sign-in stays an explicit Configs action; this
// body offers retry instead of an automatic identity-provider redirect.
function SessionErrorBody({
	session,
	error,
	logoutPending,
	onRetry,
	onLogout,
}: {
	session: Session | null;
	error: string;
	logoutPending: boolean;
	onRetry: () => void;
	onLogout: () => void;
}) {
	return (
		<div className="mx-auto my-[12vh] max-w-2xl p-6 [&_p]:mb-6">
			<h1 className="mb-6">
				{session
					? session.authenticated
						? "Session access is unavailable"
						: "Workspace access is unavailable"
					: "Cannot reach your data."}
			</h1>
			<p>
				{session
					? session.authenticated
						? "Retry the access check, or sign out and sign in again."
						: "Retry the access check. If the problem continues, the workspace owner must restore guest access."
					: "Retry the access check below."}
			</p>
			<FieldError>{error}</FieldError>
			<div className="flex flex-wrap gap-3">
				{session?.authenticated && (
					<Button
						variant="secondary"
						disabled={logoutPending}
						onClick={onLogout}
					>
						{logoutPending ? "Signing out…" : "Sign out"}
					</Button>
				)}
				<Button variant="secondary" onClick={onRetry}>
					Retry access check
				</Button>
			</div>
		</div>
	);
}
