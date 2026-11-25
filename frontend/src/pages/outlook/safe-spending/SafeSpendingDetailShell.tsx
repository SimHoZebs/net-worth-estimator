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
import {
	SAFE_SPENDING_DETAIL_TABS,
	type SafeSpendingDetailTab,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";
import { cn } from "@/lib/utils.ts";

export function SafeSpendingDetailShell({
	tab,
	onTabChange,
	counts,
	caption,
	onClose,
	headerActions,
	headerStatus,
	showCloseButton = true,
	children,
}: {
	tab: SafeSpendingDetailTab;
	onTabChange: (tab: SafeSpendingDetailTab) => void;
	counts: Partial<Record<SafeSpendingDetailTab, number>>;
	caption?: string;
	onClose: () => void;
	headerActions?: React.ReactNode;
	headerStatus?: React.ReactNode;
	showCloseButton?: boolean;
	children: React.ReactNode;
}) {
	const title = labels.title;
	const id = useId();
	return (
		<Sheet
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<SheetContent
				side="right"
				aria-label={title}
				showCloseButton={showCloseButton}
			>
				<SheetHeader className={cn(headerActions && "relative pr-20")}>
					{caption && (
						<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
							{caption}
						</p>
					)}
					<SheetTitle>{title}</SheetTitle>
					<SheetDescription className="sr-only">
						SafeSpending detail view
					</SheetDescription>
					{headerStatus && (
						<div className="text-xs text-muted-foreground">{headerStatus}</div>
					)}
					{headerActions && (
						<div className="absolute top-3 right-3 flex items-center gap-1">
							{headerActions}
						</div>
					)}
				</SheetHeader>
				<SheetBody className="flex min-h-0 flex-col overflow-y-hidden">
					<Tabs
						value={tab}
						onValueChange={(next) => onTabChange(next as SafeSpendingDetailTab)}
						className="min-h-0 flex-1 gap-0"
					>
						<TabsList
							variant="line"
							scrollable
							aria-label="SafeSpending detail view"
							activateOnFocus
							className="mb-4 shrink-0 gap-6 max-sm:gap-5"
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
							className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
						>
							{children}
						</TabsContent>
					</Tabs>
				</SheetBody>
			</SheetContent>
		</Sheet>
	);
}
