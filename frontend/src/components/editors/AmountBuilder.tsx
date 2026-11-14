import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
	patchTemplateAmount,
	templateFieldsFromAmount,
} from "./amountDraft.ts";
import type {
	AmountTemplate,
	JsonValue,
	TransactionAmountResolution,
} from "../../api/contracts.ts";
import {
	FALLBACK_TEMPLATES,
	plainLanguageForAmount,
} from "../../domain/amountCatalog.ts";
import { Button } from "@/components/ui/button.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { cn } from "@/lib/utils.ts";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const fieldSelectClassName =
	"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60";
const fieldTextareaClassName =
	"w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle min-h-[6lh] resize-y disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0 field-sizing-fixed";

function numberOr(fallback: number, value: string): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

const DEFAULT_BRACKETS_JSON = JSON.stringify(
	[
		{ upTo: 2066.67, rate: 0.1 },
		{ upTo: null, rate: 0.12 },
	],
	null,
	1,
);

function parseBrackets(value: string): JsonValue[] {
	try {
		const parsed: unknown = JSON.parse(value || "[]");
		return Array.isArray(parsed) ? (parsed as JsonValue[]) : [];
	} catch {
		return [];
	}
}

type Option = { id: string; name: string };

function optionsFor(list: Option[], placeholder: string) {
	return (
		<>
			<option value="">{placeholder}</option>
			{list.map((item) => (
				<option key={item.id} value={item.id}>
					{item.name}
				</option>
			))}
		</>
	);
}

export function buildTemplateAmount(
	templateId: string,
	fields: Record<string, string>,
	accounts: { id: string }[],
): TransactionAmountResolution {
	const firstAccount = accounts[0]?.id ?? "checking";
	const get = (key: string, fallback: string) => fields[key] || fallback;
	switch (templateId) {
		case "growth":
			return {
				resolver: "expression",
				config: { expression: "(base) * growth" },
				inputs: {
					base: { source: "literal", value: numberOr(500, get("base", "500")) },
					growth: {
						source: "provider",
						provider: "growth-factor",
						arguments: {
							annualGrowthRate: numberOr(0.03, get("annualGrowthRate", "0.03")),
						},
					},
				},
			};
		case "account-percent":
			return {
				resolver: "expression",
				config: { expression: "balance * pct" },
				inputs: {
					balance: {
						source: "provider",
						provider: "account-balance",
						arguments: { id: get("accountId", firstAccount) },
					},
					pct: { source: "literal", value: numberOr(0.04, get("pct", "0.04")) },
				},
			};
		case "investment-growth":
			return {
				resolver: "expression",
				config: { expression: "ref * rate" },
				inputs: {
					ref: {
						source: "provider",
						provider: "model-value",
						arguments: { id: get("refId", firstAccount) },
					},
					rate: {
						source: "provider",
						provider: "occurrence-rate",
						arguments: {
							annualRate: numberOr(0.07, get("annualRate", "0.07")),
							volatility: numberOr(0.12, get("volatility", "0.12")),
						},
					},
				},
			};
		case "debt-minimum":
			return {
				resolver: "expression",
				config: { expression: "minimum" },
				inputs: {
					minimum: {
						source: "provider",
						provider: "terms-minimum",
						arguments: { id: get("accountId", firstAccount) },
					},
				},
			};
		case "late-fee":
			return {
				resolver: "expression",
				config: { expression: "fee" },
				inputs: {
					fee: {
						source: "provider",
						provider: "late-fee",
						arguments: {
							payment: get("paymentId", "card_payment"),
							account: get("accountId", firstAccount),
							fee: numberOr(30, get("fee", "30")),
						},
					},
				},
			};
		case "low-balance-fee":
			return {
				resolver: "expression",
				config: { expression: "fee" },
				inputs: {
					fee: {
						source: "provider",
						provider: "balance-fee",
						arguments: {
							account: get("accountId", firstAccount),
							threshold: numberOr(1500, get("threshold", "1500")),
							fee: numberOr(12, get("fee", "12")),
						},
					},
				},
			};
		case "federal-tax":
			return {
				resolver: "progressive-bracket",
				config: {
					deduction: numberOr(1341.67, get("deduction", "1341.67")),
					brackets: parseBrackets(get("brackets", DEFAULT_BRACKETS_JSON)),
				},
				inputs: {
					gross: {
						source: "provider",
						provider: "model-value",
						arguments: { id: get("grossId", "salary") },
					},
					pretax: {
						source: "provider",
						provider: "model-value",
						arguments: { id: get("pretaxId", "salary_401k") },
					},
				},
			};
		case "fixed":
		default:
			return {
				resolver: "expression",
				config: { expression: String(numberOr(500, get("amount", "500"))) },
				inputs: {},
			};
	}
}

