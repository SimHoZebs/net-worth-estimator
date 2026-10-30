import { todayIso } from "../domain/format.ts";
import { finite, isRecord } from "../domain/guards.ts";
import { latestCheckpoint } from "./checkpoints.ts";
import type {
	Account,
	Transaction,
	PlannedPurchase,
	Plan,
} from "../domain/model.ts";
import {
	type AmountInputBinding,
	type BackendAccount,
	type BackendCheckpoint,
	type BackendPlannedPurchase,
	type BackendPosting,
	type BackendRecurrenceRule,
	type EvaluationTables,
	type FinancialModelDocument,
	type IsoDate,
	type JsonObject,
	type JsonValue,
	NO_CEILING_SENTINEL,
	NO_FLOOR_SENTINEL,
	type PostingAmountResolution,
	type ProjectionResult,
	type RecurrenceFrequency,
	type ServerStatus,
} from "./contracts.ts";

export type ProvisionalField = string;

export interface AdapterWarning {
	code: string;
	message: string;
	path?: string;
}

export interface AdapterLoss extends AdapterWarning {
	field: string;
}

export interface AdapterReport {
	warnings: AdapterWarning[];
	losses: AdapterLoss[];
	provisionalFields: ProvisionalField[];
	hasLosses: boolean;
}

export interface AccountPresentation {
	balanceCheck: boolean;
	source: string;
	/** Derived display baseline for conversion checks, not persisted access policy. */
	readOnly: boolean;
	enabled: boolean;
	minBalance: number | null;
	maxBalance: number | null;
	observedOn: IsoDate;
}

export interface TransactionPresentation {
	source?: string;
	amount?: PostingAmountResolution;
	amountValue?: number;
	destinations?: string[] | null;
	frequency?: RecurrenceFrequency;
	annualCap?: number | null;
	priority?: number;
	postedTime?: number;
	transactionTime?: number;

	readOnly: boolean;
	displayFrequency?: Transaction["frequency"];
	displayToId?: string | null;
	displayAnnualIncrease?: number;
}

/**
 * Display state the server has no field for. Kept in the browser and replayed
 * into the next document, so a round trip through the display plan does not
 * discard it.
 */
export interface PlanPresentation {
	name?: string;
	origin?: Plan["origin"];
	updatedAt?: string;
	revision?: number;
	assumptions?: Plan["assumptions"];
	accounts: Record<string, AccountPresentation>;
	transactions: Record<string, TransactionPresentation>;
	plannedPurchases: Record<string, TransactionPresentation>;
}

export interface DisplayPlanInput {
	document: FinancialModelDocument;
	status: ServerStatus;
	projection?: ProjectionResult | null;
	presentation?: PlanPresentation | null;
	startDate?: IsoDate;
}

export interface PlanConversion {
	plan: Plan;
	presentation: PlanPresentation;
	report: AdapterReport;
	warnings: AdapterWarning[];
	losses: AdapterLoss[];
}

export interface ReverseAdapterOptions {
	/**
	 * The document this plan was built from. The reverse conversion reads it to
	 * preserve rows the display plan does not model, to carry checkpoint history
	 * forward, and to detect deletions. It is the caller's copy of the server
	 * document, not browser state.
	 */
	sourceDocument?: FinancialModelDocument | null;
	presentation?: PlanPresentation | null;
	sourcePath?: string;
}

export interface BackendDocumentConversion {
	document: FinancialModelDocument;
	report: AdapterReport;
	warnings: AdapterWarning[];
	losses: AdapterLoss[];
}

function report(): AdapterReport {
	return { warnings: [], losses: [], provisionalFields: [], hasLosses: false };
}

function warn(
	target: AdapterReport,
	code: string,
	message: string,
	path?: string,
): void {
	target.warnings.push({ code, message, ...(path ? { path } : {}) });
}

function lose(
	target: AdapterReport,
	field: string,
	message: string,
	path?: string,
): void {
	target.losses.push({
		field,
		code: "unsupported-field",
		message,
		...(path ? { path } : {}),
	});
	target.hasLosses = true;
}

function provisional(target: AdapterReport, field: string): void {
	if (!target.provisionalFields.includes(field))
		target.provisionalFields.push(field);
}

function objectValue(value: JsonValue | undefined): JsonObject | null {
	return isRecord(value) ? (value as unknown as JsonObject) : null;
}

function sameNumber(left: number, right: number): boolean {
	return Math.abs(left - right) <= 0.000001;
}

function sameNullableNumber(
	left: number | null,
	right: number | null,
): boolean {
	if (left === null || right === null) return left === right;
	return sameNumber(left, right);
}

function sameFloorValue(
	backendValue: number | null,
	displayValue: number,
): boolean {
	if (backendValue === null || backendValue === NO_FLOOR_SENTINEL)
		return displayValue === 0;
	return sameNumber(backendValue, displayValue);
}

function sameCeilingValue(
	backendValue: number | null,
	displayValue: number | null,
): boolean {
	if (backendValue === null || backendValue === NO_CEILING_SENTINEL)
		return displayValue === null;
	return sameNullableNumber(backendValue, displayValue);
}

function boundValue(
	value: number | null | undefined,
	noBound: number,
): number | null {
	if (value === null || value === undefined || value === noBound) return null;
	return Number.isFinite(value) ? value : null;
}

/**
 * Backend row authorship is "user" (owner-authored) or a sync-owned name set by
 * the server. Any non-user author is system-owned sync output: read-only in
 * the workspace and protected from removal. The exact sync name is a
 * backend contract, so match by exclusion rather than by name.
 */
function isSyncOwned(source: string | undefined | null): boolean {
	return source != null && source !== "user";
}

function accountReadOnly(
	accountId: string,
	document: FinancialModelDocument,
	status: ServerStatus,
): boolean {
	return (
		status.readOnly ||
		document.checkpoints.some(
			(checkpoint) =>
				checkpoint.AccountId === accountId && isSyncOwned(checkpoint.source),
		)
	);
}

function checkpointSourceLabel(
	checkpoint: {
		source?: string | null;
	} | null,
): string {
	if (checkpoint && isSyncOwned(checkpoint.source ?? null))
		return "Synced checkpoint";
	return checkpoint ? "Backend checkpoint" : "Backend account";
}

const sentinelMap = {
	floor: NO_FLOOR_SENTINEL,
	ceiling: NO_CEILING_SENTINEL,
} as const;

function checkpointDate(
	checkpoint: BackendCheckpoint | null,
	fallback: IsoDate,
): IsoDate {
	return checkpoint?.Date ?? fallback;
}

function latestDate(values: IsoDate[]): IsoDate | null {
	return values.length
		? values.reduce((latest, value) => (value > latest ? value : latest))
		: null;
}

function fallbackStartDate(
	document: FinancialModelDocument,
	projection: ProjectionResult | null | undefined,
): IsoDate {
	const posting = document.postings.find((item) => !item.purchase);
	return (
		projection?.milestones.projectionStartDate ??
		latestDate(document.checkpoints.map((checkpoint) => checkpoint.Date)) ??
		(document.recurrenceRules ?? [])[0]?.startDate ??
		(posting
			? dayFromTimes(posting.transactionTime, posting.postedTime)
			: undefined) ??
		todayIso()
	);
}

