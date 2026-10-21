import {
	ArrowLeftRight,
	BriefcaseBusiness,
	GraduationCap,
	Home,
	ReceiptText,
	ShieldCheck,
	ShoppingBasket,
	Wallet,
	Wrench,
	Zap,
	type LucideIcon,
} from "lucide-react";
import type { FundingMovementKind } from "../../domain/fundingGaps.ts";

const movementIcons: Record<FundingMovementKind, LucideIcon> = {
	income: BriefcaseBusiness,
	housing: Home,
	utilities: Zap,
	groceries: ShoppingBasket,
	insurance: ShieldCheck,
	repair: Wrench,
	transfer: ArrowLeftRight,
	tax: ReceiptText,
	education: GraduationCap,
	other: Wallet,
};

export function FundingMovementIcon({
	kind,
	size = 16,
}: {
	kind: FundingMovementKind;
	size?: number;
}) {
	const Icon = movementIcons[kind];
	return <Icon size={size} aria-hidden="true" />;
}
