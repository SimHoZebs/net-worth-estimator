export function OutcomeMetric({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-2xl border border-border/80 bg-surface/75 px-4 py-4 dark:border-white/10 dark:bg-surface/55">
			<div className="type-label">{label}</div>
			<div className="mt-2 type-metric">{value}</div>
			<div className="mt-1 type-muted">{detail}</div>
		</div>
	);
}
