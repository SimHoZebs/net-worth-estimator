import { Menu } from "lucide-react";
import type { Ref } from "react";
import { IconButton } from "../components/ui.tsx";
import type { PageDefinition } from "./navigation.ts";

export function WorkspaceTopbar({
	onOpenNavigation,
}: {
	onOpenNavigation: () => void;
}) {
	return (
		<header className="topbar">
			<IconButton
				icon={Menu}
				label="Open navigation"
				className="mobile-only"
				onClick={onOpenNavigation}
			/>
		</header>
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