function numericExpression(value: string | undefined): number | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(trimmed)) return null;
	return finite(Number(trimmed));
}

/**
 * Growth helpers: a transaction's annual increase lives in its amount inputs
 * as a growth-factor provider, the same descriptor one-time postings use.
 * These mirror the backend migration so the display plan reads and writes
 * growth without dedicated rule columns.
 */
function growthInputOf(
	amount: PostingAmountResolution | undefined | null,
): { name: string; rate: number } | null {
	const inputs = amount?.inputs ?? {};
	const names = Object.keys(inputs).sort();
	for (const name of names) {
		const binding = inputs[name];
		if (
			binding?.source !== "provider" ||
			binding.provider !== "growth-factor"
		) {
			continue;
		}
		const rate = finite(binding.arguments?.annualGrowthRate);
		if (rate === null) continue;
		return { name, rate };
	}
	return null;
}

function growthRateOfAmount(
	amount: PostingAmountResolution | undefined | null,
): number | null {
	return growthInputOf(amount)?.rate ?? null;
}

function withGrowthRate(
	amount: PostingAmountResolution,
	rate: number,
): PostingAmountResolution {
	const inputs: Record<string, AmountInputBinding> = {};
	for (const [key, value] of Object.entries(
		(objectValue(amount.inputs as JsonValue) ?? {}) as Record<
			string,
			JsonValue
		>,
	)) {
		inputs[key] = value as unknown as AmountInputBinding;
	}
	const existing = growthInputOf({ ...amount, inputs });
	if (rate === 0) {
		if (!existing) return amount;
		const reference = new RegExp(`\\b${existing.name}\\b`).test(
			expressionOf(amount),
		);
		if (!reference) {
			delete inputs[existing.name];
			return { ...amount, inputs };
		}
		const stripped = stripGrowthReference(expressionOf(amount), existing.name);
		if (stripped !== null) {
			delete inputs[existing.name];
			return {
				...amount,
				config: { ...objectValue(amount.config), expression: stripped },
				inputs,
			};
		}
		inputs[existing.name] = {
			...inputs[existing.name]!,
			arguments: { ...inputs[existing.name]?.arguments, annualGrowthRate: 0 },
		};
		return { ...amount, inputs };
	}
	const name = existing?.name ?? uniqueInputName(inputs, "growth");
	inputs[name] = {
		source: "provider",
		provider: "growth-factor",
		arguments: { annualGrowthRate: rate },
	};
	if (new RegExp(`\\b${name}\\b`).test(expressionOf(amount))) {
		return { ...amount, inputs };
	}
	return {
		...amount,
		config: {
			...objectValue(amount.config),
			expression: `(${expressionOf(amount)}) * ${name}`,
		},
		inputs,
	};
}

function expressionOf(amount: PostingAmountResolution): string {
	const config = objectValue(amount.config);
	return typeof config?.expression === "string" ? config.expression : "";
}

function uniqueInputName(
	inputs: Record<string, AmountInputBinding>,
	base: string,
): string {
	if (!Object.hasOwn(inputs, base)) return base;
	let index = 2;
	while (Object.hasOwn(inputs, `${base}_${index}`)) index += 1;
	return `${base}_${index}`;
}

function stripGrowthReference(expression: string, name: string): string | null {
	const suffix = ` * ${name}`;
	if (!expression.endsWith(suffix)) return null;
	let core = expression.slice(0, -suffix.length);
	if (core.startsWith("(") && core.endsWith(")") && core.length >= 2) {
		core = core.slice(1, -1);
	}
	if (new RegExp(`\\b${name}\\b`).test(core)) return null;
	return core;
}

function postingAmountValue(
	posting: Pick<BackendPosting, "id" | "amount">,
	projection: ProjectionResult | null | undefined,
): number | null {
	const config = objectValue(posting.amount.config);
	const expressionValue = numericExpression(
		typeof config?.expression === "string" ? config.expression : undefined,
	);
	if (expressionValue !== null) return expressionValue;
	const directValue = finite(config?.value);
	if (directValue !== null) return directValue;
	const amountValue = finite(config?.amount);
	if (amountValue !== null) return amountValue;
	const event = projection?.transactionEvents?.find(
		(item) => item.origin.postingId === posting.id,
	);
	return finite(event?.requestedAmount) ?? null;
}

function displayFrequency(
	frequency: RecurrenceFrequency,
): Transaction["frequency"] {
	return frequency === "annual" ? "yearly" : "monthly";
}

const frequencyMap = {
	yearly: "annual",
	monthly: "monthly",
	once: "monthly",
} as const;

function backendFrequency(
	frequency: Transaction["frequency"],
): RecurrenceFrequency {
	return frequencyMap[frequency] ?? "monthly";
}

function targetFromEvaluation(config: JsonValue | undefined): number {
	const object = objectValue(config);
	return finite(object?.target) ?? 0;
}

function isZeroBalance(value: number): boolean {
	return Math.abs(value) < 0.005;
}

function isArchivedDebt(
	account: BackendAccount,
	document: FinancialModelDocument,
	projectionStartDate: IsoDate,
): boolean {
	if (account.kind !== "debt") return false;
	return document.checkpoints.some(
		(checkpoint) =>
			checkpoint.AccountId === account.id &&
			checkpoint.Date <= projectionStartDate &&
			isZeroBalance(checkpoint.Balance),
	);
}

function accountDisplay(
	account: BackendAccount,
	checkpoint: BackendCheckpoint | null,
	observedOn: IsoDate,
	readOnly: boolean,
	previous: AccountPresentation | undefined,
	archived: boolean,
): Account {
	const minBalance = boundValue(account.minBalance, sentinelMap.floor);
	const maxBalance = boundValue(account.maxBalance, sentinelMap.ceiling);
	return {
		id: account.id,
		name: account.name || account.id,
		kind: account.kind,
		enabled: account.enabled,
		archived,
		balance: checkpoint?.Balance ?? 0,
		minBalance: minBalance === null || minBalance < 0 ? 0 : minBalance,
		maxBalance: maxBalance === null || maxBalance < 0 ? null : maxBalance,
		color: account.color ?? null,
		observedOn,
		balanceCheck: previous?.balanceCheck ?? Boolean(checkpoint),
		source: previous?.source ?? checkpointSourceLabel(checkpoint),
		readOnly,
	};
}

/**
 * Single destination policy: forward collapses to first, reverse preserves
 * the stored list when the display destination is unchanged. Both directions
 * share firstDestinationOf so a multi-destination change touches one place.
 */
function firstDestinationOf(
	destinations: string[] | null | undefined,
): string | null {
	return destinations?.[0] ?? null;
}

function dayFromTimes(transactionTime: number, postedTime: number): IsoDate {
	const stamp =
		transactionTime > 0 ? transactionTime : postedTime > 0 ? postedTime : 0;
	return new Date(stamp * 1000).toISOString().slice(0, 10) as IsoDate;
}

function settledDay(postedTime: number | undefined): IsoDate | null {
	if (postedTime === undefined || postedTime <= 0) return null;
	return new Date(postedTime * 1000).toISOString().slice(0, 10) as IsoDate;
}

function midnightOf(day: IsoDate): number {
	return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
}

