import { Menu } from "lucide-react";
import type { Ref } from "react";
import { IconButton } from "../components/Button.tsx";
import type { PageDefinition } from "./navigation.ts";

export function WorkspaceTopbar({
	page,
	onOpenNavigation,
}: {
	page: PageDefinition;
	onOpenNavigation: () => void;
}) {
	return (
		<>
			<title>{`${page.label} · Waypoint`}</title>
			<header className="hidden h-16 items-center gap-3 border-0 border-b border-solid border-line bg-surface px-6 max-md:flex print:hidden">
				<IconButton
					icon={Menu}
					label="Open navigation"
					onClick={onOpenNavigation}
				/>
				<span className="truncate text-sm font-semibold tracking-tight">
					{page.label}
				</span>
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
