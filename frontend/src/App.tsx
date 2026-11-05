import { ServerApp } from "./app/ServerApp.tsx";
import { AuthBoundary } from "./auth/AuthBoundary.tsx";
import { useThemeSync } from "./state/useTheme.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { serverQueryClient } from "./state/serverQuery.ts";

export default function App() {
	useThemeSync();
	return (
		<QueryClientProvider client={serverQueryClient()}>
			<AuthBoundary>
				<ServerApp />
			</AuthBoundary>
		</QueryClientProvider>
	);
}
