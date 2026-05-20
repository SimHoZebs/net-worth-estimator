import { Card, CardContent } from "@/components/ui/card";

export function SummaryCard({
	label,
	value,
}: {
	label: string;
	value: string;
}) {
	return (
		<Card size="sm" className="rounded-[1.4rem] border-border">
			<CardContent className="space-y-1 p-4">
				<div className="type-eyebrow">{label}</div>
				<div className="type-title">{value}</div>
			</CardContent>
		</Card>
	);
}