function transactionDisplayFromRule(
	rule: BackendRecurrenceRule,
	amount: number | null,
	previous?: TransactionPresentation,
): Transaction {
	const firstDestination = firstDestinationOf(rule.destinations);
	return {
		id: rule.id,
		name: rule.name || rule.id,
		amount: Math.max(0, amount ?? 0),
		amountKnown: amount !== null,
		fromId: rule.sourceAccountId,
		toId: firstDestination,
		frequency: previous?.displayFrequency ?? displayFrequency(rule.frequency),
		startDate: rule.startDate,
		endDate: rule.endDate,
		annualIncrease:
			previous?.displayAnnualIncrease ??
			(growthRateOfAmount(rule.amount) ?? 0) * 100,
		enabled: rule.enabled,
		readOnly: previous?.readOnly ?? amount === null,
		claimRuleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		void: false,
	};
}

function transactionDisplayFromPosting(
	posting: BackendPosting,
	amount: number | null,
	previous?: TransactionPresentation,
): Transaction {
	const firstDestination = firstDestinationOf(posting.destinations);
	return {
		id: posting.id,
		name: posting.name || posting.id,
		amount: Math.max(0, amount ?? 0),
		amountKnown: amount !== null,
		fromId: posting.sourceAccountId,
		toId: firstDestination,
		frequency: "once",
		startDate: dayFromTimes(posting.transactionTime, posting.postedTime),
		endDate: null,
		annualIncrease: previous?.displayAnnualIncrease ?? 0,
		enabled: posting.enabled,
		readOnly: amount === null || isSyncOwned(posting.source),
		claimRuleId: posting.claim?.ruleId ?? null,
		claimOccurrenceDate: posting.claim?.occurrenceDate ?? null,
		postedDate: settledDay(posting.postedTime),
		pending: posting.pending === true,
		void: posting.void === true,
	};
}

/**
 * Wishlist display row from a standalone planned-purchase row. Array order
 * in the display plan is the priority, so the numeric priority stays on the
 * wire only.
 */
function plannedPurchaseDisplayFromRow(
	row: BackendPlannedPurchase,
	previous?: TransactionPresentation,
): PlannedPurchase {
	return {
		id: row.id,
		name: row.name || row.id,
		amount: Math.max(0, row.cost),
		fromId: row.fundingAccountId,
		startDate: row.earliestDate,
		enabled: row.enabled,
		readOnly: previous?.readOnly ?? false,
	};
}

/**
 * Wishlist display row from a legacy purchase posting. Kept while the
 * backend persists purchases as postings with a purchase marker.
 */
function plannedPurchaseDisplayFromPosting(
	posting: BackendPosting,
	amount: number | null,
): PlannedPurchase {
	return {
		id: posting.id,
		name: posting.name || posting.id,
		amount: Math.max(0, amount ?? 0),
		fromId: posting.sourceAccountId,
		startDate: dayFromTimes(posting.transactionTime, posting.postedTime),
		enabled: posting.enabled,
		readOnly: amount === null || isSyncOwned(posting.source),
	};
}

function addForwardAccountWarnings(
	target: AdapterReport,
	account: BackendAccount,
	checkpoint: BackendCheckpoint | null,
	path: string,
): void {
	if (!checkpoint) {
		warn(
			target,
			"missing-checkpoint",
			`No checkpoint at or before the projection start was found; the display balance defaults to zero.`,
			`${path}.balance`,
		);
		provisional(target, `${path}.balance`);
	}
	if (account.minBalance === null || account.minBalance === NO_FLOOR_SENTINEL) {
		warn(
			target,
			"sentinel-floor",
			"The backend has no account minBalance; the display value defaults to zero.",
			`${path}.minBalance`,
		);
		provisional(target, `${path}.minBalance`);
	}
	if (
		account.maxBalance === null ||
		account.maxBalance === NO_CEILING_SENTINEL
	) {
		warn(
			target,
			"sentinel-ceiling",
			"The backend has no account maxBalance; the display value is unbounded.",
			`${path}.maxBalance`,
		);
		provisional(target, `${path}.maxBalance`);
	}
	if (
		account.minBalance !== null &&
		account.minBalance !== NO_FLOOR_SENTINEL &&
		account.minBalance < 0
	) {
		warn(
			target,
			"negative-floor",
			"A negative backend minBalance cannot be represented by the display model and is shown as zero.",
			`${path}.minBalance`,
		);
		provisional(target, `${path}.minBalance`);
	}
}

function addForwardRuleWarnings(
	target: AdapterReport,
	rule: BackendRecurrenceRule,
	amount: number | null,
	path: string,
): void {
	if (amount === null) {
		warn(
			target,
			"nonliteral-amount",
			"This transaction amount is calculated each occurrence and is shown as varying.",
			`${path}.amount`,
		);
		provisional(target, `${path}.amount`);
	}
	if (
		rule.frequency === "daily" ||
		rule.frequency === "weekly" ||
		rule.frequency === "quarterly"
	) {
		warn(
			target,
			"unsupported-frequency",
			"The display transaction frequency is approximated as monthly.",
			`${path}.frequency`,
		);
		provisional(target, `${path}.frequency`);
	}
	if ((rule.destinations?.length ?? 0) > 1) {
		warn(
			target,
			"multiple-destinations",
			"The display transaction can show one destination; additional backend destinations remain in the presentation state.",
			`${path}.toId`,
		);
		provisional(target, `${path}.toId`);
	}
	if (rule.annualCap !== null) {
		warn(
			target,
			"posting-metadata",
			"Backend annual cap is preserved as presentation state.",
			path,
		);
		provisional(target, `${path}.metadata`);
	}
}

function addForwardPostingWarnings(
	target: AdapterReport,
	posting: BackendPosting,
	amount: number | null,
	path: string,
): void {
	if (amount === null) {
		warn(
			target,
			"nonliteral-amount",
			"This transaction amount is calculated each occurrence and is shown as varying.",
			`${path}.amount`,
		);
		provisional(target, `${path}.amount`);
	}
	if ((posting.destinations?.length ?? 0) > 1) {
		warn(
			target,
			"multiple-destinations",
			"The display transaction can show one destination; additional backend destinations remain in the presentation state.",
			`${path}.toId`,
		);
		provisional(target, `${path}.toId`);
	}
	if (posting.source) {
		warn(
			target,
			"posting-source",
			"Backend deposit ownership is preserved as presentation state.",
			`${path}.source`,
		);
		provisional(target, `${path}.source`);
	}
}

function buildPresentationAccount(
	account: BackendAccount,
	display: Account,
): AccountPresentation {
	return {
		balanceCheck: display.balanceCheck,
		source: display.source,
		readOnly: display.readOnly,
		enabled: account.enabled,
		minBalance: account.minBalance,
		maxBalance: account.maxBalance,
		observedOn: display.observedOn,
	};
}

