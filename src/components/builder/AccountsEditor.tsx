import {
  addAccount,
  isAccountReferenced,
  removeAccountAt,
  type ScenarioAccountDefinition,
  type ScenarioDefinition,
  type ScenarioPath,
} from "../../lib/projection";
import { Field, NumberInput, sectionButtonClassName, SelectInput } from "./shared";
import { Input } from "../ui";

function accountKindLabel(kind: ScenarioAccountDefinition["kind"]): string {
  switch (kind) {
    case "cash":
      return "Cash";
    case "liability":
      return "Liability";
    case "asset":
    default:
      return "Asset";
  }
}

export function AccountsEditor({
  scenario,
  updateField,
  updateScenario,
}: {
  scenario: ScenarioDefinition;
  updateField: (path: ScenarioPath, value: unknown) => void;
  updateScenario: (updater: (current: ScenarioDefinition) => ScenarioDefinition) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Accounts</h2>
          <p className="text-sm text-slate-500">These are the balances the runtime mutates over time.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={sectionButtonClassName()} onClick={() => updateScenario((current) => addAccount(current, "asset"))}>Add asset</button>
          <button type="button" className={sectionButtonClassName()} onClick={() => updateScenario((current) => addAccount(current, "liability"))}>Add liability</button>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide">
        {scenario.accounts.map((account, accountIndex) => {
          const accountIsReferenced = isAccountReferenced(scenario, account.id);
          const isCashAccount = account.id === "cash";

          return (
            <div key={account.id} className="min-w-[320px] max-w-[400px] shrink-0 snap-start space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-slate-900">{account.label}</h3>
                  <p className="text-xs text-slate-500">ID: <code>{account.id}</code></p>
                </div>
                <button
                  type="button"
                  className={sectionButtonClassName("danger")}
                  disabled={isCashAccount || accountIsReferenced}
                  onClick={() => updateScenario((current) => removeAccountAt(current, accountIndex))}
                >
                  Remove
                </button>
              </div>

              {isCashAccount ? <p className="text-xs text-slate-500">Cash is the default liquidity pool for policy execution and cannot be removed.</p> : null}
              {!isCashAccount && accountIsReferenced ? <p className="text-xs text-amber-700">This account is currently referenced by a module or policy, so remove or retarget those references first.</p> : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Label">
                  <Input value={account.label} onChange={(event) => updateField(["accounts", accountIndex, "label"], event.currentTarget.value)} />
                </Field>
                <Field label="Kind">
                  <SelectInput value={account.kind} onChange={(value) => updateField(["accounts", accountIndex, "kind"], value)}>
                    <option value="cash" disabled={!isCashAccount}>Cash</option>
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                  </SelectInput>
                </Field>
                <Field label="Opening balance">
                  <NumberInput value={account.openingBalance} onChange={(value) => updateField(["accounts", accountIndex, "openingBalance"], Math.max(0, value))} min={0} />
                </Field>
                <Field label="Annual rate %" helper={`Positive balances grow upward. ${accountKindLabel(account.kind)} balances use the same generic runtime rate rule.`}>
                  <NumberInput value={(account.annualRate ?? 0) * 100} onChange={(value) => updateField(["accounts", accountIndex, "annualRate"], Math.max(0, value) / 100)} min={0} />
                </Field>
                <Field label="Color" helper="Used in charts.">
                  <Input value={account.color ?? ""} onChange={(event) => updateField(["accounts", accountIndex, "color"], event.currentTarget.value)} />
                </Field>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
