import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/accounts")({
	staticData: { page: "accounts" },
	component: () => <Outlet />,
});
