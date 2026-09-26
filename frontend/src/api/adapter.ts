import type { Account, Movement, Plan } from "../domain/model.ts";
import {
	type BackendAccount,
	type BackendCheckpoint,
	type BackendPosting,
	type EvaluationTables,
	type FinancialModelDocument,
	type IsoDate,
	type JsonObject,
	type JsonValue,
	NO_CEILING_SENTINEL,
	NO_FLOOR_SENTINEL,
	type PostingAmountResolution,
	type PostingFrequency,
	type ProjectionResult,
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

export interface AccountAdapterSidecar {
	kind: Account["kind"];
	provenance: Account["provenance"];
	source: string;
	readOnly: boolean;
	color: string | null;
	enabled: boolean;
	minBalance: number | null;
	maxBalance: number | null;
	observedOn: IsoDate;
}

export interface MovementAdapterSidecar {
	source?: string;
	amount?: PostingAmountResolution;
	amountValue?: number;
	destinations?: string[] | null;
	frequency?: PostingFrequency;
	annualRate?: number;
	annualGrowthRate?: number;
	volatility?: number;
	annualCap?: number | null;
	priority?: number;
	provenance: Movement["provenance"];
	readOnly: boolean;
	displayFrequency?: Movement["frequency"];
	displayToId?: string | null;
	displayAnnualIncrease?: number;
}

export interface PlanPresentationSidecar {
	name?: string;
	origin?: Plan["origin"];
	updatedAt?: string;
	revision?: number;
	assumptions?: Plan["assumptions"];
	accounts: Record<string, AccountAdapterSidecar>;
	movements: Record<string, MovementAdapterSidecar>;
	provisionalFields: ProvisionalField[];
}

export interface PlanSidecar {
	version: 1;
	sourceDocument?: FinancialModelDocument;
	projectionStartDate?: IsoDate;
	presentation: PlanPresentationSidecar;
}

export interface DisplayPlanInput {
	document: FinancialModelDocument;
	status: ServerStatus;
	projection?: ProjectionResult | null;
	sidecar?: PlanSidecar | null;
	startDate?: IsoDate;
}

export interface PlanConversion {
	plan: Plan;
	sidecar: PlanSidecar;
	report: AdapterReport;
	warnings: AdapterWarning[];
	losses: AdapterLoss[];
}

export interface ReverseAdapterOptions {
	sidecar?: PlanSidecar | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectValue(value: JsonValue | undefined): JsonObject | null {
	return isRecord(value) ? (value as JsonObject) : null;
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

function latestCheckpoint(
	document: FinancialModelDocument,
	accountId: string,
	projectionStartDate: IsoDate,
): BackendCheckpoint | null {
	const candidates = document.checkpoints
		.map((checkpoint, index) => ({ checkpoint, index }))
		.filter(
			({ checkpoint }) =>
				checkpoint.AccountId === accountId &&
				checkpoint.Date <= projectionStartDate,
		)
		.sort(
			(left, right) =>
				right.checkpoint.Date.localeCompare(left.checkpoint.Date) ||
				left.index - right.index,
		);
	return candidates[0]?.checkpoint ?? null;
}

function boundValue(
	value: number | null | undefined,
	noBound: number,
): number | null {
	if (value === null || value === undefined || value === noBound) return null;
	return Number.isFinite(value) ? value : null;
}

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
	return (
		projection?.milestones.projectionStartDate ??
		latestDate(document.checkpoints.map((checkpoint) => checkpoint.Date)) ??
		document.postings[0]?.startDate ??
		new Date().toISOString().slice(0, 10)
	);
}

// A posting is recorded history when a bank supplied it, or when it is a
// one-time movement that happened at or before the projection start. The
// backend has no provenance field, so this is inferred from what the document
// already carries. Inferring only from the source would label model-authored
// past activity as a future plan.
function postingProvenance(
	posting: BackendPosting,
	projectionStartDate: IsoDate,
): Movement["provenance"] {
	if (posting.source === "simplefin") return "recorded";
	if (posting.frequency === "once" && posting.startDate <= projectionStartDate)
		return "recorded";
	return "planned";
}

function numericExpression(value: string | undefined): number | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(trimmed)) return null;
	return finite(Number(trimmed));
}

