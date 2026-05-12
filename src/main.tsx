import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ProjectionEngineProvider } from "./engine/ProjectionEngineContext";
import { WorkerProjectionEngine } from "./engine/WorkerProjectionEngine";
import "./styles.css";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
		},
	},
});

const engine = new WorkerProjectionEngine();

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ProjectionEngineProvider engine={engine}>
			<QueryClientProvider client={queryClient}>
				<App />
			</QueryClientProvider>
		</ProjectionEngineProvider>
	</React.StrictMode>,
);
