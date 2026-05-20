export function TableSearch({
	value,
	onChange,
	placeholder = "Search...",
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	return (
		<input
			type="text"
			value={value}
			onChange={(e) => onChange(e.currentTarget.value)}
			placeholder={placeholder}
			className="mb-3 w-full max-w-xs rounded-lg border border-input bg-card px-3 py-1.5 type-body outline-none placeholder:text-muted-foreground focus:border-ring"
		/>
	);
}
