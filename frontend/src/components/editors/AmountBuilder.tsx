import { useMemo, useState } from "react";
import type {
	AmountTemplate,
	JsonValue,
	PostingAmountResolution,
} from "../../api/contracts.ts";
import {
	FALLBACK_TEMPLATES,
	plainLanguageForAmount,
} from "../../domain/amountCatalog.ts";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { InputField, SelectField, TextAreaField } from "../Field.tsx";

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
): PostingAmountResolution {
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

function TemplateFields({
	templateId,
	accounts,
	postings,
	fields,
	onField,
}: {
	templateId: string;
	accounts: Option[];
	postings: Option[];
	fields: Record<string, string>;
	onField: (key: string, value: string) => void;
}) {
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
				<InputField
					label="Dollars each time"
					name="amount"
					type="number"
					step="0.01"
					placeholder="e.g. 500"
					{...set("amount")}
				/>
			);
		case "growth":
			return (
				<>
					<InputField
						label="Starting dollars"
						name="base"
						type="number"
						step="0.01"
						placeholder="e.g. 500"
						{...set("base")}
					/>
					<InputField
						label="Yearly growth (0.03 = 3%)"
						name="annualGrowthRate"
						type="number"
						step="0.001"
						placeholder="e.g. 0.03"
						{...set("annualGrowthRate")}
					/>
				</>
			);
		case "account-percent":
			return (
				<>
					<SelectField label="Account" name="accountId" {...set("accountId")}>
						{accountOptions("Pick an account")}
					</SelectField>
					<InputField
						label="Percent (0.04 = 4%)"
						name="pct"
						type="number"
						step="0.001"
						placeholder="e.g. 0.04"
						{...set("pct")}
					/>
				</>
			);
		case "investment-growth":
			return (
				<>
					<SelectField label="Balance to grow" name="refId" {...set("refId")}>
						{accountOptions("Pick an account")}
					</SelectField>
					<InputField
						label="Yearly rate (0.07 = 7%)"
						name="annualRate"
						type="number"
						step="0.001"
						placeholder="e.g. 0.07"
						{...set("annualRate")}
					/>
					<InputField
						label="Wobble (0 = exact, 0.12 = bumpy)"
						name="volatility"
						type="number"
						step="0.01"
						placeholder="e.g. 0.12"
						{...set("volatility")}
					/>
				</>
			);
		case "debt-minimum":
			return (
				<SelectField
					label="Card account"
					name="accountId"
					{...set("accountId")}
				>
					{accountOptions("Pick an account")}
				</SelectField>
			);
		case "late-fee":
			return (
				<>
					<SelectField
						label="Payment to check"
						name="paymentId"
						{...set("paymentId")}
					>
						{optionsFor(postings, "Pick a movement")}
					</SelectField>
					<SelectField
						label="Card account"
						name="accountId"
						{...set("accountId")}
					>
						{accountOptions("Pick an account")}
					</SelectField>
					<InputField
						label="Fee dollars"
						name="fee"
						type="number"
						step="0.01"
						placeholder="e.g. 30"
						{...set("fee")}
					/>
				</>
			);
		case "low-balance-fee":
			return (
				<>
					<SelectField label="Account" name="accountId" {...set("accountId")}>
						{accountOptions("Pick an account")}
					</SelectField>
					<InputField
						label="Balance limit"
						name="threshold"
						type="number"
						step="0.01"
						placeholder="e.g. 1500"
						{...set("threshold")}
					/>
					<InputField
						label="Fee dollars"
						name="fee"
						type="number"
						step="0.01"
						placeholder="e.g. 12"
						{...set("fee")}
					/>
				</>
			);
		case "federal-tax":
			return (
				<>
					<SelectField
						label="Gross pay movement"
						name="grossId"
						{...set("grossId")}
					>
						{optionsFor(postings, "Pick gross pay")}
					</SelectField>
					<SelectField
						label="Pre-tax slice movement"
						name="pretaxId"
						{...set("pretaxId")}
					>
						{optionsFor(postings, "Pick pre-tax slice")}
					</SelectField>
					<InputField
						label="Deduction per paycheck"
						name="deduction"
						type="number"
						step="0.01"
						placeholder="e.g. 1341.67"
						{...set("deduction")}
					/>
					<TextAreaField
						label="Brackets (JSON: upTo per paycheck, rate 0–1)"
						className="type-code"
						name="brackets"
						rows={4}
						defaultValue={fields["brackets"] ?? DEFAULT_BRACKETS_JSON}
						onChange={(event) => onField("brackets", event.target.value)}
					/>
				</>
			);
		default:
			return null;
	}
}

