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
import type { FundingTransactionKind } from "../../domain/fundingGaps.ts";

const transactionIcons: Record<FundingTransactionKind, LucideIcon> = {
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

export function FundingTransactionIcon({
	kind,
	size = 16,
}: {
	kind: FundingTransactionKind;
	size?: number;
}) {
	const Icon = transactionIcons[kind];
	return <Icon size={size} aria-hidden="true" />;
}
