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
import { Input } from "@/components/ui/input.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import {
	EditorField,
	EditorSelect,
	type EditorSelectOption,
} from "./editorFields.tsx";

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

function optionList(list: Option[]): EditorSelectOption[] {
	return list.map((item) => ({ value: item.id, label: item.name }));
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
		<EditorField label={label} htmlFor={id}>
			{children(id)}
		</EditorField>
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
		onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
			onField(key, event.target.value),
	});
	const select = (key: string) => ({
		value: fields[key] ?? "",
		onValueChange: (value: string) => onField(key, value),
	});
	const accountItems = optionList(accounts);
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
							<EditorSelect
								id={id}
								emptyLabel="Pick an account"
								options={accountItems}
								{...select("accountId")}
							/>
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
							<EditorSelect
								id={id}
								emptyLabel="Pick an account"
								options={accountItems}
								{...select("refId")}
							/>
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
						<EditorSelect
							id={id}
							emptyLabel="Pick an account"
							options={accountItems}
							{...select("accountId")}
						/>
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
							<EditorSelect
								id={id}
								emptyLabel="Pick a transaction"
								options={optionList(transactions)}
								{...select("paymentId")}
							/>
						)}
					</TemplateControl>
					<TemplateControl
						label="Card account"
						inputKey="accountId"
						prefix={prefix}
					>
						{(id) => (
							<EditorSelect
								id={id}
								emptyLabel="Pick an account"
								options={accountItems}
								{...select("accountId")}
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
								placeholder="e.g. 30"
								{...set("fee")}
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
							<EditorSelect
								id={id}
								emptyLabel="Pick an account"
								options={accountItems}
								{...select("accountId")}
							/>
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
							<EditorSelect
								id={id}
								emptyLabel="Pick gross pay"
								options={optionList(transactions)}
								{...select("grossId")}
							/>
						)}
					</TemplateControl>
					<TemplateControl
						label="Pre-tax slice transaction"
						inputKey="pretaxId"
						prefix={prefix}
					>
						{(id) => (
							<EditorSelect
								id={id}
								emptyLabel="Pick pre-tax slice"
								options={optionList(transactions)}
								{...select("pretaxId")}
							/>
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
								className="type-code"
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
		<div className="mt-3 mb-5 rounded-xl border border-border bg-transparent p-4">
			{!hidePicker && (
				<>
					<div className="grid grid-cols-2 gap-5 max-sm:grid-cols-1">
						<EditorField
							label="What kind of amount?"
							htmlFor={templatePickerId}
						>
							<EditorSelect
								id={templatePickerId}
								value={template.id}
								onValueChange={(next) => {
									setTemplateId(next);
									setFields({});
								}}
								options={list.map((item) => ({
									value: item.id,
									label: item.label,
								}))}
							/>
						</EditorField>
					</div>
					<p className="text-muted-foreground">
						<strong>{template.label}.</strong> {template.summary}{" "}
						{template.whenToUse && <span>Use when: {template.whenToUse}</span>}
					</p>
				</>
			)}
			{!fixedAmount && (
				<div className="grid grid-cols-2 gap-5 max-sm:grid-cols-1">
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
			<p className="text-muted-foreground">{plain}</p>
			<details>
				<summary>Show saved data (JSON)</summary>
				<pre className="max-h-70 overflow-auto rounded-xl border border-border bg-muted p-3 text-xs whitespace-pre-wrap [word-break:break-word]">
					{wire}
				</pre>
			</details>
			{onChange && (
				<div className="mt-6 flex flex-wrap items-center justify-end gap-3">
					<Button type="button" onClick={() => onChange(amount)}>
						Use this amount
					</Button>
				</div>
			)}
		</div>
	);
}