export function AmountBuilder({
	accounts,
	postings,
	templates,
	initialTemplateId,
	hidePicker,
	fixedAmount,
	onChange,
}: {
	accounts: Option[];
	postings: Option[];
	templates?: AmountTemplate[];
	initialTemplateId?: string;
	hidePicker?: boolean;
	fixedAmount?: PostingAmountResolution;
	onChange?: (amount: PostingAmountResolution) => void;
}) {
	const list = templates?.length ? templates : FALLBACK_TEMPLATES;
	const [templateId, setTemplateId] = useState(initialTemplateId ?? "fixed");
	const [fields, setFields] = useState<Record<string, string>>({});
	const [copied, setCopied] = useState(false);
	const template = list.find((item) => item.id === templateId) ?? list[0]!;
	const amount = useMemo(
		() => fixedAmount ?? buildTemplateAmount(template.id, fields, accounts),
		[fixedAmount, template.id, fields, accounts],
	);
	const plain = plainLanguageForAmount(amount);
	const wire = JSON.stringify(amount, null, 2);
	return (
		<div className="mt-3 mb-5 rounded-lg border border-solid border-line bg-transparent p-4">
			{!hidePicker && (
				<>
					<div className="grid grid-cols-2 gap-5 max-[600px]:gap-x-3 max-[600px]:gap-y-4 max-[370px]:grid-cols-1">
						<SelectField
							label="What kind of amount?"
							name="amountTemplate"
							value={template.id}
							onChange={(event) => {
								setTemplateId(event.target.value);
								setFields({});
								setCopied(false);
							}}
						>
							{list.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</SelectField>
					</div>
					<p className="text-muted">
						<strong>{template.label}.</strong> {template.summary}{" "}
						{template.whenToUse && <span>Use when: {template.whenToUse}</span>}
					</p>
				</>
			)}
			{!fixedAmount && (
				<div className="grid grid-cols-2 gap-5 max-[600px]:gap-x-3 max-[600px]:gap-y-4 max-[370px]:grid-cols-1">
					<TemplateFields
						templateId={template.id}
						accounts={accounts}
						postings={postings}
						fields={fields}
						onField={(key, value) =>
							setFields((previous) => ({ ...previous, [key]: value }))
						}
					/>
				</div>
			)}
			<p className="text-muted">{plain}</p>
			<details>
				<summary>Show saved data (JSON)</summary>
				<pre className="max-h-70 overflow-auto rounded-lg border border-solid border-line bg-surface-2 p-3 text-xs whitespace-pre-wrap [word-break:break-word]">
					{wire}
				</pre>
			</details>
			<div className={dialogActionsStyles}>
				<Button
					type="button"
					variant="secondary"
					onClick={() => {
						void navigator.clipboard?.writeText(wire).then(
							() => setCopied(true),
							() => setCopied(false),
						);
					}}
				>
					{copied ? "Copied!" : "Copy JSON"}
				</Button>
				{onChange && (
					<Button
						type="button"
						variant="primary"
						onClick={() => onChange(amount)}
					>
						Use this amount
					</Button>
				)}
			</div>
		</div>
	);
}
