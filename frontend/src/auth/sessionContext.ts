import { createContext, useContext } from "react";
import type { SessionResource } from "./resourceScope.ts";

export interface Session {
	enabled: boolean;
	provider?: string;
	authenticated?: boolean;
	allowed?: boolean;
	accountURL?: string;
	resource?: SessionResource;
	user?: { subject: string; name: string; role: string };
}

interface SessionContextValue {
	session: Session;
	logout: () => Promise<void>;
	logoutPending: boolean;
	logoutError: string;
}

// Session discovery and actions belong to AuthBoundary. Sidebar consumers
// share its state without a second request or a persistent identity store.
export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
	return useContext(SessionContext);
}
