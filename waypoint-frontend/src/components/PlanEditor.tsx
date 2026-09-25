import { ArrowRight, LockKeyhole } from "lucide-react";
import {
	cloneElement,
	type FormEvent,
	type ReactElement,
	useEffect,
	useId,
	useState,
} from "react";
import type { Account, Goal, Movement, Plan } from "../domain/model.ts";
import { validatePlan } from "../domain/model.ts";
import { ErrorNotice, Modal } from "./ui.tsx";

export type EditorTarget =
	| { kind: "account"; item: Account | null }
	| { kind: "movement"; item: Movement | null }
	| { kind: "goal"; item: Goal | null }
	| { kind: "assumptions" };
const titleByKind = {
	account: "account",
	movement: "planned movement",
	goal: "goal",
	assumptions: "assumptions",
};
const field = (data: FormData, name: string) =>
	String(data.get(name) ?? "").trim();
const number = (data: FormData, name: string) => Number(field(data, name));

function Field({
	label,
	children,
	hint,
	wide = false,
}: {
	label: string;
	children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
	hint?: string;
	wide?: boolean;
}) {
	const id = useId();
	return (
		<div className={`field ${wide ? "field-wide" : ""}`}>
			<label htmlFor={id}>{label}</label>
			{cloneElement(children, {
				id,
				"aria-describedby": hint ? `${id}-hint` : undefined,
			})}
			{hint && <small id={`${id}-hint`}>{hint}</small>}
		</div>
	);
}

