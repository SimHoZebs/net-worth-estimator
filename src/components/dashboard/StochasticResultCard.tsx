import { Card, CardContent } from "@/components/ui/card";

interface StochasticResultCardProps {
	label: string;
	value: string;
	detail: string;
}

export function StochasticResultCard({
	label,
	value,
	detail,
}: StochasticResultCardProps) {
	return (
		<Card className="rounded-[1.6rem] border-border shadow-sm ">
			<CardContent className="p-4">
				<div className="type-eyebrow">{label}</div>
				<div className="mt-1 type-title">{value}</div>
				<div className="type-caption">{detail}</div>
			</CardContent>
		</Card>
	);
}
