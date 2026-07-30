import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import {
	createBrowserRouter,
	Navigate,
	RouterProvider,
} from "react-router-dom";
import App from "./App";
import { CachedProjectionEngine } from "./engine/CachedProjectionEngine";
import { ProjectionEngineProvider } from "./engine/ProjectionEngineContext";
import { WorkerProjectionEngine } from "./engine/WorkerProjectionEngine";
import { InMemoryProjectionArtifactStore } from "./lib/projection/artifacts";
import "./styles.css";
import { ModelInputsPage } from "./pages/ModelInputsPage";
import { ResultsPage } from "./pages/ResultsPage";
import { SettingsPage } from "./pages/SettingsPage";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
		},
	},
});

const engine = new CachedProjectionEngine(
	new WorkerProjectionEngine(),
	new InMemoryProjectionArtifactStore(),
);

const router = createBrowserRouter([
	{
		path: "/",
		element: <App />,
		children: [
			{ index: true, element: <ResultsPage /> },
			{ path: "settings", element: <SettingsPage /> },
			{ path: "model-inputs", element: <ModelInputsPage /> },
			{ path: "*", element: <Navigate to="/" replace /> },
		],
	},
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ProjectionEngineProvider engine={engine}>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</ProjectionEngineProvider>
	</React.StrictMode>,
);
