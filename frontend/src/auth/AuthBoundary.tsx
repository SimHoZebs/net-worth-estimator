import type { ReactNode } from "react";
import { SessionContext } from "@/auth/sessionContext.ts";
import { useResourceSession } from "@/auth/useResourceSession.ts";

export function AuthBoundary({ children }: { children: ReactNode }) {
	const { session, phase, error, refresh, logout, logoutPending } =
		useResourceSession();
	// Verification runs beside the workspace, not in front of it. The shell
	// stays mounted while the check resolves; a denial or outage renders
	// inside the layout body instead of replacing the shell.
	return (
		<SessionContext
			value={{ session, phase, error, refresh, logout, logoutPending }}
		>
			{children}
		</SessionContext>
	);
}
