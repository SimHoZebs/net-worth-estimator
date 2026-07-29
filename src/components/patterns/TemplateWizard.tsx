import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseDecimalDraft } from "@/lib/number-draft";
import type {
	IncomeTemplateInput,
	TemplateGenerationResult,
	TemplateOutput,
} from "@/lib/patterns";
import { generateIncomePattern } from "@/lib/patterns";
import type { FinancialModelDocument } from "@/lib/projection";
import { IncomeForm, type IncomeFormValue } from "./IncomeForm";
import {
	describePostingCap,
	describePostingRoute,
	TemplatePreview,
} from "./TemplatePreview";

interface TemplateWizardProps {
	document: FinancialModelDocument;
	onApply: (output: TemplateOutput) => void;
	onClose: () => void;
}

function defaultIncomeInput(): IncomeFormValue {
	return {
		label: "",
		grossMonthlyIncome: "0",
		taxRate: "22",
		k401ContributionRate: "4",
		k401EmployerMatchRate: "50",
		k401AnnualCap: "23000",
		autoInvestRate: "10",
		startDate: new Date().toISOString().slice(0, 10),
	};
}

function parseIncomeInput(
	input: IncomeFormValue,
): { ok: true; input: IncomeTemplateInput } | { ok: false; error: string } {
	const errors: string[] = [];
	const parseNumber = (raw: string, label: string) => {
		const parsed = parseDecimalDraft(raw);
		if (parsed === null) {
			errors.push(`${label} must be a valid number.`);
			return 0;
		}
		return parsed;
	};

	const grossMonthlyIncome = parseNumber(
		input.grossMonthlyIncome,
		"Gross monthly income",
	);
	const taxRate = parseNumber(input.taxRate, "Tax rate");
	const k401ContributionRate = parseNumber(
		input.k401ContributionRate,
		"401(k) contribution rate",
	);
	const k401EmployerMatchRate = parseNumber(
		input.k401EmployerMatchRate,
		"Employer match rate",
	);
	const k401AnnualCap = parseNumber(input.k401AnnualCap, "401(k) annual cap");
	const autoInvestRate = parseNumber(input.autoInvestRate, "Auto-invest rate");
	if (k401AnnualCap < 0) errors.push("401(k) annual cap cannot be negative.");

	if (errors.length > 0) return { ok: false, error: errors.join(" ") };
	return {
		ok: true,
		input: {
			...input,
			grossMonthlyIncome,
			taxRate: taxRate / 100,
			k401ContributionRate: k401ContributionRate / 100,
			k401EmployerMatchRate: k401EmployerMatchRate / 100,
			k401AnnualCap,
			autoInvestRate: autoInvestRate / 100,
		},
	};
}

export function TemplateWizard({
	document,
	onApply,
	onClose,
}: TemplateWizardProps) {
	const [input, setInput] = useState<IncomeFormValue>(defaultIncomeInput);
	const [result, setResult] = useState<TemplateGenerationResult | null>(null);
	const [step, setStep] = useState<"form" | "confirm">("form");

	const existingAccountIds = document.accounts.map((account) => account.id);
	const existingPostingIds = document.postings.map((posting) => posting.id);

	const handleGenerate = () => {
		const parsed = parseIncomeInput(input);
		if (!parsed.ok) {
			setResult(parsed);
			return;
		}
		const r = generateIncomePattern(
			parsed.input,
			existingAccountIds,
			existingPostingIds,
		);
		setResult(r);
		if (r.ok) setStep("confirm");
	};

	const handleConfirm = () => {
		if (result?.ok) {
			onApply(result.output);
			onClose();
		}
	};

	const allAccounts = useMemo(
		() =>
			result?.ok
				? [...document.accounts, ...result.output.accounts]
				: document.accounts,
		[result, document.accounts],
	);

	const postingDescriptions = useMemo(() => {
		if (!result?.ok) return [];
		return result.output.postings.map((p) => ({
			id: p.id,
			label: p.label,
			route: describePostingRoute(p, allAccounts),
			arithmetic: p.arithmetic,
			cap: describePostingCap(p),
		}));
	}, [result, allAccounts]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
			<div className="w-full max-w-lg rounded-[1.8rem] border border-border/80 bg-card shadow-xl dark:border-white/10">
				<div className="px-6 py-4 border-b border-border/70">
					<h2 className="type-title">Income Template</h2>
					<p className="type-caption mt-1">
						Create salary, tax, 401(k), and brokerage postings from one form.
					</p>
				</div>

				<div className="px-6 py-4 space-y-4">
					{step === "form" ? (
						<>
							<IncomeForm value={input} onChange={setInput} />
							{result && !result.ok && (
								<div className="rounded-xl border border-destructive/25 bg-destructive-subtle p-3 type-body text-destructive-foreground">
									{result.error}
								</div>
							)}
							<div className="flex justify-end gap-2 mt-2">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={onClose}
								>
									Cancel
								</Button>
								<Button type="button" size="sm" onClick={handleGenerate}>
									Generate
								</Button>
							</div>
						</>
					) : result?.ok ? (
						<>
							<TemplatePreview
								accounts={result.output.accounts}
								postings={result.output.postings}
								existingAccountIds={existingAccountIds}
								postingDescriptions={postingDescriptions}
							/>
							<div className="flex justify-end gap-2 mt-2">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => setStep("form")}
								>
									Back
								</Button>
								<Button type="button" size="sm" onClick={handleConfirm}>
									Add to model
								</Button>
							</div>
						</>
					) : null}
				</div>
			</div>
		</div>
	);
}