function buildPresentationRule(
	rule: BackendRecurrenceRule,
	amount: number | null,
	previous?: TransactionPresentation,
): TransactionPresentation {
	const previousAmountMatches =
		previous?.amountValue !== undefined &&
		amount !== null &&
		sameNumber(previous.amountValue, amount);
	const presentationAmount = previousAmountMatches
		? (previous?.amount ?? rule.amount)
		: rule.amount;
	const presentationDestinations =
		previous && Object.hasOwn(previous, "destinations")
			? previous.destinations
			: rule.destinations;
	return {
		amount: presentationAmount,
		amountValue: previousAmountMatches
			? (previous?.amountValue ?? amount)
			: (amount ?? previous?.amountValue),
		destinations: presentationDestinations,
		frequency: previous?.frequency ?? rule.frequency,
		annualCap: previous?.annualCap ?? rule.annualCap,
		priority: previous?.priority ?? rule.priority,
		readOnly: previous?.readOnly ?? amount === null,
		displayFrequency:
			previous?.displayFrequency ?? displayFrequency(rule.frequency),
		displayToId: previous?.displayToId ?? rule.destinations?.[0] ?? null,
		displayAnnualIncrease:
			previous?.displayAnnualIncrease ??
			(growthRateOfAmount(rule.amount) ?? 0) * 100,
	};
}

function buildPresentationPosting(
	posting: BackendPosting,
	amount: number | null,
	previous?: TransactionPresentation,
): TransactionPresentation {
	const previousAmountMatches =
		previous?.amountValue !== undefined &&
		amount !== null &&
		sameNumber(previous.amountValue, amount);
	const presentationAmount = previousAmountMatches
		? (previous?.amount ?? posting.amount)
		: posting.amount;
	const presentationDestinations =
		previous && Object.hasOwn(previous, "destinations")
			? previous.destinations
			: posting.destinations;
	return {
		...(posting.source === undefined ? {} : { source: posting.source }),
		amount: presentationAmount,
		amountValue: previousAmountMatches
			? (previous?.amountValue ?? amount)
			: (amount ?? previous?.amountValue),
		destinations: presentationDestinations,
		postedTime: previous?.postedTime ?? posting.postedTime,
		transactionTime: previous?.transactionTime ?? posting.transactionTime,
		readOnly: amount === null || isSyncOwned(posting.source),
		displayToId: previous?.displayToId ?? posting.destinations?.[0] ?? null,
		displayAnnualIncrease: previous?.displayAnnualIncrease ?? 0,
	};
}

function defaultPlanName(document: FinancialModelDocument): string {
	const value = document.sourcePath.split("/").filter(Boolean).at(-1);
	return value || "Waypoint model";
}

export function backendToDisplayPlan(input: DisplayPlanInput): PlanConversion {
	const { document, status, projection } = input;
	const projectionStartDate =
		input.startDate ?? fallbackStartDate(document, projection);
	const previousPresentation = input.presentation ?? null;
	const conversionReport = report();
	const accountPresentations: Record<string, AccountPresentation> = {};
	const accounts = document.accounts.map((account, index) => {
		const path = `accounts.${index}`;
		const checkpoint = latestCheckpoint(
			document.checkpoints,
			account.id,
			projectionStartDate,
		);
		const observedOn = checkpointDate(checkpoint, projectionStartDate);
		const previous = previousPresentation?.accounts[account.id];
		const archived = isArchivedDebt(account, document, projectionStartDate);
		const display = accountDisplay(
			account,
			checkpoint,
			observedOn,
			accountReadOnly(account.id, document, status),
			previous,
			archived,
		);
		accountPresentations[account.id] = buildPresentationAccount(
			account,
			display,
		);
		addForwardAccountWarnings(conversionReport, account, checkpoint, path);
		return display;
	});

	// Wishlist rows live in their own display slice, never in transactions.
	// Standalone planned-purchase rows come first, then legacy purchase
	// postings for IDs no row covers. Both sort by priority, document order
	// breaking ties; the display slice keeps that order as the priority.
	const rowById = new Map(
		(document.plannedPurchases ?? []).map((row) => [row.id, row]),
	);
	const legacyPurchases = document.postings
		.map((posting, order) => ({ posting, order }))
		.filter(({ posting }) => posting.purchase && !rowById.has(posting.id))
		.sort(
			(left, right) =>
				left.posting.purchase!.priority - right.posting.purchase!.priority ||
				left.order - right.order,
		);
	const orderedRows = (document.plannedPurchases ?? [])
		.map((row, order) => ({ row, order }))
		.sort(
			(left, right) =>
				left.row.priority - right.row.priority || left.order - right.order,
		)
		.map(({ row }) => row);
	const plannedPurchases: PlannedPurchase[] = [
		...orderedRows.map((row) =>
			plannedPurchaseDisplayFromRow(
				row,
				previousPresentation?.plannedPurchases?.[row.id],
			),
		),
		...legacyPurchases.map(({ posting }) => {
			const amount = postingAmountValue(posting, projection);
			addForwardPostingWarnings(
				conversionReport,
				posting,
				amount,
				`plannedPurchases.${posting.id}`,
			);
			return plannedPurchaseDisplayFromPosting(posting, amount);
		}),
	];
	// Every purchase posting is wishlist, whether or not a row covers it:
	// the slice already represents covered IDs, so none stay in transactions.
	const ordinaryPostings = document.postings.filter(
		(posting) => !posting.purchase,
	);

	const transactions: Transaction[] = [
		...(document.recurrenceRules ?? []).map((rule, index) => {
			const amount = postingAmountValue(rule, projection);
			const previous = previousPresentation?.transactions[rule.id];
			addForwardRuleWarnings(
				conversionReport,
				rule,
				amount,
				`transactions.${index}`,
			);
			return transactionDisplayFromRule(rule, amount, previous);
		}),
		...ordinaryPostings.map((posting, index) => {
			const path = `transactions.${(document.recurrenceRules ?? []).length + index}`;
			const amount = postingAmountValue(posting, projection);
			const previous = previousPresentation?.transactions[posting.id];
			addForwardPostingWarnings(conversionReport, posting, amount, path);
			return transactionDisplayFromPosting(posting, amount, previous);
		}),
	];

	const thresholdEvaluations = document.evaluations.netWorthThreshold.map(
		(evaluation, index) => {
			const target = targetFromEvaluation(evaluation.config);
			if (target === 0) {
				warn(
					conversionReport,
					"invalid-evaluation-target",
					"This net-worth evaluation has no usable target and is shown as zero.",
					`evaluations.${index}.target`,
				);
				provisional(conversionReport, `evaluations.${index}.target`);
			}
			return {
				id: evaluation.instanceId,
				name: evaluation.name || evaluation.instanceId,
				kind: "net-worth" as const,
				target,
				accountId: null,
				enabled: evaluation.enabled,
			};
		},
	);
	const reserveEvaluations = document.evaluations.accountBalance.map(
		(evaluation, index) => {
			const config = objectValue(evaluation.config);
			const accountId =
				typeof config?.accountId === "string" ? config.accountId : null;
			const target = targetFromEvaluation(evaluation.config);
			if (accountId === null) {
				warn(
					conversionReport,
					"invalid-evaluation-account",
					"This account evaluation names no account.",
					`evaluations.${index}.accountId`,
				);
				provisional(conversionReport, `evaluations.${index}.accountId`);
			}
			if (target === 0) {
				warn(
					conversionReport,
					"invalid-evaluation-target",
					"This account evaluation has no usable target and is shown as zero.",
					`evaluations.${index}.target`,
				);
				provisional(conversionReport, `evaluations.${index}.target`);
			}
			return {
				id: evaluation.instanceId,
				name: evaluation.name || evaluation.instanceId,
				kind: "reserve" as const,
				target,
				accountId,
				enabled: evaluation.enabled,
			};
		},
	);
	const evaluations = [...thresholdEvaluations, ...reserveEvaluations];

	if (
		document.evaluations.financialIndependence.length ||
		document.evaluations.postingFulfillment.length ||
		(document.evaluations.cycleFulfillment ?? []).length
	) {
		warn(
			conversionReport,
			"server-evaluations",
			"Financial independence, funding gaps, and cycle fulfillment evaluations are listed with the editable evaluations and are read-only in this workspace.",
			"evaluations",
		);
		provisional(conversionReport, "evaluations");
	}
	warn(
		conversionReport,
		"display-assumptions",
		"The backend has no display inflation or volatility assumptions; defaults are used.",
		"assumptions",
	);
	provisional(conversionReport, "assumptions");
	warn(
		conversionReport,
		"display-metadata",
		"Plan name, origin, timestamp, revision, and read-only state stay local and are not imported.",
		"plan",
	);
	provisional(conversionReport, "plan.name");
	provisional(conversionReport, "plan.origin");
	provisional(conversionReport, "plan.updatedAt");
	provisional(conversionReport, "plan.revision");
	provisional(conversionReport, "plan.readOnly");

	const presentation: PlanPresentation = {
		name: previousPresentation?.name ?? defaultPlanName(document),
		origin: previousPresentation?.origin ?? "personal",
		updatedAt: previousPresentation?.updatedAt ?? new Date(0).toISOString(),
		revision: previousPresentation?.revision ?? 1,
		assumptions: previousPresentation?.assumptions ?? {
			inflation: 0,
			volatility: 0,
		},
		accounts: accountPresentations,
		transactions: Object.fromEntries([
			...(document.recurrenceRules ?? []).map((rule) => {
				const previous = previousPresentation?.transactions[rule.id];
				const amount = postingAmountValue(rule, projection);
				return [
					rule.id,
					buildPresentationRule(rule, amount, previous),
				] as const;
			}),
			...ordinaryPostings.map((posting) => {
				const previous = previousPresentation?.transactions[posting.id];
				const amount = postingAmountValue(posting, projection);
				return [
					posting.id,
					buildPresentationPosting(posting, amount, previous),
				] as const;
			}),
		]),
		plannedPurchases: Object.fromEntries([
			...orderedRows.map((row) => {
				const previous = previousPresentation?.plannedPurchases?.[row.id];
				const synthetic: BackendPosting = {
					id: row.id,
					name: row.name,
					sourceAccountId: row.fundingAccountId,
					destinations: null,
					amount: {
						resolver: "expression",
						config: { expression: String(row.cost) },
						inputs: {},
					},
					postedTime: midnightOf(row.earliestDate),
					transactionTime: midnightOf(row.earliestDate),
					enabled: row.enabled,
				};
				return [
					row.id,
					buildPresentationPosting(synthetic, row.cost, previous),
				] as const;
			}),
			...legacyPurchases.map(({ posting }) => {
				const previous =
					previousPresentation?.plannedPurchases?.[posting.id] ??
					previousPresentation?.transactions[posting.id];
				const amount = postingAmountValue(posting, projection);
				return [
					posting.id,
					buildPresentationPosting(posting, amount, previous),
				] as const;
			}),
		]),
	};

	const assumptions = previousPresentation?.assumptions ?? {
		inflation: 0,
		volatility: 0,
	};
	const plan: Plan = {
		schemaVersion: 1,
		name: previousPresentation?.name ?? defaultPlanName(document),
		origin: previousPresentation?.origin ?? "personal",
		startDate: projectionStartDate,
		updatedAt: previousPresentation?.updatedAt ?? new Date(0).toISOString(),
		revision: previousPresentation?.revision ?? 1,
		readOnly: status.readOnly,
		accounts,
		transactions,
		plannedPurchases,
		evaluations,
		assumptions,
	};
	return {
		plan,
		presentation,
		report: conversionReport,
		warnings: conversionReport.warnings,
		losses: conversionReport.losses,
	};
}

