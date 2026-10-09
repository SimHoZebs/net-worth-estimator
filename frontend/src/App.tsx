import { ServerApp } from "./app/ServerApp.tsx";
import { useTheme } from "./state/useTheme.ts";

export default function App() {
	useTheme();
	return <ServerApp />;
}
