import { createContext, useContext } from "react";
import type { SessionUser } from "./resourceScope.ts";

export interface Session {
	enabled: true;
	provider?: string;
	authenticated: boolean;
	allowed: boolean;
	accountURL?: string;
	resource: SessionUser;
	// The server always provisions an ordinary user identity, including for
	// guests: subject names the provisioned user regardless of sign-in state.
	// `authenticated` stays the actual sign-in status for login/account UX,
	// never a permission or identity signal.
	user: { subject: string; name: string };
}

interface SessionContextValue {
	session: Session;
	logout: () => Promise<void>;
	logoutPending: boolean;
}

// AuthBoundary exposes the session hook's state and actions. Sidebar
// consumers share them without a second request or another identity store.
export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
	return useContext(SessionContext);
}
