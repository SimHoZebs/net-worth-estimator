import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	RouterContextProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { createElement, type ComponentType, type ReactNode } from "react";
import { createWorkspaceRouter } from "../workspace/router.ts";
import { validateWorkspaceSearch } from "../workspace/overlaySearch.ts";
import { ServerApp } from "../app/ServerApp.tsx";

// Test routers over the real generated route tree. pass an initial entry for
// the page under test; navigation actions are asserted against router state
// (memory history never touches window.location).
export function createWorkspaceTestRouter(initialEntry = "/outlook") {
	return createWorkspaceRouter(
		createMemoryHistory({ initialEntries: [initialEntry] }),
	);
}

export function renderWithWorkspaceTestRouter(
	initialEntry = "/outlook",
): ReturnType<typeof createWorkspaceTestRouter> {
	const router = createWorkspaceTestRouter(initialEntry);
	render(createElement(RouterProvider, { router }));
	return router;
}

const PAGE_PATHS = [
	"/outlook",
	"/accounts",
	"/transactions",
	"/flows",
	"/purchases",
	"/evaluations",
	"/inbox",
	"/sources",
] as const;

// A minimal tree for component tests whose subject renders on one page and
// navigates to the others. Page stubs keep Link targets matching.
export function createSubjectTestRouter({
	subjectRoute,
	subject,
	initialEntry,
}: {
	subjectRoute: string;
	subject: ReactNode;
	initialEntry: string;
}) {
	const rootRoute = createRootRoute({
		component: () => createElement(Outlet),
		validateSearch: validateWorkspaceSearch,
	});
	const stub = () => null;
	const children = PAGE_PATHS.map((path) =>
		createRoute({
			getParentRoute: () => rootRoute,
			path,
			component: path === subjectRoute ? () => subject : stub,
		}),
	);
	const groupsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/groups",
		component: () => createElement(Outlet),
	});
	const groupsIndexRoute = createRoute({
		getParentRoute: () => groupsRoute,
		path: "/",
		component: subjectRoute === "/groups" ? () => subject : stub,
	});
	const groupDetailRoute = createRoute({
		getParentRoute: () => groupsRoute,
		path: "/$groupId",
		component: subjectRoute === "/groups/$groupId" ? () => subject : stub,
	});
	return createRouter({
		routeTree: rootRoute.addChildren([
			...children,
			groupsRoute.addChildren([groupsIndexRoute, groupDetailRoute]),
		]),
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
	});
}

// Component tests need router context but own their subject's lifetime and
// rerenders. Resolve the memory route before mounting the subject.
export async function renderRouterSubject(
	subject: ReactNode,
	initialEntry = "/outlook",
) {
	const router = createSubjectTestRouter({
		subjectRoute: "",
		subject: null,
		initialEntry,
	});
	await router.load();
	const view = render(subject, {
		wrapper: ({ children }) => (
			<RouterContextProvider router={router}>{children}</RouterContextProvider>
		),
	});
	return { router, ...view };
}

// ServerApp as root component with a stub body, to exercise the shell alone.
export async function renderServerAppShell(
	body: ReactNode,
	initialEntry = "/outlook",
	wrapper?: ComponentType<{ children: ReactNode }>,
) {
	const rootRoute = createRootRoute({
		component: ServerApp,
	});
	const outlookRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/outlook",
		staticData: { page: "outlook" },
		component: () => body,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([outlookRoute]),
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
	});
	await router.load();
	const view = render(createElement(RouterProvider, { router }), { wrapper });
	return { router, ...view };
}
