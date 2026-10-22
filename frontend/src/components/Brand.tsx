export function Brand() {
	return (
		<a
			className="flex items-center gap-2 text-2xl font-bold tracking-tight"
			href="#outlook"
			aria-label="Waypoint home"
		>
			<span className="grid size-8 place-items-center rounded-lg bg-primary">
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
