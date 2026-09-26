import { FixtureApp } from "./app/FixtureApp.tsx";
import { ServerApp } from "./app/ServerApp.tsx";

const runtimeMode =
	import.meta.env.VITE_WAYPOINT_MODE === "fixture" ? "fixture" : "server";

export default function App() {
	return runtimeMode === "fixture" ? <FixtureApp /> : <ServerApp />;
}
