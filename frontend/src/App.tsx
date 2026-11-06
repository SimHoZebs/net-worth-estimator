import { AuthBoundary } from "./auth/AuthBoundary.tsx";
import { useThemeSync } from "./state/useTheme.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { serverQueryClient } from "./state/serverQuery.ts";
import { createWorkspaceRouter } from "./workspace/router.ts";

const router = createWorkspaceRouter();

export default function App() {
	useThemeSync();
	return (
		<QueryClientProvider client={serverQueryClient()}>
			<AuthBoundary>
				<RouterProvider router={router} />
			</AuthBoundary>
		</QueryClientProvider>
	);
}
