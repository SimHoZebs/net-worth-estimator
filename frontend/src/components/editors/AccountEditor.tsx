import { useId, useState } from "react";
import type { Account } from "../../domain/model.ts";
import {
	ACCOUNT_KINDS,
	ACCOUNT_TYPE_LABELS,
} from "../../domain/accountKinds.ts";
import type { AccountKind } from "../../api/contracts.ts";
import { accountKindIcons } from "../AccountIcon.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/lib/utils.ts";
import {
	persistSyncedAccountKind,
	syncedKindError,
} from "../../state/accountKind.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { LoanEditor } from "./LoanEditor.tsx";
import { OrdinaryAccountEditor } from "./OrdinaryAccountEditor.tsx";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";

/** One stable dialog and identity section; account type owns the detail fields. */
export function AccountEditor(props: {
	item: Account | null;
	onSaved: () => void;
	onClose: () => void;
}) {
	const { item, onClose } = props;
	const initialType =
		isGroupedDisplay(item) || item?.kind === "debt"
			? "loan"
			: (item?.kind ?? "cash");
	const [type, setType] = useState<Account["kind"] | "loan">(initialType);
	const [name, setName] = useState(item?.name ?? "");
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [saving, setSaving] = useState(false);
	const [typeError, setTypeError] = useState<string | null>(null);
	const formId = useId();
	const enabledId = useId();
	const nameId = useId();
	const readOnly = item?.readOnly ?? false;
	useBeforeUnload(
		!saving &&
			(name !== (item?.name ?? "") ||
				enabled !== (item?.enabled ?? true) ||
				(!readOnly && type !== initialType)),
	);

	// The kind selector stays available on synced accounts: kind is a
	// user-configured label, and changing it here persists immediately
	// because the detail form below stays locked. The contradiction guard
	// matches the detail pane: a kind the bank balance contradicts is
	// refused with the same message instead of written.
	const changeType = (next: Account["kind"] | "loan") => {
		setTypeError(null);
		if (!item || !readOnly || next === "loan" || type === "loan") {
			setType(next);
			return;
		}
		if (next === item.kind) {
			setType(next);
			return;
		}
		const contradiction = syncedKindError(item.balance, next);
		if (contradiction) {
			setType(next);
			setTypeError(contradiction);
			return;
		}
		setType(next);
		void persistSyncedAccountKind(
			{
				id: item.id,
				name: item.name,
				enabled: item.enabled,
				color: item.color,
			},
			next,
		).then((ok) => {
			if (!ok)
				setTypeError(
					"The account type could not be saved. Review the workspace notice and try again.",
				);
		});
	};

	const typeOptions: {
		value: string;
		label: string;
		icon: (typeof accountKindIcons)[AccountKind];
	}[] = [
		...ACCOUNT_KINDS.filter((kind) => kind !== "debt").map((kind) => ({
			value: kind,
			label: ACCOUNT_TYPE_LABELS[kind],
			icon: accountKindIcons[kind],
		})),
		{ value: "loan", label: "Debt", icon: accountKindIcons.debt },
	];
	const ValueIcon =
		type === "loan" ? accountKindIcons.debt : accountKindIcons[type];

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>
						{item && isGroupedDisplay(item)
							? `Edit ${item.name}`
							: `${item ? "Edit" : "Add"} account`}
					</DialogTitle>
				</DialogHeader>
				<Field orientation="horizontal" className="items-center gap-4">
					<Label
						htmlFor={`${formId}-kind`}
						className="w-36 flex-none text-sm font-semibold text-muted"
					>
						Account type
					</Label>
					<Select
						value={type}
						onValueChange={(next) => {
							if (
								next === "loan" ||
								(ACCOUNT_KINDS as readonly string[]).includes(next ?? "")
							) {
								changeType(next as Account["kind"] | "loan");
							}
						}}
						disabled={isGroupedDisplay(item) || saving}
					>
						<SelectTrigger id={`${formId}-kind`} className="min-w-0 flex-1">
							<span className="flex min-w-0 flex-1 items-center gap-2">
								<ValueIcon
									size={16}
									aria-hidden="true"
									className="flex-none text-muted"
								/>
								<SelectValue>
									{type === "loan" ? "Debt" : ACCOUNT_TYPE_LABELS[type]}
								</SelectValue>
							</span>
						</SelectTrigger>
						<SelectContent>
							{typeOptions.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									<option.icon
										size={16}
										aria-hidden="true"
										className="flex-none text-muted"
									/>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				{typeError && (
					<p
						role="alert"
						className="m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text"
					>
						{typeError}
					</p>
				)}
				<fieldset
					disabled={readOnly || saving}
					className="m-0 mb-5 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1"
				>
					<legend className="sr-only">Account</legend>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label
							htmlFor={nameId}
							className="text-sm leading-normal font-semibold text-muted"
						>
							Account name
						</Label>
						<Input
							id={nameId}
							name="name"
							form={formId}
							required
							maxLength={100}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder={
								type === "loan" ? "e.g. Sallie Mae" : "e.g. Savings account"
							}
							className={cn(
								"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle",
								"disabled:bg-transparent",
								"focus-visible:outline-solid focus-visible:ring-0",
							)}
						/>
					</Field>
					<label
						htmlFor={enabledId}
						className="col-span-full flex min-h-11 items-center gap-3 text-sm text-muted"
					>
						<input
							id={enabledId}
							name="enabled"
							form={formId}
							type="checkbox"
							checked={enabled}
							onChange={(event) => setEnabled(event.target.checked)}
							className="m-0 size-5 flex-none cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-60"
						/>
						Include in net worth and projections
					</label>
				</fieldset>
				{type === "loan" ? (
					<LoanEditor
						{...props}
						formId={formId}
						name={name}
						enabled={enabled}
						onSavingChange={setSaving}
					/>
				) : (
					<OrdinaryAccountEditor
						{...props}
						formId={formId}
						name={name}
						kind={type}
						enabled={enabled}
						onSavingChange={setSaving}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
