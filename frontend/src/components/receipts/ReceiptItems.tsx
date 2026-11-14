import { Plus, X } from "lucide-react";
import { emptyReceiptItem, type ReceiptItemDraft } from "@/domain/receipt.ts";
import { Button } from "@/components/ui/button.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/lib/utils.ts";
import type { ReactNode } from "react";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const secondarySmallButtonClassName =
	"min-h-9 border-line-strong bg-surface px-3 py-2 text-xs leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0";

function ItemField({
	id,
	label,
	wide,
	children,
}: {
	id: string;
	label: string;
	wide?: boolean;
	children: (id: string) => ReactNode;
}) {
	return (
		<Field
			className={cn("flex min-w-0 flex-col gap-2", wide && "sm:col-span-2")}
		>
			<Label htmlFor={id} className={fieldLabelClassName}>
				{label}
			</Label>
			{children(id)}
		</Field>
	);
}

export function ReceiptItems({
	items,
	disabled,
	onChange,
}: {
	items: ReceiptItemDraft[];
	disabled: boolean;
	onChange: (items: ReceiptItemDraft[]) => void;
}) {
	const update = (index: number, patch: Partial<ReceiptItemDraft>) =>
		onChange(
			items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
		);
	return (
		<section className="flex flex-col gap-3" aria-label="Receipt items">
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-sm font-semibold">Line items</h3>
				{!disabled && (
					<Button
						variant="secondary"
						size="sm"
						className={secondarySmallButtonClassName}
						disabled={items.length >= 200}
						onClick={() => onChange([...items, emptyReceiptItem()])}
					>
						<Plus size={14} aria-hidden="true" />
						Add item
					</Button>
				)}
			</div>
			{items.length === 0 && (
				<p className="text-sm text-muted">No item details recorded.</p>
			)}
			{items.map((item, index) => (
				<fieldset
					key={index}
					className="relative grid gap-3 rounded-surface border border-line p-4 sm:grid-cols-2"
					disabled={disabled}
				>
					<legend className="px-1 text-xs font-semibold text-muted">
						Item {index + 1}
					</legend>
					<ItemField id={`item-${index}-description`} label="Description" wide>
						{(id) => (
							<Input
								id={id}
								name={`item-${index}-description`}
								value={item.description}
								maxLength={300}
								required
								onChange={(event) =>
									update(index, { description: event.target.value })
								}
								className={fieldInputClassName}
							/>
						)}
					</ItemField>
					<ItemField id={`item-${index}-quantity`} label="Quantity">
						{(id) => (
							<Input
								id={id}
								name={`item-${index}-quantity`}
								type="number"
								min="0.001"
								step="any"
								value={item.quantity}
								onChange={(event) =>
									update(index, { quantity: event.target.value })
								}
								className={fieldInputClassName}
							/>
						)}
					</ItemField>
					<ItemField id={`item-${index}-unit-price`} label="Unit price (USD)">
						{(id) => (
							<Input
								id={id}
								name={`item-${index}-unit-price`}
								inputMode="decimal"
								value={item.unitPrice}
								onChange={(event) =>
									update(index, { unitPrice: event.target.value })
								}
								className={fieldInputClassName}
							/>
						)}
					</ItemField>
					<ItemField id={`item-${index}-total`} label="Item total (USD)">
						{(id) => (
							<Input
								id={id}
								name={`item-${index}-total`}
								inputMode="decimal"
								value={item.total}
								onChange={(event) =>
									update(index, { total: event.target.value })
								}
								className={fieldInputClassName}
							/>
						)}
					</ItemField>
					<ItemField id={`item-${index}-category`} label="Category">
						{(id) => (
							<Input
								id={id}
								name={`item-${index}-category`}
								value={item.category}
								maxLength={80}
								onChange={(event) =>
									update(index, { category: event.target.value })
								}
								className={fieldInputClassName}
							/>
						)}
					</ItemField>
					{!disabled && (
						<div className="flex justify-end sm:col-span-2">
							<Button
								variant="ghost"
								size="icon"
								aria-label={`Remove item ${index + 1}`}
								onClick={() => onChange(items.filter((_, i) => i !== index))}
								className="text-muted enabled:hover:bg-hover enabled:hover:text-ink focus-visible:outline-solid focus-visible:ring-0"
							>
								<X size={18} aria-hidden="true" />
							</Button>
						</div>
					)}
				</fieldset>
			))}
		</section>
	);
}
