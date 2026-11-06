import { Skeleton } from "../components/Skeleton.tsx";

/**
 * Page-level data slot while a route chunk loads or its saved rows hydrate.
 * The shell chrome stays interactive; only the content region waits.
 */
export function WorkspacePageSkeleton({
	label = "Loading page",
}: {
	label?: string;
}) {
	return (
		<section className="grid gap-6" aria-busy="true" aria-label={label}>
			<div className="flex min-w-0 items-center justify-between gap-4">
				<Skeleton className="h-8 w-[60%] max-w-52" />
				<Skeleton className="h-8 w-[30%] max-w-28" />
			</div>
			<div className="rounded-surface border border-line bg-surface p-5">
				<div className="grid gap-4">
					<Skeleton className="h-4 w-36" />
					<Skeleton className="h-10 w-52" />
					<Skeleton className="h-56 w-full" />
				</div>
			</div>
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="rounded-surface border border-line bg-surface p-5">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="mt-4 h-24 w-full" />
				</div>
				<div className="rounded-surface border border-line bg-surface p-5">
					<Skeleton className="h-4 w-32" />
					<Skeleton className="mt-4 h-24 w-full" />
				</div>
			</div>
		</section>
	);
}
