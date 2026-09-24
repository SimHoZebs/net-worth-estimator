import { memo } from "react";
import { Metric } from "@/components/present/Present";
import { Card, CardContent } from "@/components/ui/Card";

export const DriverCard = memo(function DriverCard({
	label,
	value,
	detail,
	tone = "default",
}: {
	label: string;
	value: string;
	detail?: string;
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
			<CardContent className="p-4">
				<Metric
					label={label}
					value={value}
					detail={detail}
					className="border-0 bg-transparent p-0 dark:bg-transparent"
					valueClassName="mt-1 type-metric text-foreground"
					detailClassName="type-muted text-current/75"
				/>
			</CardContent>
		</Card>
	);
});
