import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/groups")({
	staticData: { page: "groups" },
	component: () => <Outlet />,
});