function TemplateControl({
	label,
	inputKey,
	prefix,
	children,
}: {
	label: string;
	inputKey: string;
	prefix: string;
	children: (id: string) => ReactNode;
}) {
	const id = `${prefix}-${inputKey}`;
	return (
		<Field className="flex min-w-0 flex-col gap-2">
			<Label htmlFor={id} className={fieldLabelClassName}>
				{label}
			</Label>
			{children(id)}
		</Field>
	);
}

function TemplateFields({
	templateId,
	accounts,
	transactions,
	fields,
	onField,
}: {
	templateId: string;
	accounts: Option[];
	transactions: Option[];
	fields: Record<string, string>;
	onField: (key: string, value: string) => void;
}) {
	const prefix = useId();
	const set = (key: string) => ({
		value: fields[key] ?? "",
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
		) => onField(key, event.target.value),
	});
	const accountOptions = (placeholder: string) =>
		optionsFor(accounts, placeholder);
	switch (templateId) {
		case "fixed":
			return (
				<TemplateControl
					label="Dollars each time"
					inputKey="amount"
					prefix={prefix}
				>
					{(id) => (
						<Input
							id={id}
							name="amount"
							type="number"
							step="0.01"
							placeholder="e.g. 500"
							{...set("amount")}
							className={fieldInputClassName}
						/>
					)}
				</TemplateControl>
			);
		case "growth":
			return (
				<>
					<TemplateControl
						label="Starting dollars"
						inputKey="base"
						prefix={prefix}
					>
						{(id) => (
							<Input
								id={id}
								name="base"
								type="number"
								step="0.01"
								placeholder="e.g. 500"
								{...set("base")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
					<TemplateControl
						label="Yearly growth (0.03 = 3%)"
						inputKey="annualGrowthRate"
						prefix={prefix}
					>
						{(id) => (
							<Input
								id={id}
								name="annualGrowthRate"
								type="number"
								step="0.001"
								placeholder="e.g. 0.03"
								{...set("annualGrowthRate")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
				</>
			);
		case "account-percent":
			return (
				<>
					<TemplateControl label="Account" inputKey="accountId" prefix={prefix}>
						{(id) => (
							<select
								id={id}
								name="accountId"
								{...set("accountId")}
								className={fieldSelectClassName}
							>
								{accountOptions("Pick an account")}
							</select>
						)}
					</TemplateControl>
					<TemplateControl
						label="Percent (0.04 = 4%)"
						inputKey="pct"
						prefix={prefix}
					>
						{(id) => (
							<Input
								id={id}
								name="pct"
								type="number"
								step="0.001"
								placeholder="e.g. 0.04"
								{...set("pct")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
				</>
			);
		case "investment-growth":
			return (
				<>
					<TemplateControl
						label="Balance to grow"
						inputKey="refId"
						prefix={prefix}
					>
						{(id) => (
							<select
								id={id}
								name="refId"
								{...set("refId")}
								className={fieldSelectClassName}
							>
								{accountOptions("Pick an account")}
							</select>
						)}
					</TemplateControl>
					<TemplateControl
						label="Yearly rate (0.07 = 7%)"
						inputKey="annualRate"
						prefix={prefix}
					>
						{(id) => (
							<Input
								id={id}
								name="annualRate"
								type="number"
								step="0.001"
								placeholder="e.g. 0.07"
								{...set("annualRate")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
					<TemplateControl
						label="Wobble (0 = exact, 0.12 = bumpy)"
						inputKey="volatility"
						prefix={prefix}
					>
						{(id) => (
							<Input
								id={id}
								name="volatility"
								type="number"
								step="0.01"
								placeholder="e.g. 0.12"
								{...set("volatility")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
				</>
			);
		case "debt-minimum":
			return (
				<TemplateControl
					label="Card account"
					inputKey="accountId"
					prefix={prefix}
				>
					{(id) => (
						<select
							id={id}
							name="accountId"
							{...set("accountId")}
							className={fieldSelectClassName}
						>
							{accountOptions("Pick an account")}
						</select>
					)}
				</TemplateControl>
			);
		case "late-fee":
			return (
				<>
					<TemplateControl
						label="Payment to check"
						inputKey="paymentId"
						prefix={prefix}
					>
						{(id) => (
							<select
								id={id}
								name="paymentId"
								{...set("paymentId")}
								className={fieldSelectClassName}
							>
								{optionsFor(transactions, "Pick a transaction")}
							</select>
						)}
					</TemplateControl>
					<TemplateControl
						label="Card account"
						inputKey="accountId"
						prefix={prefix}
					>
						{(id) => (
							<select
								id={id}
								name="accountId"
								{...set("accountId")}
								className={fieldSelectClassName}
							>
								{accountOptions("Pick an account")}
							</select>
						)}
					</TemplateControl>
					<TemplateControl label="Fee dollars" inputKey="fee" prefix={prefix}>
						{(id) => (
							<Input
								id={id}
								name="fee"
								type="number"
								step="0.01"
								placeholder="e.g. 30"
								{...set("fee")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
				</>
			);
		case "low-balance-fee":
			return (
				<>
					<TemplateControl label="Account" inputKey="accountId" prefix={prefix}>
						{(id) => (
							<select
								id={id}
								name="accountId"
								{...set("accountId")}
								className={fieldSelectClassName}
							>
								{accountOptions("Pick an account")}
							</select>
						)}
					</TemplateControl>
					<TemplateControl
						label="Balance limit"
						inputKey="threshold"
						prefix={prefix}
					>
						{(id) => (
							<Input
								id={id}
								name="threshold"
								type="number"
								step="0.01"
								placeholder="e.g. 1500"
								{...set("threshold")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
					<TemplateControl label="Fee dollars" inputKey="fee" prefix={prefix}>
						{(id) => (
							<Input
								id={id}
								name="fee"
								type="number"
								step="0.01"
								placeholder="e.g. 12"
								{...set("fee")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
				</>
			);
		case "federal-tax":
			return (
				<>
					<TemplateControl
						label="Gross pay transaction"
						inputKey="grossId"
						prefix={prefix}
					>
						{(id) => (
							<select
								id={id}
								name="grossId"
								{...set("grossId")}
								className={fieldSelectClassName}
							>
								{optionsFor(transactions, "Pick gross pay")}
							</select>
						)}
					</TemplateControl>
					<TemplateControl
						label="Pre-tax slice transaction"
						inputKey="pretaxId"
						prefix={prefix}
					>
						{(id) => (
							<select
								id={id}
								name="pretaxId"
								{...set("pretaxId")}
								className={fieldSelectClassName}
							>
								{optionsFor(transactions, "Pick pre-tax slice")}
							</select>
						)}
					</TemplateControl>
					<TemplateControl
						label="Deduction per paycheck"
						inputKey="deduction"
						prefix={prefix}
					>
						{(id) => (
							<Input
								id={id}
								name="deduction"
								type="number"
								step="0.01"
								placeholder="e.g. 1341.67"
								{...set("deduction")}
								className={fieldInputClassName}
							/>
						)}
					</TemplateControl>
					<TemplateControl
						label="Brackets (JSON: upTo per paycheck, rate 0–1)"
						inputKey="brackets"
						prefix={prefix}
					>
						{(id) => (
							<Textarea
								id={id}
								className={cn("type-code", fieldTextareaClassName)}
								name="brackets"
								rows={4}
								defaultValue={fields["brackets"] ?? DEFAULT_BRACKETS_JSON}
								onChange={(event) => onField("brackets", event.target.value)}
							/>
						)}
					</TemplateControl>
				</>
			);
		default:
			return null;
	}
}

export function AmountBuilder({
	accounts,
	transactions,
	templates,
	initialTemplateId,
	hidePicker,
	fixedAmount,
	initialAmount,
	onChange,
}: {
	accounts: Option[];
	transactions: Option[];
	templates?: AmountTemplate[];
	initialTemplateId?: string;
	hidePicker?: boolean;
	fixedAmount?: TransactionAmountResolution;
	initialAmount?: TransactionAmountResolution;
	onChange?: (amount: TransactionAmountResolution) => void;
}) {
	const list = templates?.length ? templates : FALLBACK_TEMPLATES;
	const [templateId, setTemplateId] = useState(initialTemplateId ?? "fixed");
	const [fields, setFields] = useState<Record<string, string>>({});
	const template = list.find((item) => item.id === templateId) ?? list[0]!;
	const source = initialAmount ?? template.amount ?? undefined;
	const currentFields = {
		...templateFieldsFromAmount(template.id, source),
		...fields,
	};
	const amount = useMemo(() => {
		if (fixedAmount) return fixedAmount;
		const built = buildTemplateAmount(
			template.id,
			{ ...templateFieldsFromAmount(template.id, source), ...fields },
			accounts,
		);
		return source
			? patchTemplateAmount(template.id, source, built, fields)
			: built;
	}, [fixedAmount, source, template.id, fields, accounts]);
	const plain = plainLanguageForAmount(amount);
	const wire = JSON.stringify(amount, null, 2);
	const templatePickerId = useId();
	return (
		<div className="mt-3 mb-5 rounded-surface border border-solid border-line bg-transparent p-4">
			{!hidePicker && (
				<>
					<div className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1">
						<Field className="flex min-w-0 flex-col gap-2">
							<Label htmlFor={templatePickerId} className={fieldLabelClassName}>
								What kind of amount?
							</Label>
							<select
								id={templatePickerId}
								name="amountTemplate"
								value={template.id}
								onChange={(event) => {
									setTemplateId(event.target.value);
									setFields({});
								}}
								className={fieldSelectClassName}
							>
								{list.map((item) => (
									<option key={item.id} value={item.id}>
										{item.label}
									</option>
								))}
							</select>
						</Field>
					</div>
					<p className="text-muted">
						<strong>{template.label}.</strong> {template.summary}{" "}
						{template.whenToUse && <span>Use when: {template.whenToUse}</span>}
					</p>
				</>
			)}
			{!fixedAmount && (
				<div className="grid grid-cols-2 gap-5 max-sm:gap-x-3 max-sm:gap-y-4 max-sm:grid-cols-1">
					<TemplateFields
						templateId={template.id}
						accounts={accounts}
						transactions={transactions}
						fields={currentFields}
						onField={(key, value) =>
							setFields((previous) => ({ ...previous, [key]: value }))
						}
					/>
				</div>
			)}
			<p className="text-muted">{plain}</p>
			<details>
				<summary>Show saved data (JSON)</summary>
				<pre className="max-h-70 overflow-auto rounded-surface border border-solid border-line bg-surface-2 p-3 text-xs whitespace-pre-wrap [word-break:break-word]">
					{wire}
				</pre>
			</details>
			{onChange && (
				<div className="mt-6 flex flex-wrap items-center justify-end gap-3">
					<Button
						type="button"
						variant="default"
						className="min-h-10 border-primary bg-primary px-4 py-2 text-sm leading-snug text-on-primary enabled:hover:bg-primary-hover enabled:hover:shadow-sm focus-visible:outline-solid focus-visible:ring-0"
						onClick={() => onChange(amount)}
					>
						Use this amount
					</Button>
				</div>
			)}
		</div>
	);
}
