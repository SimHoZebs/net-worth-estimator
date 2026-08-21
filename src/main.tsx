import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, type ReactNode, StrictMode, Suspense } from "react";
import ReactDOM from "react-dom/client";
import {
	createBrowserRouter,
	Navigate,
	RouterProvider,
} from "react-router-dom";
import App from "./App";
import {
	RouteErrorFallback,
	RouteLoadingFallback,
} from "./components/RouteErrorFallback";
import { createApplicationProjectionEngine } from "./engine/applicationProjectionEngine";
import { ProjectionEngineProvider } from "./engine/ProjectionEngineContext";
import "./styles.css";

const AnalysisPage = lazy(() =>
	import("./pages/AnalysisPage").then(({ AnalysisPage }) => ({
		default: AnalysisPage,
	})),
);
const ModelInputsPage = lazy(() =>
	import("./pages/ModelInputsPage").then(({ ModelInputsPage }) => ({
		default: ModelInputsPage,
	})),
);
const ResultsPage = lazy(() =>
	import("./pages/ResultsPage").then(({ ResultsPage }) => ({
		default: ResultsPage,
	})),
);
const SettingsPage = lazy(() =>
	import("./pages/SettingsPage").then(({ SettingsPage }) => ({
		default: SettingsPage,
	})),
);

function lazyElement(element: ReactNode) {
	return <Suspense fallback={<RouteLoadingFallback />}>{element}</Suspense>;
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			refetchOnWindowFocus: false,
		},
	},
});

const engine = createApplicationProjectionEngine();

const router = createBrowserRouter([
	{
		path: "/",
		element: <App />,
		errorElement: <RouteErrorFallback />,
		children: [
			{ index: true, element: lazyElement(<ResultsPage />) },
			{ path: "analysis", element: lazyElement(<AnalysisPage />) },
			{ path: "settings", element: lazyElement(<SettingsPage />) },
			{ path: "model-inputs", element: lazyElement(<ModelInputsPage />) },
			{ path: "*", element: <Navigate to="/" replace /> },
		],
	},
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ProjectionEngineProvider engine={engine}>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</ProjectionEngineProvider>
	</StrictMode>,
);
