import { useRouterState } from "@tanstack/react-router";
import type { Ref } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar.tsx";
import { useBreadcrumbSlotSetter } from "./breadcrumbSlot.tsx";
import type { PageDefinition } from "./navigation.ts";

export function WorkspaceTopbar({ page }: { page: PageDefinition }) {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const setSlot = useBreadcrumbSlotSetter();
	const detail =
		pathname.startsWith("/accounts/") || pathname.startsWith("/groups/");
	return (
		<>
			<title>{`${page.label} · Waypoint`}</title>
			<header className="flex h-16 items-center gap-3 border-0 border-b border-solid border-border bg-card px-5 print:hidden sm:px-6">
				<SidebarTrigger />
				{detail ? (
					<div ref={setSlot} className="min-w-0 flex-1" />
				) : (
					<nav aria-label="Breadcrumb" className="min-w-0 flex-1">
						<ol className="m-0 flex min-w-0 list-none flex-nowrap items-center gap-2 p-0 text-xs">
							<li
								aria-current="page"
								title={page.label}
								className="min-w-0 max-w-[32ch] truncate font-medium"
							>
								{page.label}
							</li>
						</ol>
					</nav>
				)}
			</header>
		</>
	);
}

export function WorkspaceHeading({
	page,
	headingRef,
}: {
	page: PageDefinition;
	headingRef: Ref<HTMLHeadingElement>;
}) {
	return (
		<h1 className="sr-only" ref={headingRef} tabIndex={-1}>
			{page.title}
		</h1>
	);
}
