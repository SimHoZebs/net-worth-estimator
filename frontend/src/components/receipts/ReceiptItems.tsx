import { Plus, X } from "lucide-react";
import { emptyReceiptItem, type ReceiptItemDraft } from "@/domain/receipt.ts";
import { Button, IconButton } from "../Button.tsx";
import { InputField } from "../Field.tsx";

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
					<InputField
						label="Description"
						name={`item-${index}-description`}
						value={item.description}
						maxLength={300}
						required
						containerClassName="sm:col-span-2"
						onChange={(event) =>
							update(index, { description: event.target.value })
						}
					/>
					<InputField
						label="Quantity"
						name={`item-${index}-quantity`}
						type="number"
						min="0.001"
						step="any"
						value={item.quantity}
						onChange={(event) =>
							update(index, { quantity: event.target.value })
						}
					/>
					<InputField
						label="Unit price (USD)"
						name={`item-${index}-unit-price`}
						inputMode="decimal"
						value={item.unitPrice}
						onChange={(event) =>
							update(index, { unitPrice: event.target.value })
						}
					/>
					<InputField
						label="Item total (USD)"
						name={`item-${index}-total`}
						inputMode="decimal"
						value={item.total}
						onChange={(event) => update(index, { total: event.target.value })}
					/>
					<InputField
						label="Category"
						name={`item-${index}-category`}
						value={item.category}
						maxLength={80}
						onChange={(event) =>
							update(index, { category: event.target.value })
						}
					/>
					{!disabled && (
						<div className="flex justify-end sm:col-span-2">
							<IconButton
								icon={X}
								label={`Remove item ${index + 1}`}
								onClick={() => onChange(items.filter((_, i) => i !== index))}
							/>
						</div>
					)}
				</fieldset>
			))}
		</section>
	);
}
