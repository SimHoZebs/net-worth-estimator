export function ProjectionUpdating() {
	return (
		<div
			className="mb-4 flex items-center gap-3 text-sm text-muted"
			role="status"
		>
			<span
				className="size-3 animate-spin rounded-full border-2 border-solid border-line-strong border-t-primary"
				aria-hidden="true"
			/>
			Updating projection…
		</div>
	);
}
