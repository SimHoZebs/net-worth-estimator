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
			? "border-primary-border/70 bg-primary-subtle/80 text-primary"
			: tone === "tertiary"
				? "border-tertiary-border/80 bg-tertiary-subtle/80 text-tertiary-foreground"
				: "border-border/80 bg-card/90";

	return (
		<Card className={`rounded-[1.6rem] ${toneClassName}`}>
			<CardContent className="space-y-2 p-5">
				<div className="type-label">{label}</div>
				<div className="type-title text-foreground">{value}</div>
				<div className="type-muted text-current/75">{detail}</div>
			</CardContent>
		</Card>
	);
});
