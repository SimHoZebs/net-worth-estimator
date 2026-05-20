import { memo } from "react";
import { Card, CardContent } from "@/components/ui/card";

export const DriverCard = memo(function DriverCard({
	label,
	value,
	detail,
	tone = "default",
}: {
	label: string;
	value: string;
	detail: string;
	tone?: "default" | "tertiary" | "primary";
}) {
	const toneClassName =
		tone === "primary"
			? "border-primary-border bg-primary-subtle"
			: tone === "tertiary"
				? "border-tertiary-border bg-tertiary-subtle"
				: "border-border bg-card";

	return (
		<Card className={`rounded-[1.6rem] shadow-sm ${toneClassName}`}>
			<CardContent className="space-y-2 p-5">
				<div className="type-label">{label}</div>
				<div className="type-title">{value}</div>
				<div className="type-muted">{detail}</div>
			</CardContent>
		</Card>
	);
});
