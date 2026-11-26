import {
	Building2,
	CreditCard,
	Home,
	Landmark,
	type LucideIcon,
	PiggyBank,
	Wallet,
} from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { useState, type ComponentProps } from "react";
import { cn } from "@/lib/utils.ts";
import { businessLogoURL } from "../lib/businessLogos.ts";
import type { Account } from "../domain/model.ts";
import { ACCOUNT_TYPE_LABELS } from "../domain/accountKinds.ts";
import { cssVariables } from "./cssVariables.ts";

const icons: Record<Account["kind"], LucideIcon> = {
	cash: Wallet,
	investment: Landmark,
	property: Home,
	credit_card: CreditCard,
	debt: Building2,
};

/** Shared kind glyphs for pickers that render options outside AccountIcon. */
export const accountKindIcons: Record<Account["kind"], LucideIcon> = icons;

export const accountIconStyles = cva(
	"grid shrink-0 place-items-center rounded-md border",
	{
		variants: {
			kind: {
				cash: "border-transparent bg-accent text-muted-foreground",
				investment: "border-transparent bg-success-bg text-success-text",
				property: "border-transparent bg-warning-bg text-warning-text",
				credit_card: "border-transparent bg-danger-bg text-danger-text",
				debt: "border-transparent bg-danger-bg text-danger-text",
			},
			size: { sm: "size-8", md: "size-9", lg: "size-12 rounded-xl" },
			customColor: {
				true: "border-[color-mix(in_srgb,var(--account-color)_42%,var(--border))] bg-[color-mix(in_srgb,var(--account-color)_22%,var(--card))] text-(--account-color)",
			},
		},
		defaultVariants: { size: "md" },
	},
);

export const accountLabelStyles = cva("flex min-w-0 items-center gap-3");

const iconSizes = { sm: 17, md: 19, lg: 24 } as const;

export function AccountIcon({
	account,
	size = "md",
	className,
	style,
	...props
}: {
	account: Pick<Account, "id" | "kind" | "color" | "recognizedBusinessKey">;
	size?: NonNullable<VariantProps<typeof accountIconStyles>["size"]>;
} & ComponentProps<"span">) {
	const Icon = account.id === "savings" ? PiggyBank : icons[account.kind];
	const logoKey = account.recognizedBusinessKey;
	const logoURL = businessLogoURL(logoKey);
	// A key change starts a fresh load: both outcomes are tagged with the key
	// they belong to, so an old failure never hides a newly recognized logo.
	const [assetState, setAssetState] = useState<{
		key: string;
		status: "loaded" | "failed";
	} | null>(null);
	const status =
		logoKey && assetState?.key === logoKey ? assetState.status : "loading";
	const showLogo = Boolean(logoKey) && status === "loaded";
	return (
		<span
			{...props}
			className={cn(
				accountIconStyles({
					kind: account.color ? undefined : account.kind,
					size,
					customColor: Boolean(account.color),
				}),
				logoKey ? "relative" : undefined,
				className,
			)}
			style={{
				...(account.color
					? cssVariables({ "--account-color": account.color })
					: {}),
				...style,
			}}
		>
			{logoKey && logoURL && status !== "failed" ? (
				<img
					src={logoURL}
					alt=""
					aria-hidden="true"
					width={iconSizes[size]}
					height={iconSizes[size]}
					className={cn(
						"object-contain dark:invert",
						showLogo ? undefined : "pointer-events-none absolute opacity-0",
					)}
					onLoad={() => setAssetState({ key: logoKey, status: "loaded" })}
					onError={() => setAssetState({ key: logoKey, status: "failed" })}
				/>
			) : null}
			{showLogo ? null : (
				<Icon size={iconSizes[size]} strokeWidth={1.7} aria-hidden="true" />
			)}
		</span>
	);
}

export function AccountDot({ color }: { color: Account["color"] }) {
	return (
		<i
			className="inline-block size-2 shrink-0 rounded-full bg-[var(--account-color,var(--muted-foreground))]"
			style={color ? cssVariables({ "--account-color": color }) : undefined}
			aria-hidden="true"
		/>
	);
}

// Identity layout stays separate from the caller's navigation or toggle button.
export function AccountLabel({
	account,
	suffix,
	className,
	nameClassName,
	...props
}: {
	account: Pick<
		Account,
		"id" | "kind" | "color" | "name" | "recognizedBusinessKey"
	>;
	suffix?: string;
	nameClassName?: string;
} & ComponentProps<"span">) {
	return (
		<span {...props} className={cn(accountLabelStyles(), className)}>
			<AccountIcon account={account} />
			<span className="flex min-w-0 flex-col gap-1">
				<strong className={nameClassName}>{account.name}</strong>
				<small className="text-xs text-muted-foreground">
					{ACCOUNT_TYPE_LABELS[account.kind]}
					{suffix}
				</small>
			</span>
		</span>
	);
}
