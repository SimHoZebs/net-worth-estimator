export function CompactDetail({
	label,
	value,
}: {
	label: string;
	value: string;
}) {
	return (
		<div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0 last:pb-0 first:pt-0">
			<div className="type-muted">{label}</div>
			<div className="type-value text-sm">{value}</div>
		</div>
	);
}