/** Refresh derived access metadata without rebuilding canonical rows or draft edits. */
export function refreshDisplayPlanAccess(
	plan: Plan,
	{
		document,
		status,
		presentation,
	}: Pick<DisplayPlanInput, "document" | "status" | "presentation">,
): Pick<PlanConversion, "plan" | "presentation"> {
	return {
		plan: {
			...plan,
			readOnly: status.readOnly,
			accounts: plan.accounts.map((account) => ({
				...account,
				readOnly: accountReadOnly(account.id, document, status),
			})),
		},
		presentation: {
			...presentation,
			accounts: Object.fromEntries(
				Object.entries(presentation?.accounts ?? {}).map(([id, account]) => [
					id,
					{ ...account, readOnly: accountReadOnly(id, document, status) },
				]),
			),
			transactions: presentation?.transactions ?? {},
			plannedPurchases: presentation?.plannedPurchases ?? {},
		},
	};
}

export function displayPlanToBackendDocument(
	plan: Plan,
	options: ReverseAdapterOptions = {},
): BackendDocumentConversion {
	const sourceDocument = options.sourceDocument ?? null;
	const sourceAccounts = new Map(
		(sourceDocument?.accounts ?? []).map((account) => [account.id, account]),
	);
	const sourcePostings = new Map(
		(sourceDocument?.postings ?? []).map((posting) => [posting.id, posting]),
	);
	const sourceRules = new Map(
		(sourceDocument?.recurrenceRules ?? []).map((rule) => [rule.id, rule]),
	);
	const conversionReport = report();
	const checkpointByAccount = new Map<string, BackendCheckpoint[]>();
	const accountPresentations = options.presentation?.accounts ?? {};
	const transactionPresentations = options.presentation?.transactions ?? {};
	const sourcePath =
		options.sourcePath ?? sourceDocument?.sourcePath ?? "frontend";

	const accounts = plan.accounts.map((account, index): BackendAccount => {
		const storedAccount = sourceAccounts.get(account.id);
		const storedExtras = accountPresentations[account.id];
		const sourceCheckpoint = storedAccount
			? latestCheckpoint(
					(sourceDocument as FinancialModelDocument).checkpoints,
					account.id,
					plan.startDate,
				)
			: null;
		const minBalance =
			storedExtras &&
			sameFloorValue(storedExtras.minBalance, account.minBalance)
				? storedExtras.minBalance
				: storedAccount &&
					  sameFloorValue(storedAccount.minBalance, account.minBalance)
					? storedAccount.minBalance
					: account.minBalance;
		const maxBalance =
			storedExtras &&
			sameCeilingValue(storedExtras.maxBalance, account.maxBalance)
				? storedExtras.maxBalance
				: storedAccount &&
					  sameCeilingValue(storedAccount.maxBalance, account.maxBalance)
					? storedAccount.maxBalance
					: account.maxBalance;
		const accountId = account.id;
		const sourceCheckpoints = (sourceDocument?.checkpoints ?? [])
			.filter((checkpoint) => checkpoint.AccountId === accountId)
			.map((checkpoint) => ({ ...checkpoint }));
		const sourceDisplayDate = sourceCheckpoint?.Date ?? plan.startDate;
		const displayObservationChanged =
			!storedAccount ||
			sourceDisplayDate !== account.observedOn ||
			!sameNumber(sourceCheckpoint?.Balance ?? 0, account.balance);
		const targetCheckpointDate = account.observedOn || plan.startDate;
		const conflictingCheckpoint = sourceCheckpoints.find(
			(checkpoint) => checkpoint.Date === targetCheckpointDate,
		);
		if (
			conflictingCheckpoint &&
			(!sourceCheckpoint ||
				conflictingCheckpoint.Date !== sourceCheckpoint.Date)
		) {
			lose(
				conversionReport,
				`accounts.${account.id}.checkpoints`,
				`A checkpoint already exists for ${account.id} on ${targetCheckpointDate}.`,
				`accounts.${index}.checkpoints`,
			);
		}
		const sameCheckpoint = Boolean(
			storedAccount &&
			sourceCheckpoint &&
			sourceCheckpoint.Date === account.observedOn &&
			sameNumber(sourceCheckpoint.Balance, account.balance),
		);
		if (
			sameCheckpoint ||
			(storedAccount && !sourceCheckpoint && !displayObservationChanged)
		) {
			checkpointByAccount.set(accountId, sourceCheckpoints);
		} else if (
			sourceCheckpoint &&
			sourceCheckpoint.Date === (account.observedOn || plan.startDate)
		) {
			checkpointByAccount.set(accountId, [
				...sourceCheckpoints.filter(
					(checkpoint) =>
						!(
							checkpoint.Date === sourceCheckpoint.Date &&
							checkpoint.AccountId === sourceCheckpoint.AccountId
						),
				),
				{
					Date: account.observedOn || plan.startDate,
					AccountId: accountId,
					Balance: account.balance,
					source: "user",
				},
			]);
		} else {
			checkpointByAccount.set(accountId, [
				...sourceCheckpoints,
				{
					Date: account.observedOn || plan.startDate,
					AccountId: accountId,
					Balance: account.balance,
					source: "user",
				},
			]);
		}
		checkpointByAccount.set(
			accountId,
			[...(checkpointByAccount.get(accountId) ?? [])].sort((left, right) =>
				left.Date.localeCompare(right.Date),
			),
		);
		if (storedExtras && account.source !== storedExtras.source)
			lose(
				conversionReport,
				`accounts.${account.id}.source`,
				"Display account source is not a backend account field.",
				`accounts.${index}.source`,
			);
		if (storedExtras && account.readOnly !== storedExtras.readOnly)
			lose(
				conversionReport,
				`accounts.${account.id}.readOnly`,
				"Display account read-only state is not a backend account field.",
				`accounts.${index}.readOnly`,
			);
		provisional(conversionReport, `accounts.${account.id}.kind`);
		provisional(conversionReport, `accounts.${account.id}.source`);
		provisional(conversionReport, `accounts.${account.id}.readOnly`);
		warn(
			conversionReport,
			"account-presentation-metadata",
			"Balance verification, source, and read-only state stay local and are not imported.",
			`accounts.${index}`,
		);
		return {
			...storedAccount,
			id: account.id,
			name: account.name,
			kind: account.kind,
			minBalance: minBalance,
			maxBalance,
			color: account.color ?? storedAccount?.color ?? null,
			enabled: account.enabled,
		};
	});

	const removedAccountIDs = (sourceDocument?.accounts ?? [])
		.filter((account) => !plan.accounts.some((item) => item.id === account.id))
		.map((account) => account.id);
	for (const accountId of removedAccountIDs) {
		const hasSyncCheckpoint =
			sourceDocument?.checkpoints.some(
				(checkpoint) =>
					checkpoint.AccountId === accountId && isSyncOwned(checkpoint.source),
			) ?? false;
		const hasSyncPosting =
			sourceDocument?.postings.some(
				(posting) =>
					isSyncOwned(posting.source) &&
					(posting.sourceAccountId === accountId ||
						posting.destinations?.includes(accountId)),
			) ?? false;
		if (hasSyncCheckpoint || hasSyncPosting) {
			lose(
				conversionReport,
				`accounts.${accountId}`,
				"An account with a synced checkpoint or posting cannot be removed through the display plan.",
				`accounts.${accountId}`,
			);
		} else {
			warn(
				conversionReport,
				"account-removed",
				"The backend account will be removed from the canonical model.",
				`accounts.${accountId}`,
			);
		}
	}

	const postings: BackendPosting[] = [];
	const recurrenceRules: BackendRecurrenceRule[] = [];
	let rulePosition = 0;
	const sourceRuleOrder = (sourceDocument?.recurrenceRules ?? []).map(
		(rule) => rule.id,
	);
	const planRuleOrder = plan.transactions
		.filter((transaction) => transaction.frequency !== "once")
		.map((transaction) => transaction.id);
	const ruleOrderKept =
		sourceRuleOrder.length === planRuleOrder.length &&
		sourceRuleOrder.every((id, position) => planRuleOrder[position] === id);
	plan.transactions.forEach((transaction, index) => {
		const storedExtras = transactionPresentations[transaction.id];
		const storedPosting = sourcePostings.get(transaction.id);
		const storedRule = sourceRules.get(transaction.id);
		const storedAmount = storedPosting ?? storedRule;
		if (Boolean(transaction.pending) !== Boolean(storedPosting?.pending)) {
			lose(
				conversionReport,
				`transactions.${transaction.id}.pending`,
				"Pending status is server-owned bank metadata.",
				`transactions.${index}.pending`,
			);
		}
		if (
			isSyncOwned(storedPosting?.source) &&
			(transaction.readOnly !== true || transaction.frequency !== "once")
		) {
			lose(
				conversionReport,
				`transactions.${transaction.id}.readOnly`,
				"Synced postings cannot be edited through the display plan.",
				`transactions.${index}.readOnly`,
			);
		}
		const originalAmountValue = storedAmount
			? postingAmountValue(storedAmount, null)
			: null;
		const baselineAmountValue =
			storedExtras?.amountValue ?? originalAmountValue;
		const sameAmount =
			baselineAmountValue !== null &&
			sameNumber(baselineAmountValue, transaction.amount);
		const preservedAmount = storedExtras?.amount ?? storedAmount?.amount;
		const amount: PostingAmountResolution =
			transaction.amountKnown === false
				? (preservedAmount ?? {
						resolver: "expression",
						config: { expression: String(transaction.amount) },
						inputs: {},
					})
				: sameAmount && preservedAmount
					? preservedAmount
					: {
							resolver: "expression",
							config: { expression: String(transaction.amount) },
							inputs: {},
						};
		if (transaction.amountKnown === false && !preservedAmount) {
			lose(
				conversionReport,
				`transactions.${transaction.id}.amount`,
				"An unresolved backend amount cannot be represented in the display plan.",
				`transactions.${index}.amount`,
			);
		}
		const originalDestinations =
			storedExtras && Object.hasOwn(storedExtras, "destinations")
				? storedExtras.destinations
				: storedAmount?.destinations;
		const previousDisplayDestination =
			storedExtras?.displayToId ?? storedAmount?.destinations?.[0] ?? null;
		const sameDestination = previousDisplayDestination === transaction.toId;
		const destinations =
			sameDestination && originalDestinations !== undefined
				? originalDestinations
				: transaction.toId === null
					? null
					: [transaction.toId];
		if (
			storedAmount &&
			originalDestinations &&
			originalDestinations.length > 1 &&
			JSON.stringify(originalDestinations) !== JSON.stringify(destinations)
		) {
			lose(
				conversionReport,
				`transactions.${transaction.id}.destinations`,
				"The display transaction can represent only one destination from the stored backend transaction.",
				`transactions.${index}.destinations`,
			);
		}
		const previousReadOnly =
			storedExtras?.readOnly ?? isSyncOwned(storedPosting?.source);
		if (transaction.readOnly !== previousReadOnly)
			lose(
				conversionReport,
				`transactions.${transaction.id}.readOnly`,
				"Display transaction read-only state is not a backend posting field.",
				`transactions.${index}.readOnly`,
			);
		provisional(conversionReport, `transactions.${transaction.id}.readOnly`);
		warn(
			conversionReport,
			"transaction-presentation-storedExtras",
			"Transaction read-only state stays local and is not imported.",
			`transactions.${index}`,
		);
		if (transaction.frequency === "once") {
			const source = storedPosting?.source ?? storedExtras?.source;
			const storedPostedTime =
				storedExtras?.postedTime ?? storedPosting?.postedTime ?? null;
			const storedTransactionTime =
				storedExtras?.transactionTime ?? storedPosting?.transactionTime ?? null;
			const storedDay =
				storedPostedTime !== null && storedTransactionTime !== null
					? dayFromTimes(storedTransactionTime, storedPostedTime)
					: null;
			const midnight = midnightOf(transaction.startDate);
			// An explicitly set settlement day wins; a matching stored day
			// keeps its exact time so edits never drop intraday precision.
			const postedDay = transaction.postedDate ?? null;
			const postedTime =
				postedDay !== null &&
				storedPostedTime !== null &&
				settledDay(storedPostedTime) === postedDay
					? storedPostedTime
					: postedDay !== null
						? midnightOf(postedDay)
						: storedDay === transaction.startDate && storedPostedTime !== null
							? storedPostedTime
							: midnight;
			const transactionTime =
				storedDay === transaction.startDate && storedTransactionTime !== null
					? storedTransactionTime
					: midnight;
			postings.push({
				...storedPosting,
				id: transaction.id,
				name: transaction.name,
				sourceAccountId: transaction.fromId,
				destinations,
				amount,
				postedTime,
				transactionTime,
				// Wishlist items no longer ride on transactions. A regular transaction
				// reusing a legacy purchase posting clears its marker.
				...(storedPosting?.purchase ? { purchase: null } : {}),
				...(transaction.claimRuleId && transaction.claimOccurrenceDate
					? {
							claim: {
								ruleId: transaction.claimRuleId,
								occurrenceDate: transaction.claimOccurrenceDate,
							},
						}
					: storedPosting?.claim === undefined
						? {}
						: { claim: null }),
				enabled: transaction.enabled,
				...(source === undefined ? {} : { source }),
			});
			return;
		}
		rulePosition += 1;
		const previousDisplayFrequency =
			storedExtras?.displayFrequency ??
			(storedRule ? displayFrequency(storedRule.frequency) : undefined);
		const sameFrequency = previousDisplayFrequency === transaction.frequency;
		const frequency = sameFrequency
			? (storedExtras?.frequency ??
				storedRule?.frequency ??
				backendFrequency(transaction.frequency))
			: backendFrequency(transaction.frequency);
		const storedGrowth = growthRateOfAmount(preservedAmount) ?? 0;
		const sameGrowth = sameNumber(
			storedGrowth * 100,
			transaction.annualIncrease,
		);
		const effectiveGrowth = sameGrowth
			? storedGrowth
			: transaction.annualIncrease / 100;
		const grownAmount =
			effectiveGrowth !== 0 || growthRateOfAmount(amount) !== null
				? withGrowthRate(amount, effectiveGrowth)
				: amount;
		recurrenceRules.push({
			...storedRule,
			id: transaction.id,
			name: transaction.name,
			sourceAccountId: transaction.fromId,
			destinations,
			amount: grownAmount,
			frequency,
			startDate: transaction.startDate,
			endDate: transaction.endDate,
			annualCap: storedExtras?.annualCap ?? storedRule?.annualCap ?? null,
			priority: ruleOrderKept
				? (storedExtras?.priority ?? storedRule?.priority ?? rulePosition)
				: rulePosition,
			enabled: transaction.enabled,
		});
	});

	// The wishlist slice persists as legacy purchase postings until the
	// backend ships planned-purchase rows and endpoints. Array order is the
	// priority. Stored owner metadata (source, execution order, exact times)
	// carries over so a wishlist edit never rewrites unrelated fields.
	const plannedPresentations = options.presentation?.plannedPurchases ?? {};
	plan.plannedPurchases.forEach((purchase, priority) => {
		const storedExtras =
			plannedPresentations[purchase.id] ??
			transactionPresentations[purchase.id];
		const storedPosting = sourcePostings.get(purchase.id);
		if (storedPosting && storedPosting.pending) {
			lose(
				conversionReport,
				`plannedPurchases.${purchase.id}.pending`,
				"Pending status is server-owned bank metadata.",
				`plannedPurchases.${purchase.id}.pending`,
			);
		}
		const originalAmountValue = storedPosting
			? postingAmountValue(storedPosting, null)
			: null;
		const baselineAmountValue =
			storedExtras?.amountValue ?? originalAmountValue;
		const sameAmount =
			baselineAmountValue !== null &&
			sameNumber(baselineAmountValue, purchase.amount);
		const preservedAmount = storedExtras?.amount ?? storedPosting?.amount;
		const amount: PostingAmountResolution =
			sameAmount && preservedAmount
				? preservedAmount
				: {
						resolver: "expression",
						config: { expression: String(purchase.amount) },
						inputs: {},
					};
		const source = storedPosting?.source ?? storedExtras?.source;
		const storedPostedTime =
			storedExtras?.postedTime ?? storedPosting?.postedTime ?? null;
		const storedTransactionTime =
			storedExtras?.transactionTime ?? storedPosting?.transactionTime ?? null;
		const storedDay =
			storedPostedTime !== null && storedTransactionTime !== null
				? dayFromTimes(storedTransactionTime, storedPostedTime)
				: null;
		const midnight = midnightOf(purchase.startDate);
		const postedTime =
			storedDay === purchase.startDate && storedPostedTime !== null
				? storedPostedTime
				: midnight;
		const transactionTime =
			storedDay === purchase.startDate && storedTransactionTime !== null
				? storedTransactionTime
				: midnight;
		const previousReadOnly =
			storedExtras?.readOnly ?? isSyncOwned(storedPosting?.source);
		if (purchase.readOnly !== previousReadOnly)
			lose(
				conversionReport,
				`plannedPurchases.${purchase.id}.readOnly`,
				"Display purchase read-only state is not a backend posting field.",
				`plannedPurchases.${purchase.id}.readOnly`,
			);
		provisional(conversionReport, `plannedPurchases.${purchase.id}.readOnly`);
		postings.push({
			...storedPosting,
			id: purchase.id,
			name: purchase.name,
			sourceAccountId: purchase.fromId,
			destinations: null,
			amount,
			postedTime,
			transactionTime,
			purchase: { priority },
			...(storedPosting?.claim === undefined ? {} : { claim: null }),
			enabled: purchase.enabled,
			...(source === undefined ? {} : { source }),
		});
	});

	const removedTransactionIDs = (ids: string[]) =>
		ids.filter(
			(id) =>
				!plan.transactions.some((item) => item.id === id) &&
				!plan.plannedPurchases.some((item) => item.id === id),
		);

	for (const postingId of removedTransactionIDs(
		(sourceDocument?.postings ?? []).map((posting) => posting.id),
	)) {
		const storedPosting = sourcePostings.get(postingId);
		if (isSyncOwned(storedPosting?.source)) {
			lose(
				conversionReport,
				`transactions.${postingId}`,
				"Synced postings cannot be removed through the display plan.",
				`transactions.${postingId}`,
			);
		} else {
			warn(
				conversionReport,
				"posting-removed",
				"The backend deposit will be removed from the canonical model.",
				`transactions.${postingId}`,
			);
		}
	}
	for (const ruleId of removedTransactionIDs(
		(sourceDocument?.recurrenceRules ?? []).map((rule) => rule.id),
	)) {
		warn(
			conversionReport,
			"rule-removed",
			"The backend recurrence rule will be removed from the canonical model.",
			`transactions.${ruleId}`,
		);
	}

	const sourceEvaluations = sourceDocument?.evaluations;
	const financialIndependence = sourceEvaluations?.financialIndependence ?? [];
	const postingFulfillment = sourceEvaluations?.postingFulfillment ?? [];
	const cycleFulfillment = sourceEvaluations?.cycleFulfillment ?? [];
	const netWorthThreshold = plan.evaluations
		.filter((evaluation) => evaluation.kind === "net-worth")
		.map((evaluation) => {
			const storedEvaluation = sourceEvaluations?.netWorthThreshold.find(
				(item) => item.instanceId === evaluation.id,
			);
			const storedConfig = storedEvaluation
				? objectValue(storedEvaluation.config)
				: null;
			return {
				...storedEvaluation,
				instanceId: evaluation.id,
				name: evaluation.name,
				enabled: evaluation.enabled,
				config: {
					...storedConfig,
					target: evaluation.target,
				} satisfies JsonObject,
			};
		});
	const accountBalance = plan.evaluations
		.filter((evaluation) => evaluation.kind === "reserve")
		.map((evaluation) => {
			const storedEvaluation = sourceEvaluations?.accountBalance.find(
				(item) => item.instanceId === evaluation.id,
			);
			const storedConfig = storedEvaluation
				? objectValue(storedEvaluation.config)
				: null;
			return {
				...storedEvaluation,
				instanceId: evaluation.id,
				name: evaluation.name,
				enabled: evaluation.enabled,
				config: {
					...storedConfig,
					accountId: evaluation.accountId,
					target: evaluation.target,
				} satisfies JsonObject,
			};
		});
	const removedBalanceIDs = (sourceEvaluations?.accountBalance ?? [])
		.filter(
			(item) =>
				!plan.evaluations.some(
					(evaluation) =>
						evaluation.kind === "reserve" && evaluation.id === item.instanceId,
				),
		)
		.map((evaluation) => evaluation.instanceId);
	for (const instanceId of removedBalanceIDs)
		lose(
			conversionReport,
			`evaluations.accountBalance.${instanceId}`,
			"The backend account balance evaluation is absent from the display plan and will not be uploaded.",
			`evaluations.accountBalance.${instanceId}`,
		);
	const removedThresholdIDs = (sourceEvaluations?.netWorthThreshold ?? [])
		.filter(
			(item) =>
				!plan.evaluations.some(
					(evaluation) =>
						evaluation.kind === "net-worth" &&
						evaluation.id === item.instanceId,
				),
		)
		.map((evaluation) => evaluation.instanceId);
	for (const instanceId of removedThresholdIDs)
		lose(
			conversionReport,
			`evaluations.netWorthThreshold.${instanceId}`,
			"The backend net-worth threshold is absent from the display plan and will not be uploaded.",
			`evaluations.netWorthThreshold.${instanceId}`,
		);
	if (
		plan.evaluations.length !==
		netWorthThreshold.length + accountBalance.length
	) {
		lose(
			conversionReport,
			"evaluations",
			"One or more display evaluations could not be converted to a backend evaluation.",
			"evaluations",
		);
	}
	const previousAssumptions = options.presentation?.assumptions ?? {
		inflation: 0,
		volatility: 0,
	};
	if (
		!sameNumber(plan.assumptions.inflation, previousAssumptions.inflation) ||
		!sameNumber(plan.assumptions.volatility, previousAssumptions.volatility)
	) {
		lose(
			conversionReport,
			"assumptions",
			"Display inflation and volatility assumptions have no backend document field.",
			"assumptions",
		);
	}
	provisional(conversionReport, "assumptions");
	warn(
		conversionReport,
		"assumptions-provisional",
		"Inflation and variability assumptions stay local and are not imported.",
		"assumptions",
	);
	const previousName =
		options.presentation?.name ??
		(sourceDocument ? defaultPlanName(sourceDocument) : "Waypoint model");
	const previousOrigin = options.presentation?.origin ?? "personal";
	const previousUpdatedAt =
		options.presentation?.updatedAt ?? new Date(0).toISOString();
	const previousRevision = options.presentation?.revision ?? 1;
	if (plan.name !== previousName)
		lose(
			conversionReport,
			"name",
			"The display plan name has no backend document field.",
			"name",
		);
	if (plan.origin !== previousOrigin)
		lose(
			conversionReport,
			"origin",
			"The display plan origin has no backend document field.",
			"origin",
		);
	if (plan.updatedAt !== previousUpdatedAt)
		lose(
			conversionReport,
			"updatedAt",
			"The display plan timestamp has no backend document field.",
			"updatedAt",
		);
	if (plan.revision !== previousRevision)
		lose(
			conversionReport,
			"revision",
			"The display plan revision has no backend document field.",
			"revision",
		);
	provisional(conversionReport, "name");
	provisional(conversionReport, "origin");
	provisional(conversionReport, "updatedAt");
	provisional(conversionReport, "revision");
	provisional(conversionReport, "readOnly");
	warn(
		conversionReport,
		"plan-presentation-metadata",
		"Plan name, origin, timestamp, revision, and read-only state stay local and are not imported.",
		"plan",
	);

	const checkpoints = plan.accounts.flatMap(
		(account) => checkpointByAccount.get(account.id) ?? [],
	);
	const evaluations: EvaluationTables = {
		...sourceEvaluations,
		financialIndependence: [...financialIndependence],
		netWorthThreshold,
		accountBalance,
		postingFulfillment: [...postingFulfillment],
		cycleFulfillment: [...cycleFulfillment],
		...(sourceEvaluations?.plannedPurchases
			? { plannedPurchases: [...sourceEvaluations.plannedPurchases] }
			: {}),
	};
	return {
		document: {
			...sourceDocument,
			sourcePath,
			accounts,
			checkpoints,
			evaluations,
			postings,
			recurrenceRules,
		},
		report: conversionReport,
		warnings: conversionReport.warnings,
		losses: conversionReport.losses,
	};
}
