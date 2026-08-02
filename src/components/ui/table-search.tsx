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
			aria-label="Search table"
			className="mb-3 w-full max-w-xs rounded-lg border border-input/90 bg-card/85 px-3 py-1.5 type-body shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-white/10"
		/>
	);
}
