import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Establish cascade order before component recipes and generated utilities.
import "./styles/index.css";
import App from "./App.tsx";
import { isInvalidWorkspaceLink } from "./workspace/overlaySearch.ts";

createRoot(document.getElementById("root")!, {
	onCaughtError(error, info) {
		// Invalid links render their own recovery UI. Keep unexpected route
		// and component errors visible to diagnostics.
		if (!isInvalidWorkspaceLink(error))
			console.error(error, info.componentStack);
	},
}).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
