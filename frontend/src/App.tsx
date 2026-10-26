import { ServerApp } from "./app/ServerApp.tsx";
import { AuthBoundary } from "./auth/AuthBoundary.tsx";
import { useThemeSync } from "./state/useTheme.ts";

export default function App() {
	useThemeSync();
	return (
		<AuthBoundary>
			<ServerApp />
		</AuthBoundary>
	);
}
