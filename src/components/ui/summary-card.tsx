import { Card, CardContent } from "@/components/ui/card";

export function SummaryCard({
	label,
	value,
}: {
	label: string;
	value: string;
}) {
	return (
		<Card
			size="sm"
			className="rounded-[1.4rem] border-slate-200 dark:border-slate-700"
		>
			<CardContent className="space-y-1 p-4">
				<div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
					{label}
				</div>
				<div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
					{value}
				</div>
			</CardContent>
		</Card>
	);
}
