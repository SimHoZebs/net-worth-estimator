import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";

export function Brand() {
	const navigation = useWorkspaceNavigation();
	return (
		<a
			className="flex items-center gap-2 text-2xl font-bold tracking-tight"
			href="/outlook"
			onClick={(event) => {
				if (
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey ||
					event.button !== 0
				) {
					return;
				}
				event.preventDefault();
				navigation.navigate("outlook");
			}}
			aria-label="Waypoint home"
		>
			<span className="grid size-8 place-items-center rounded-surface bg-primary">
				<svg
					className="w-7 fill-none stroke-success-bg [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]"
					viewBox="0 0 32 32"
					aria-hidden="true"
				>
					<path d="m5 23 6-15 6 12 5-9 5 12" />
				</svg>
			</span>
			<span>
				waypoint<span className="text-primary">.</span>
			</span>
		</a>
	);
}
