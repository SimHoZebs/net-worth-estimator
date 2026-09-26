import { Component, type ErrorInfo, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import App from "./App.tsx";
import "./styles.css";
import "./account-activity.css";

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
				<main className="recovery-screen">
					<h1>Let’s get your outlook back.</h1>
					<p>
						The workspace could not be displayed. The server model and any
						browser draft remain unchanged.
					</p>
					<button
						type="button"
						className="button primary"
						onClick={() => window.location.reload()}
					>
						Reload workspace
					</button>
				</main>
			);
		return this.props.children;
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</StrictMode>,
);
