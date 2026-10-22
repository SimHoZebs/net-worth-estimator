import { ServerApp } from "./app/ServerApp.tsx";
import { AuthBoundary } from "./auth/AuthBoundary.tsx";
import { useTheme } from "./state/useTheme.ts";

export default function App() {
	useTheme();
	return (
		<AuthBoundary>
			<ServerApp />
		</AuthBoundary>
	);
}
