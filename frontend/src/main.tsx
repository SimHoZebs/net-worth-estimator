import { QueryClientProvider } from "@tanstack/react-query";
import { Component, type ErrorInfo, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { serverQueryClient } from "./state/serverQuery.ts";
import "@fontsource-variable/manrope";
// Establish cascade order before component recipes and generated utilities.
import "./styles/index.css";
import App from "./App.tsx";
import { Button } from "./components/Button.tsx";

class ErrorBoundary extends Component<
	{ children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Waypoint render failed", error, info.componentStack);
	}
	render() {
		if (this.state.failed)
			return (
				<main className="mx-auto my-[12vh] max-w-2xl p-6">
					<h1 className="mt-12 mb-6">Let’s get your outlook back.</h1>
					<p className="mb-6">
						The workspace could not be displayed. The server model and any
						browser draft remain unchanged.
					</p>
					<Button variant="primary" onClick={() => window.location.reload()}>
						Reload workspace
					</Button>
				</main>
			);
		return this.props.children;
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ErrorBoundary>
			<QueryClientProvider client={serverQueryClient()}>
				<App />
			</QueryClientProvider>
		</ErrorBoundary>
	</StrictMode>,
);