function postingAmountValue(
	posting: BackendPosting,
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
	const event = projection?.movementEvents?.find(
		(item) => item.origin.postingId === posting.id,
	);
	return finite(event?.requestedAmount) ?? null;
}

function displayFrequency(frequency: PostingFrequency): Movement["frequency"] {
	if (frequency === "annual") return "yearly";
	if (frequency === "once" || frequency === "monthly") return frequency;
	return "monthly";
}

function backendFrequency(frequency: Movement["frequency"]): PostingFrequency {
	return frequency === "yearly" ? "annual" : frequency;
}

function accountKind(balance: number): Account["kind"] {
	return balance < 0 ? "debt" : "cash";
}

function targetFromEvaluation(config: JsonValue | undefined): number {
	const object = objectValue(config);
	return finite(object?.target) ?? 0;
}

function accountDisplay(
	account: BackendAccount,
	checkpoint: BackendCheckpoint | null,
	observedOn: IsoDate,
	status: ServerStatus,
	previous: AccountAdapterSidecar | undefined,
	syncCheckpoint: boolean,
): Account {
	const floor = boundValue(account.minBalance, NO_FLOOR_SENTINEL);
	const maxBalance = boundValue(account.maxBalance, NO_CEILING_SENTINEL);
	return {
		id: account.id,
		name: account.label || account.id,
		kind: previous?.kind ?? accountKind(checkpoint?.Balance ?? 0),
		enabled: account.enabled,
		balance: checkpoint?.Balance ?? 0,
		floor: floor === null || floor < 0 ? 0 : floor,
		ceiling: maxBalance === null || maxBalance < 0 ? null : maxBalance,
		observedOn,
		provenance: previous?.provenance ?? (checkpoint ? "recorded" : "modeled"),
		source:
			previous?.source ??
			(checkpoint?.source === "simplefin"
				? "SimpleFIN checkpoint"
				: checkpoint
					? "Backend checkpoint"
					: "Backend account"),
		readOnly: previous?.readOnly || syncCheckpoint || status.readOnly,
	};
}

function movementDisplay(
	posting: BackendPosting,
	amount: number | null,
	projectionStartDate: IsoDate,
	previous?: MovementAdapterSidecar,
): Movement {
	const destinations = posting.destinations ?? [];
	const firstDestination = destinations[0] ?? null;
	return {
		id: posting.id,
		name: posting.label || posting.id,
		amount: Math.max(0, amount ?? 0),
		amountKnown: amount !== null,
		fromId: posting.sourceAccountId,
		toId: firstDestination,
		frequency:
			previous?.displayFrequency ?? displayFrequency(posting.frequency),
		startDate: posting.startDate,
		endDate: posting.endDate,
		annualIncrease:
			previous?.displayAnnualIncrease ?? posting.annualGrowthRate * 100,
		enabled: posting.enabled,
		provenance:
			previous?.provenance ?? postingProvenance(posting, projectionStartDate),
		readOnly:
			previous?.readOnly ?? (amount === null || posting.source === "simplefin"),
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
			"The backend has no account floor; the display floor defaults to zero.",
			`${path}.floor`,
		);
		provisional(target, `${path}.floor`);
	}
	if (
		account.maxBalance === null ||
		account.maxBalance === NO_CEILING_SENTINEL
	) {
		warn(
			target,
			"sentinel-ceiling",
			"The backend has no account ceiling; the display ceiling is unbounded.",
			`${path}.ceiling`,
		);
		provisional(target, `${path}.ceiling`);
	}
	if (
		account.minBalance !== null &&
		account.minBalance !== NO_FLOOR_SENTINEL &&
		account.minBalance < 0
	) {
		warn(
			target,
			"negative-floor",
			"A negative backend floor cannot be represented by the display model and is shown as zero.",
			`${path}.floor`,
		);
		provisional(target, `${path}.floor`);
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
			"The posting amount resolver is not a fixed number; the display amount is provisional.",
			`${path}.amount`,
		);
		provisional(target, `${path}.amount`);
	}
	if (
		posting.frequency === "daily" ||
		posting.frequency === "weekly" ||
		posting.frequency === "quarterly"
	) {
		warn(
			target,
			"unsupported-frequency",
			"The display movement frequency is approximated as monthly.",
			`${path}.frequency`,
		);
		provisional(target, `${path}.frequency`);
	}
	if ((posting.destinations?.length ?? 0) > 1) {
		warn(
			target,
			"multiple-destinations",
			"The display movement can show one destination; additional backend destinations remain in the sidecar.",
			`${path}.toId`,
		);
		provisional(target, `${path}.toId`);
	}
	if (
		posting.annualRate !== 0 ||
		posting.volatility !== 0 ||
		posting.annualCap !== null
	) {
		warn(
			target,
			"posting-metadata",
			"Backend annual rate, volatility, and annual cap are preserved as sidecar metadata.",
			path,
		);
		provisional(target, `${path}.metadata`);
	}
	if (posting.source) {
		warn(
			target,
			"posting-source",
			"Backend posting ownership is preserved as sidecar metadata.",
			`${path}.source`,
		);
		provisional(target, `${path}.source`);
	}
}

