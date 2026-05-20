export function ColorSwatch({ color }: { color: string | null }) {
	if (!color) return <span className="text-muted-foreground/70">—</span>;
	return (
		<div className="flex items-center gap-2">
			<div
				className="h-4 w-4 rounded border border-border"
				style={{ backgroundColor: color }}
				title={color}
			/>
			<span className="type-code">{color}</span>
		</div>
	);
}