export function PlanEditor({
	target,
	plan,
	onApply,
	onClose,
}: {
	target: EditorTarget;
	plan: Plan;
	onApply: (plan: Plan) => boolean;
	onClose: () => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [confirmCancel, setConfirmCancel] = useState(false);
	useEffect(() => {
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);
	const isNew = target.kind !== "assumptions" && !target.item;
	const unknownAmount =
		target.kind === "movement" && target.item?.amountKnown === false;
	const readOnly =
		target.kind !== "assumptions" &&
		target.kind !== "goal" &&
		Boolean(target.item?.readOnly || unknownAmount);
	const close = () => (dirty ? setConfirmCancel(true) : onClose());

	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (readOnly) return;
		const data = new FormData(event.currentTarget);
		const next = structuredClone(plan);
		if (target.kind === "account") {
			const item: Account = {
				id: target.item?.id ?? crypto.randomUUID(),
				name: field(data, "name"),
				kind: field(data, "kind") as Account["kind"],
				enabled: field(data, "enabled") === "on",
				balance: number(data, "balance"),
				annualReturn: number(data, "annualReturn"),
				floor: number(data, "floor"),
				ceiling: field(data, "ceiling") ? number(data, "ceiling") : null,
				observedOn: field(data, "observedOn"),
				provenance: field(data, "provenance") as Account["provenance"],
				source: field(data, "source"),
				readOnly: false,
			};
			next.accounts = target.item
				? next.accounts.map((a) => (a.id === item.id ? item : a))
				: [...next.accounts, item];
		}
		if (target.kind === "movement") {
			const item: Movement = {
				id: target.item?.id ?? crypto.randomUUID(),
				name: field(data, "name"),
				amount: number(data, "amount"),
				amountKnown: true,
				fromId: field(data, "fromId") || null,
				toId: field(data, "toId") || null,
				frequency: field(data, "frequency") as Movement["frequency"],
				startDate: field(data, "startDate"),
				endDate: field(data, "endDate") || null,
				annualIncrease: number(data, "annualIncrease"),
				enabled: target.item?.enabled ?? true,
				provenance: field(data, "provenance") as Movement["provenance"],
				readOnly: false,
			};
			next.movements = target.item
				? next.movements.map((m) => (m.id === item.id ? item : m))
				: [...next.movements, item];
		}
		if (target.kind === "goal") {
			const kind = field(data, "kind") as Goal["kind"];
			const item: Goal = {
				id: target.item?.id ?? crypto.randomUUID(),
				name: field(data, "name"),
				kind,
				target: number(data, "target"),
				accountId: kind === "reserve" ? field(data, "accountId") || null : null,
				enabled: target.item?.enabled ?? true,
			};
			next.goals = target.item
				? next.goals.map((g) => (g.id === item.id ? item : g))
				: [...next.goals, item];
		}
		if (target.kind === "assumptions")
			next.assumptions = {
				inflation: number(data, "inflation"),
				volatility: number(data, "volatility"),
			};
		const validated = validatePlan(next);
		if (validated instanceof Error) {
			setError(validated.message);
			return;
		}
		if (onApply(validated)) onClose();
	};

	return (
		<Modal
			title={`${isNew ? "Add" : "Edit"} ${titleByKind[target.kind]}`}
			eyebrow="Try it before you keep it"
			onClose={close}
		>
			<p className="form-intro">
				Changes create a temporary version. Compare the outcome before saving.
			</p>
			{readOnly && (
				<div className="inline-notice">
					<LockKeyhole size={18} />
					{unknownAmount
						? "This amount comes from a provider-backed resolver and has no fixed value in the display plan. Review the server projection instead of editing it here."
						: "This record is owned by a read-only source. Edit it at the source and import a refreshed plan."}
				</div>
			)}
			<form onSubmit={submit} onChange={() => setDirty(true)}>
				<fieldset disabled={Boolean(readOnly)} className="form-grid">
					{target.kind === "account" && (
						<AccountFields item={target.item} plan={plan} />
					)}
					{target.kind === "movement" && (
						<MovementFields item={target.item} plan={plan} />
					)}
					{target.kind === "goal" && (
						<GoalFields item={target.item} plan={plan} />
					)}
					{target.kind === "assumptions" && (
						<>
							<Field
								label="Annual inflation (%)"
								hint="Used only when viewing today’s dollars. Movement increases are configured separately."
							>
								<input
									name="inflation"
									type="number"
									required
									min="0"
									max="20"
									step="0.1"
									defaultValue={plan.assumptions.inflation}
								/>
							</Field>
							<Field
								label="Investment return variability (%)"
								hint="Annual standard deviation in percentage points, applied to all investment accounts."
							>
								<input
									name="volatility"
									type="number"
									required
									min="0"
									max="40"
									step="0.5"
									defaultValue={plan.assumptions.volatility}
								/>
							</Field>
							<div className="method-note field-wide">
								<h3>What the scenarios vary</h3>
								<p>
									400 repeatable scenarios vary investment returns each calendar
									year. Investment accounts share the same market shock. Rates
									are normally sampled and capped between −50% and +50%. Cash,
									debt and property rates stay fixed.
								</p>
								<p>
									Taxes, market fees and access restrictions are not calculated.
									Add relevant payments to your plan. A range is a model, not a
									guarantee.
								</p>
							</div>
						</>
					)}
				</fieldset>
				{error && <ErrorNotice message={error} />}
				{confirmCancel ? (
					<div className="confirm-inline" role="alert">
						<p>Discard the edits in this form?</p>
						<button
							type="button"
							className="button secondary"
							onClick={() => setConfirmCancel(false)}
						>
							Keep editing
						</button>
						<button type="button" className="button danger" onClick={onClose}>
							Discard form edits
						</button>
					</div>
				) : (
					<div className="modal-actions">
						<button type="button" className="button secondary" onClick={close}>
							Cancel
						</button>
						<button
							type="submit"
							className="button primary"
							disabled={Boolean(readOnly)}
						>
							Apply to temporary version <ArrowRight size={16} />
						</button>
					</div>
				)}
			</form>
		</Modal>
	);
}

function AccountFields({ item, plan }: { item: Account | null; plan: Plan }) {
	return (
		<>
			<Field label="Account name" wide>
				<input
					name="name"
					required
					maxLength={100}
					defaultValue={item?.name ?? ""}
					placeholder="e.g. Savings account"
				/>
			</Field>
			<Field label="Account type">
				<select name="kind" defaultValue={item?.kind ?? "cash"}>
					<option value="cash">Cash & savings</option>
					<option value="investment">Investments</option>
					<option value="property">Property</option>
					<option value="debt">Debt</option>
				</select>
			</Field>
			<label className="checkbox-field">
				<input
					name="enabled"
					type="checkbox"
					defaultChecked={item?.enabled ?? true}
				/>
				Include in net worth and projections
			</label>
			<Field label="Balance (USD)" hint="Enter debts as negative amounts.">
				<input
					name="balance"
					type="number"
					required
					step="0.01"
					min="-10000000000"
					max="10000000000"
					defaultValue={item?.balance ?? 0}
				/>
			</Field>
			<Field label="Annual growth / interest (%)">
				<input
					name="annualReturn"
					type="number"
					required
					min="-50"
					max="50"
					step="0.1"
					defaultValue={item?.annualReturn ?? 0}
				/>
			</Field>
			<Field
				label="Protected balance (USD)"
				hint="Movements cannot spend below this balance."
			>
				<input
					name="floor"
					type="number"
					required
					min="0"
					max="10000000000"
					step="0.01"
					defaultValue={item?.floor ?? 0}
				/>
			</Field>
			<Field
				label="Maximum balance (USD)"
				hint="Optional. Limits incoming movements."
			>
				<input
					name="ceiling"
					type="number"
					min="0"
					max="10000000000"
					step="0.01"
					defaultValue={item?.ceiling ?? ""}
					placeholder="No ceiling"
				/>
			</Field>
			<Field label="Balance check date">
				<input
					name="observedOn"
					type="date"
					required
					max={plan.startDate}
					defaultValue={item?.observedOn ?? plan.startDate}
				/>
			</Field>
			<Field label="Balance basis">
				<select name="provenance" defaultValue={item?.provenance ?? "recorded"}>
					<option value="recorded">Recorded balance check</option>
					<option value="modeled">Modeled estimate</option>
				</select>
			</Field>
			<Field label="Source">
				<input
					name="source"
					required
					maxLength={100}
					defaultValue={item?.source ?? "Manual balance check"}
				/>
			</Field>
		</>
	);
}

function MovementFields({ item, plan }: { item: Movement | null; plan: Plan }) {
	return (
		<>
			<Field label="Movement name" wide>
				<input
					name="name"
					required
					maxLength={100}
					defaultValue={item?.name ?? ""}
					placeholder="e.g. Monthly investing"
				/>
			</Field>
			<Field label="Amount (USD)">
				<input
					name="amount"
					type="number"
					required
					min="0.01"
					max="10000000000"
					step="0.01"
					defaultValue={
						item?.amountKnown === false ? "" : (item?.amount ?? 500)
					}
				/>
			</Field>
			<Field label="Frequency">
				<select name="frequency" defaultValue={item?.frequency ?? "monthly"}>
					<option value="monthly">Monthly</option>
					<option value="yearly">Yearly</option>
					<option value="once">One time</option>
				</select>
			</Field>
			<Field label="From">
				<select name="fromId" defaultValue={item?.fromId ?? ""}>
					<option value="">External income</option>
					{plan.accounts
						.filter((a) => a.kind !== "debt")
						.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
				</select>
			</Field>
			<Field label="To">
				<select name="toId" defaultValue={item?.toId ?? ""}>
					<option value="">External expense</option>
					{plan.accounts.map((a) => (
						<option key={a.id} value={a.id}>
							{a.name}
						</option>
					))}
				</select>
			</Field>
			<Field label="First occurrence">
				<input
					name="startDate"
					type="date"
					required
					defaultValue={item?.startDate ?? plan.startDate}
				/>
			</Field>
			<Field
				label="Last occurrence"
				hint="Leave empty to continue through the horizon."
			>
				<input name="endDate" type="date" defaultValue={item?.endDate ?? ""} />
			</Field>
			<Field label="Annual amount increase (%)">
				<input
					name="annualIncrease"
					type="number"
					required
					min="-50"
					max="50"
					step="0.1"
					defaultValue={item?.annualIncrease ?? 0}
				/>
			</Field>
			<Field label="Record type">
				<select name="provenance" defaultValue={item?.provenance ?? "planned"}>
					<option value="planned">Planned movement</option>
					<option value="recorded">Recorded one-time movement</option>
				</select>
			</Field>
			<p className="field-wide field-hint">
				Recorded movements support evidence only; starting balances already
				include them. Future movements begin after {plan.startDate}.
			</p>
		</>
	);
}

function GoalFields({ item, plan }: { item: Goal | null; plan: Plan }) {
	const [kind, setKind] = useState(item?.kind ?? "net-worth");
	return (
		<>
			<Field label="Goal name" wide>
				<input
					name="name"
					required
					maxLength={100}
					defaultValue={item?.name ?? ""}
					placeholder="e.g. A comfortable cash cushion"
				/>
			</Field>
			<Field label="Measure">
				<select
					name="kind"
					value={kind}
					onChange={(event) => setKind(event.target.value as Goal["kind"])}
				>
					<option value="net-worth">Household net worth</option>
					<option value="reserve">An account balance</option>
				</select>
			</Field>
			<Field label="Target (USD)">
				<input
					name="target"
					type="number"
					required
					min="1"
					max="10000000000"
					step="1"
					defaultValue={item?.target ?? 1000000}
				/>
			</Field>
			{kind === "reserve" && (
				<Field label="Account" wide>
					<select
						name="accountId"
						required
						defaultValue={item?.accountId ?? ""}
					>
						<option value="" disabled>
							Select an account
						</option>
						{plan.accounts.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</select>
				</Field>
			)}
			<p className="field-wide field-hint">
				A goal is reached the first day the selected measure meets its target.
				Reaching it once does not establish long-term sustainability.
			</p>
		</>
	);
}