function buildSidecarAccount(
	account: BackendAccount,
	checkpoint: BackendCheckpoint | null,
	observedOn: IsoDate,
	status: ServerStatus,
	previous?: AccountAdapterSidecar,
): AccountAdapterSidecar {
	return {
		kind: previous?.kind ?? accountKind(checkpoint?.Balance ?? 0),
		provenance: previous?.provenance ?? (checkpoint ? "recorded" : "modeled"),
		source:
			previous?.source ??
			(checkpoint?.source === "simplefin"
				? "SimpleFIN checkpoint"
				: checkpoint
					? "Backend checkpoint"
					: "Backend account"),
		readOnly: previous?.readOnly ?? status.readOnly,
		color: account.color,
		enabled: account.enabled,
		minBalance: account.minBalance,
		maxBalance: account.maxBalance,
		observedOn,
	};
}

function buildSidecarPosting(
	posting: BackendPosting,
	amount: number | null,
	projectionStartDate: IsoDate,
	previous?: MovementAdapterSidecar,
): MovementAdapterSidecar {
	const previousAmountMatches =
		previous?.amountValue !== undefined &&
		amount !== null &&
		sameNumber(previous.amountValue, amount);
	const sidecarAmount = previousAmountMatches
		? (previous?.amount ?? posting.amount)
		: posting.amount;
	const sidecarDestinations =
		previous && Object.hasOwn(previous, "destinations")
			? previous.destinations
			: posting.destinations;
	return {
		...(posting.source === undefined && previous?.source === undefined
			? {}
			: { source: previous?.source ?? posting.source }),
		amount: sidecarAmount,
		amountValue: previousAmountMatches
			? (previous?.amountValue ?? amount)
			: (amount ?? previous?.amountValue),
		destinations: sidecarDestinations,
		frequency: previous?.frequency ?? posting.frequency,
		annualRate: previous?.annualRate ?? posting.annualRate,
		annualGrowthRate: previous?.annualGrowthRate ?? posting.annualGrowthRate,
		volatility: previous?.volatility ?? posting.volatility,
		annualCap: previous?.annualCap ?? posting.annualCap,
		priority: previous?.priority ?? posting.priority,
		provenance:
			previous?.provenance ?? postingProvenance(posting, projectionStartDate),
		readOnly:
			previous?.readOnly ?? (amount === null || posting.source === "simplefin"),
		displayFrequency:
			previous?.displayFrequency ?? displayFrequency(posting.frequency),
		displayToId: previous?.displayToId ?? posting.destinations?.[0] ?? null,
		displayAnnualIncrease:
			previous?.displayAnnualIncrease ?? posting.annualGrowthRate * 100,
	};
}

function defaultPlanName(document: FinancialModelDocument): string {
	const value = document.sourcePath.split("/").filter(Boolean).at(-1);
	return value || "Waypoint plan";
}

