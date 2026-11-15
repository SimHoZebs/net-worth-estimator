import { useId } from "react";
import {
	Sheet,
	SheetBody,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet.tsx";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/components/ui/tabs.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { dateLabel } from "../../../domain/format.ts";
import {
	SAFE_SPENDING_DETAIL_TABS,
	type SafeSpendingDetailTab,
	type SafeSpendingCycleTab,
} from "./safeSpendingDetailModel.ts";

export function SafeSpendingDetailShell({
	tab,
	onTabChange,
	cycleCounts,
	range,
	onClose,
	children,
}: {
	tab: SafeSpendingDetailTab;
	onTabChange: (tab: SafeSpendingDetailTab) => void;
	cycleCounts: Partial<Record<SafeSpendingCycleTab, number>>;
	range?: { start: string; end: string };
	onClose: () => void;
	children: React.ReactNode;
}) {
	const title = "Safe spending";
	const counts: Partial<Record<SafeSpendingDetailTab, number>> = cycleCounts;
	const id = useId();
	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent side="right" aria-label={title}>
				<SheetHeader>
					{range && (
						<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
							{`${dateLabel(range.start, true)} – ${dateLabel(range.end, true)}`}
						</p>
					)}
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription className="sr-only">
						SafeSpending detail view
					</SheetDescription>
				</SheetHeader>
				<SheetBody className="flex flex-col gap-4">
					<Tabs
						value={tab}
						onValueChange={(next) => onTabChange(next as SafeSpendingDetailTab)}
						className="gap-0"
					>
						<TabsList
							variant="line"
							scrollable
							aria-label="SafeSpending detail view"
							activateOnFocus
							className="mb-4 gap-6 max-sm:gap-5"
						>
							{SAFE_SPENDING_DETAIL_TABS.map((item) => (
								<TabsTrigger
									key={item.id}
									id={`${id}-${item.id}`}
									value={item.id}
									className="flex-none"
								>
									{item.label}
									{counts[item.id] != null && (
										<Badge variant="secondary">{counts[item.id]}</Badge>
									)}
								</TabsTrigger>
							))}
						</TabsList>
						<TabsContent
							value={tab}
							id={`${id}-panel`}
							aria-labelledby={`${id}-${tab}`}
						>
							{children}
						</TabsContent>
					</Tabs>
				</SheetBody>
			</SheetContent>
		</Sheet>
	);
}
