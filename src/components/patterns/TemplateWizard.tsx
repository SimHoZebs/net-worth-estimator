import { useState, useMemo } from "react";
import type { ScenarioPack } from "@/lib/projection";
import { generateIncomePattern } from "@/lib/patterns";
import type { IncomeTemplateInput, TemplateGenerationResult, TemplateOutput } from "@/lib/patterns";
import { IncomeForm } from "./IncomeForm";
import { TemplatePreview, describePostingRoute, describePostingCap } from "./TemplatePreview";
import { Button } from "@/components/ui/button";

interface TemplateWizardProps {
  pack: ScenarioPack;
  onApply: (output: TemplateOutput) => void;
  onClose: () => void;
}

function defaultIncomeInput(): IncomeTemplateInput {
  return {
    label: "",
    grossMonthlyIncome: 0,
    taxRate: 0.22,
    k401ContributionRate: 0.04,
    k401EmployerMatchRate: 0.5,
    k401AnnualCap: 23000,
    autoInvestRate: 0.1,
    startDate: new Date().toISOString().slice(0, 10),
  };
}

export function TemplateWizard({ pack, onApply, onClose }: TemplateWizardProps) {
  const [input, setInput] = useState<IncomeTemplateInput>(defaultIncomeInput);
  const [result, setResult] = useState<TemplateGenerationResult | null>(null);
  const [step, setStep] = useState<"form" | "confirm">("form");

  const existingAccountIds = pack.accounts.map((a) => a.id);
  const existingPostingIds = pack.postings.map((p) => p.id);

  const handleGenerate = () => {
    const r = generateIncomePattern(input, existingAccountIds, existingPostingIds);
    setResult(r);
    if (r.ok) setStep("confirm");
  };

  const handleConfirm = () => {
    if (result && result.ok) {
      onApply(result.output);
      onClose();
    }
  };

  const allAccounts = useMemo(
    () =>
      result?.ok
        ? [...pack.accounts, ...result.output.accounts]
        : pack.accounts,
    [result, pack.accounts],
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-[1.8rem] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xl">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Income Template</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Create salary, tax, 401(k), and brokerage postings from one form.
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {step === "form" ? (
            <>
              <IncomeForm value={input} onChange={setInput} />
              {result && !result.ok && (
                <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-400">
                  {result.error}
                </div>
              )}
              <div className="flex justify-end gap-2 mt-2">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
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
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep("form")}>
                  Back
                </Button>
                <Button type="button" size="sm" onClick={handleConfirm}>
                  Add to scenario
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