export function backendToDisplayPlan(input: DisplayPlanInput): PlanConversion {
	const { document, status, projection } = input;
	const projectionStartDate =
		input.startDate ?? fallbackStartDate(document, projection);
	const previousPresentation = input.sidecar?.presentation;
	const conversionReport = report();
	const accountSidecars: Record<string, AccountAdapterSidecar> = {};
	const accounts = document.accounts.map((account, index) => {
		const path = `accounts.${index}`;
		const checkpoint = latestCheckpoint(
			document,
			account.id,
			projectionStartDate,
		);
		const observedOn = checkpointDate(checkpoint, projectionStartDate);
		const previous = previousPresentation?.accounts[account.id];
		const syncCheckpoint = document.checkpoints.some(
			(item) => item.AccountId === account.id && item.source === "simplefin",
		);
		const display = accountDisplay(
			account,
			checkpoint,
			observedOn,
			status,
			previous,
			syncCheckpoint,
		);
		accountSidecars[account.id] = buildSidecarAccount(
			account,
			checkpoint,
			observedOn,
			status,
			previous,
		);
		addForwardAccountWarnings(conversionReport, account, checkpoint, path);
		if (!previous) {
			warn(
				conversionReport,
				"account-kind-inferred",
				"The display account kind is inferred from the checkpoint balance.",
				`${path}.kind`,
			);
			provisional(conversionReport, `${path}.kind`);
		}
		return display;
	});

	const movements = document.postings.map((posting, index) => {
		const path = `movements.${index}`;
		const amount = postingAmountValue(posting, projection);
		const previous = previousPresentation?.movements[posting.id];
		addForwardPostingWarnings(conversionReport, posting, amount, path);
		if (!previous) {
			warn(
				conversionReport,
				"posting-provenance-inferred",
				"The display movement provenance is inferred; the backend has no provenance field.",
				`${path}.provenance`,
			);
			provisional(conversionReport, `${path}.provenance`);
		}
		return movementDisplay(posting, amount, projectionStartDate, previous);
	});

	const thresholdGoals = document.evaluations.netWorthThreshold.map(
		(evaluation, index) => {
			const target = targetFromEvaluation(evaluation.config);
			if (target === 0) {
				warn(
					conversionReport,
					"invalid-goal-target",
					"The net-worth threshold has no finite target and is shown provisionally as zero.",
					`goals.${index}.target`,
				);
				provisional(conversionReport, `goals.${index}.target`);
			}
			return {
				id: evaluation.instanceId,
				name: evaluation.label || evaluation.instanceId,
				kind: "net-worth" as const,
				target,
				accountId: null,
				enabled: evaluation.enabled,
			};
		},
	);
	const reserveGoals = document.evaluations.accountBalance.map(
		(evaluation, index) => {
			const config = objectValue(evaluation.config);
			const accountId =
				typeof config?.accountId === "string" ? config.accountId : null;
			const target = targetFromEvaluation(evaluation.config);
			if (accountId === null) {
				warn(
					conversionReport,
					"invalid-goal-account",
					"The account balance goal names no account and is shown provisionally.",
					`goals.${index}.accountId`,
				);
				provisional(conversionReport, `goals.${index}.accountId`);
			}
			if (target === 0) {
				warn(
					conversionReport,
					"invalid-goal-target",
					"The account balance goal has no finite target and is shown provisionally as zero.",
					`goals.${index}.target`,
				);
				provisional(conversionReport, `goals.${index}.target`);
			}
			return {
				id: evaluation.instanceId,
				name: evaluation.label || evaluation.instanceId,
				kind: "reserve" as const,
				target,
				accountId,
				enabled: evaluation.enabled,
			};
		},
	);
	const goals = [...thresholdGoals, ...reserveGoals];

	if (
		document.evaluations.financialIndependence.length ||
		document.evaluations.postingFulfillment.length
	) {
		warn(
			conversionReport,
			"unsupported-evaluations",
			"Financial-independence and posting-fulfillment evaluations remain in the sidecar and are not display goals.",
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
		"Plan name, origin, timestamp, revision, and read-only state are local presentation metadata.",
		"plan",
	);
	provisional(conversionReport, "plan.name");
	provisional(conversionReport, "plan.origin");
	provisional(conversionReport, "plan.updatedAt");
	provisional(conversionReport, "plan.revision");
	provisional(conversionReport, "plan.readOnly");

	const sidecar: PlanSidecar = {
		version: 1,
		sourceDocument: document,
		projectionStartDate,
		presentation: {
			name: previousPresentation?.name ?? defaultPlanName(document),
			origin: previousPresentation?.origin ?? "personal",
			updatedAt: previousPresentation?.updatedAt ?? new Date(0).toISOString(),
			revision: previousPresentation?.revision ?? 1,
			assumptions: previousPresentation?.assumptions ?? {
				inflation: 0,
				volatility: 0,
			},
			accounts: accountSidecars,
			movements: Object.fromEntries(
				document.postings.map((posting) => {
					const previous = previousPresentation?.movements[posting.id];
					const amount = postingAmountValue(posting, projection);
					return [
						posting.id,
						buildSidecarPosting(posting, amount, projectionStartDate, previous),
					];
				}),
			),
			provisionalFields: [...conversionReport.provisionalFields],
		},
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
		movements,
		goals,
		assumptions,
	};
	return {
		plan,
		sidecar,
		report: conversionReport,
		warnings: conversionReport.warnings,
		losses: conversionReport.losses,
	};
}

export function displayPlanToBackendDocument(
	plan: Plan,
	options: ReverseAdapterOptions = {},
): BackendDocumentConversion {
	const sidecar = options.sidecar ?? null;
	const sourceDocument = sidecar?.sourceDocument ?? null;
	const sourceAccounts = new Map(
		(sourceDocument?.accounts ?? []).map((account) => [account.id, account]),
	);
	const sourcePostings = new Map(
		(sourceDocument?.postings ?? []).map((posting) => [posting.id, posting]),
	);
	const conversionReport = report();
	const checkpointByAccount = new Map<string, BackendCheckpoint[]>();
	const accountSidecars = sidecar?.presentation.accounts ?? {};
	const movementSidecars = sidecar?.presentation.movements ?? {};
	const sourcePath =
		options.sourcePath ?? sourceDocument?.sourcePath ?? "frontend";
	const projectionStartDate = plan.startDate;

	const accounts = plan.accounts.map((account, index): BackendAccount => {
		const original = sourceAccounts.get(account.id);
		const metadata = accountSidecars[account.id];
		const sourceCheckpoint = original
			? latestCheckpoint(
					sourceDocument as FinancialModelDocument,
					account.id,
					sidecar?.projectionStartDate ?? plan.startDate,
				)
			: null;
		const floor =
			metadata && sameFloorValue(metadata.minBalance, account.floor)
				? metadata.minBalance
				: original && sameFloorValue(original.minBalance, account.floor)
					? original.minBalance
					: account.floor;
		const maxBalance =
			metadata && sameCeilingValue(metadata.maxBalance, account.ceiling)
				? metadata.maxBalance
				: original && sameCeilingValue(original.maxBalance, account.ceiling)
					? original.maxBalance
					: account.ceiling;
		const accountId = account.id;
		const sourceCheckpoints = (sourceDocument?.checkpoints ?? [])
			.filter((checkpoint) => checkpoint.AccountId === accountId)
			.map((checkpoint) => ({ ...checkpoint }));
		const sourceDisplayDate =
			sourceCheckpoint?.Date ?? sidecar?.projectionStartDate ?? plan.startDate;
		const displayObservationChanged =
			!original ||
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
			original &&
				sourceCheckpoint &&
				sourceCheckpoint.Date === account.observedOn &&
				sameNumber(sourceCheckpoint.Balance, account.balance),
		);
		if (
			sameCheckpoint ||
			(original && !sourceCheckpoint && !displayObservationChanged)
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
					source: "model",
				},
			]);
		} else {
			checkpointByAccount.set(accountId, [
				...sourceCheckpoints,
				{
					Date: account.observedOn || plan.startDate,
					AccountId: accountId,
					Balance: account.balance,
					source: "model",
				},
			]);
		}
		checkpointByAccount.set(
			accountId,
			[...(checkpointByAccount.get(accountId) ?? [])].sort((left, right) =>
				left.Date.localeCompare(right.Date),
			),
		);
		const previousKind =
			metadata?.kind ??
			accountKind(sourceCheckpoint?.Balance ?? account.balance);
		const previousProvenance =
			metadata?.provenance ?? (sourceCheckpoint ? "recorded" : "modeled");
		// A newly added account has no prior display state, so a difference from
		// the inferred default is not a lost value: the field is simply not
		// persisted and is re-inferred on the next load. Reporting it as a loss
		// made adding an account impossible on a server-backed plan.
		const hasPriorDisplayState = Boolean(metadata) || sourceCheckpoint !== null;
		if (hasPriorDisplayState && account.kind !== previousKind)
			lose(
				conversionReport,
				`accounts.${account.id}.kind`,
				"Display account kind has no backend account field.",
				`accounts.${index}.kind`,
			);
		if (hasPriorDisplayState && account.provenance !== previousProvenance)
			lose(
				conversionReport,
				`accounts.${account.id}.provenance`,
				"Display provenance is not a backend account field.",
				`accounts.${index}.provenance`,
			);
		if (metadata && account.source !== metadata.source)
			lose(
				conversionReport,
				`accounts.${account.id}.source`,
				"Display account source is not a backend account field.",
				`accounts.${index}.source`,
			);
		if (metadata && account.readOnly !== metadata.readOnly)
			lose(
				conversionReport,
				`accounts.${account.id}.readOnly`,
				"Display account read-only state is not a backend account field.",
				`accounts.${index}.readOnly`,
			);
		provisional(conversionReport, `accounts.${account.id}.kind`);
		provisional(conversionReport, `accounts.${account.id}.provenance`);
		provisional(conversionReport, `accounts.${account.id}.source`);
		provisional(conversionReport, `accounts.${account.id}.readOnly`);
		warn(
			conversionReport,
			"account-presentation-metadata",
			"Display account kind, return, provenance, source, and read-only state remain local presentation metadata.",
			`accounts.${index}`,
		);
		return {
			...(original ?? {}),
			id: account.id,
			label: account.name,
			minBalance: floor,
			maxBalance,
			color: metadata?.color ?? original?.color ?? null,
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
					checkpoint.AccountId === accountId &&
					checkpoint.source === "simplefin",
			) ?? false;
		const hasSyncPosting =
			sourceDocument?.postings.some(
				(posting) =>
					posting.source === "simplefin" &&
					(posting.sourceAccountId === accountId ||
						posting.destinations?.includes(accountId)),
			) ?? false;
		if (hasSyncCheckpoint || hasSyncPosting) {
			lose(
				conversionReport,
				`accounts.${accountId}`,
				"An account with a SimpleFIN-owned checkpoint or posting cannot be removed through the display plan.",
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

	const postings = plan.movements.map((movement, index): BackendPosting => {
		const metadata = movementSidecars[movement.id];
		const original = sourcePostings.get(movement.id);
		if (movement.id.startsWith("sfin-")) {
			lose(
				conversionReport,
				`movements.${movement.id}`,
				"Reserved SimpleFIN posting IDs cannot be created by the display plan.",
				`movements.${index}.id`,
			);
		}
		if (original?.source === "simplefin" && movement.readOnly !== true) {
			lose(
				conversionReport,
				`movements.${movement.id}.readOnly`,
				"SimpleFIN-owned postings cannot be edited through the display plan.",
				`movements.${index}.readOnly`,
			);
		}
		const originalAmountValue = original
			? postingAmountValue(original, null)
			: null;
		const baselineAmountValue = metadata?.amountValue ?? originalAmountValue;
		const sameAmount =
			baselineAmountValue !== null &&
			sameNumber(baselineAmountValue, movement.amount);
		const preservedAmount = metadata?.amount ?? original?.amount;
		const amount: PostingAmountResolution =
			movement.amountKnown === false
				? (preservedAmount ?? {
						resolver: "expression",
						config: { expression: String(movement.amount) },
						inputs: {},
					})
				: sameAmount && preservedAmount
					? preservedAmount
					: {
							resolver: "expression",
							config: { expression: String(movement.amount) },
							inputs: {},
						};
		if (movement.amountKnown === false && !preservedAmount) {
			lose(
				conversionReport,
				`movements.${movement.id}.amount`,
				"An unresolved backend amount cannot be represented in the display plan.",
				`movements.${index}.amount`,
			);
		}
		const previousDisplayFrequency =
			metadata?.displayFrequency ??
			(original ? displayFrequency(original.frequency) : undefined);
		const sameFrequency = previousDisplayFrequency === movement.frequency;
		const frequency = sameFrequency
			? (metadata?.frequency ??
				original?.frequency ??
				backendFrequency(movement.frequency))
			: backendFrequency(movement.frequency);
		const originalDestinations =
			metadata && Object.hasOwn(metadata, "destinations")
				? metadata.destinations
				: original?.destinations;
		const previousDisplayDestination =
			metadata?.displayToId ?? original?.destinations?.[0] ?? null;
		const sameDestination = previousDisplayDestination === movement.toId;
		const destinations =
			sameDestination && originalDestinations !== undefined
				? originalDestinations
				: movement.toId === null
					? null
					: [movement.toId];
		const previousDisplayAnnualIncrease =
			metadata?.displayAnnualIncrease ??
			(original ? original.annualGrowthRate * 100 : undefined);
		const sameGrowth =
			previousDisplayAnnualIncrease !== undefined &&
			sameNumber(previousDisplayAnnualIncrease, movement.annualIncrease);
		const annualGrowthRate = sameGrowth
			? (metadata?.annualGrowthRate ??
				original?.annualGrowthRate ??
				movement.annualIncrease / 100)
			: movement.annualIncrease / 100;
		const annualRate = metadata?.annualRate ?? original?.annualRate ?? 0;
		const volatility = metadata?.volatility ?? original?.volatility ?? 0;
		if (
			original &&
			originalDestinations &&
			originalDestinations.length > 1 &&
			JSON.stringify(originalDestinations) !== JSON.stringify(destinations)
		) {
			lose(
				conversionReport,
				`movements.${movement.id}.destinations`,
				"The display movement can represent only one destination from the original backend posting.",
				`movements.${index}.destinations`,
			);
		}
		const previousProvenance =
			metadata?.provenance ??
			(original ? postingProvenance(original, projectionStartDate) : "planned");
		const previousReadOnly =
			metadata?.readOnly ?? original?.source === "simplefin";
		if (movement.provenance !== previousProvenance)
			lose(
				conversionReport,
				`movements.${movement.id}.provenance`,
				"Display movement provenance is not a backend posting field.",
				`movements.${index}.provenance`,
			);
		if (movement.readOnly !== previousReadOnly)
			lose(
				conversionReport,
				`movements.${movement.id}.readOnly`,
				"Display movement read-only state is not a backend posting field.",
				`movements.${index}.readOnly`,
			);
		provisional(conversionReport, `movements.${movement.id}.provenance`);
		provisional(conversionReport, `movements.${movement.id}.readOnly`);
		warn(
			conversionReport,
			"movement-presentation-metadata",
			"Display movement provenance and read-only state remain local presentation metadata.",
			`movements.${index}`,
		);
		const source = metadata?.source ?? original?.source;
		return {
			...(original ?? {}),
			id: movement.id,
			label: movement.name,
			sourceAccountId: movement.fromId,
			destinations,
			amount,
			frequency,
			annualRate,
			annualGrowthRate,
			volatility,
			startDate: movement.startDate,
			endDate: movement.endDate,
			annualCap: metadata?.annualCap ?? original?.annualCap ?? null,
			priority: metadata?.priority ?? original?.priority ?? index + 1,
			enabled: movement.enabled,
			...(source === undefined ? {} : { source }),
		};
	});

	const removedPostingIDs = (sourceDocument?.postings ?? [])
		.filter((posting) => !plan.movements.some((item) => item.id === posting.id))
		.map((posting) => posting.id);
	for (const postingId of removedPostingIDs) {
		const original = sourcePostings.get(postingId);
		if (original?.source === "simplefin") {
			lose(
				conversionReport,
				`movements.${postingId}`,
				"SimpleFIN-owned postings cannot be removed through the display plan.",
				`movements.${postingId}`,
			);
		} else {
			warn(
				conversionReport,
				"posting-removed",
				"The backend posting will be removed from the canonical model.",
				`movements.${postingId}`,
			);
		}
	}

	const sourceEvaluations = sourceDocument?.evaluations;
	const financialIndependence = sourceEvaluations?.financialIndependence ?? [];
	const postingFulfillment = sourceEvaluations?.postingFulfillment ?? [];
	const netWorthThreshold = plan.goals
		.filter((goal) => goal.kind === "net-worth")
		.map((goal) => {
			const original = sourceEvaluations?.netWorthThreshold.find(
				(evaluation) => evaluation.instanceId === goal.id,
			);
			const originalConfig = original ? objectValue(original.config) : null;
			return {
				...(original ?? {}),
				instanceId: goal.id,
				label: goal.name,
				enabled: goal.enabled,
				config: {
					...(originalConfig ?? {}),
					target: goal.target,
				} satisfies JsonObject,
			};
		});
	const accountBalance = plan.goals
		.filter((goal) => goal.kind === "reserve")
		.map((goal) => {
			const original = sourceEvaluations?.accountBalance.find(
				(evaluation) => evaluation.instanceId === goal.id,
			);
			const originalConfig = original ? objectValue(original.config) : null;
			return {
				...(original ?? {}),
				instanceId: goal.id,
				label: goal.name,
				enabled: goal.enabled,
				config: {
					...(originalConfig ?? {}),
					accountId: goal.accountId,
					target: goal.target,
				} satisfies JsonObject,
			};
		});
	const removedBalanceIDs = (sourceEvaluations?.accountBalance ?? [])
		.filter(
			(evaluation) =>
				!plan.goals.some(
					(goal) =>
						goal.kind === "reserve" && goal.id === evaluation.instanceId,
				),
		)
		.map((evaluation) => evaluation.instanceId);
	for (const instanceId of removedBalanceIDs)
		lose(
			conversionReport,
			`evaluations.accountBalance.${instanceId}`,
			"The backend account balance goal is absent from the display plan and will not be uploaded.",
			`evaluations.accountBalance.${instanceId}`,
		);
	const removedThresholdIDs = (sourceEvaluations?.netWorthThreshold ?? [])
		.filter(
			(evaluation) =>
				!plan.goals.some(
					(goal) =>
						goal.kind === "net-worth" && goal.id === evaluation.instanceId,
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
	if (plan.goals.length !== netWorthThreshold.length + accountBalance.length) {
		lose(
			conversionReport,
			"goals",
			"One or more display goals could not be converted to a backend evaluation.",
			"goals",
		);
	}
	const previousAssumptions = sidecar?.presentation.assumptions ?? {
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
		"Display inflation and volatility assumptions remain local presentation metadata.",
		"assumptions",
	);
	const previousName =
		sidecar?.presentation.name ??
		(sourceDocument ? defaultPlanName(sourceDocument) : "Waypoint plan");
	const previousOrigin = sidecar?.presentation.origin ?? "personal";
	const previousUpdatedAt =
		sidecar?.presentation.updatedAt ?? new Date(0).toISOString();
	const previousRevision = sidecar?.presentation.revision ?? 1;
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
		"Plan name, origin, timestamp, revision, and read-only state remain local presentation metadata.",
		"plan",
	);

	const checkpoints = plan.accounts.flatMap(
		(account) => checkpointByAccount.get(account.id) ?? [],
	);
	const evaluations: EvaluationTables = {
		...(sourceEvaluations ?? {}),
		financialIndependence: [...financialIndependence],
		netWorthThreshold,
		accountBalance,
		postingFulfillment: [...postingFulfillment],
	};
	return {
		document: {
			...(sourceDocument ?? {}),
			sourcePath,
			accounts,
			checkpoints,
			evaluations,
			postings,
		},
		report: conversionReport,
		warnings: conversionReport.warnings,
		losses: conversionReport.losses,
	};
}
