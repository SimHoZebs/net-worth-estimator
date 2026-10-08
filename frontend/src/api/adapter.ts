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

export interface AccountPresentation {
	balanceCheck: boolean;
	source: string;
	readOnly: boolean;
	enabled: boolean;
	minBalance: number | null;
	maxBalance: number | null;
	observedOn: IsoDate;
}

export interface MovementPresentation {
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

	readOnly: boolean;
	displayFrequency?: Movement["frequency"];
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
	movements: Record<string, MovementPresentation>;
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
	status: ServerStatus,
	previous: AccountPresentation | undefined,
	syncCheckpoint: boolean,
	archived: boolean,
): Account {
	const minBalance = boundValue(account.minBalance, NO_FLOOR_SENTINEL);
	const maxBalance = boundValue(account.maxBalance, NO_CEILING_SENTINEL);
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
	previous?: MovementPresentation,
): Movement {
	const destinations = posting.destinations ?? [];
	const firstDestination = destinations[0] ?? null;
	return {
		id: posting.id,
		name: posting.name || posting.id,
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
			"This transaction amount has no fixed number and is shown as unavailable.",
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
			"The display transaction frequency is approximated as monthly.",
			`${path}.frequency`,
		);
		provisional(target, `${path}.frequency`);
	}
	if ((posting.destinations?.length ?? 0) > 1) {
		warn(
			target,
			"multiple-destinations",
			"The display movement can show one destination; additional backend destinations remain in the presentation state.",
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
			"Backend annual rate, volatility, and annual cap are preserved as presentation state.",
			path,
		);
		provisional(target, `${path}.metadata`);
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
	checkpoint: BackendCheckpoint | null,
	observedOn: IsoDate,
	status: ServerStatus,
	previous?: AccountPresentation,
): AccountPresentation {
	return {
		balanceCheck: previous?.balanceCheck ?? Boolean(checkpoint),
		source:
			previous?.source ??
			(checkpoint?.source === "simplefin"
				? "SimpleFIN checkpoint"
				: checkpoint
					? "Backend checkpoint"
					: "Backend account"),
		readOnly: previous?.readOnly ?? status.readOnly,
		enabled: account.enabled,
		minBalance: account.minBalance,
		maxBalance: account.maxBalance,
		observedOn,
	};
}

function buildPresentationPosting(
	posting: BackendPosting,
	amount: number | null,
	previous?: MovementPresentation,
): MovementPresentation {
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
		...(posting.source === undefined && previous?.source === undefined
			? {}
			: { source: previous?.source ?? posting.source }),
		amount: presentationAmount,
		amountValue: previousAmountMatches
			? (previous?.amountValue ?? amount)
			: (amount ?? previous?.amountValue),
		destinations: presentationDestinations,
		frequency: previous?.frequency ?? posting.frequency,
		annualRate: previous?.annualRate ?? posting.annualRate,
		annualGrowthRate: previous?.annualGrowthRate ?? posting.annualGrowthRate,
		volatility: previous?.volatility ?? posting.volatility,
		annualCap: previous?.annualCap ?? posting.annualCap,
		priority: previous?.priority ?? posting.priority,
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
	const previousPresentation = input.presentation ?? null;
	const conversionReport = report();
	const accountPresentations: Record<string, AccountPresentation> = {};
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
		const archived = isArchivedDebt(account, document, projectionStartDate);
		const display = accountDisplay(
			account,
			checkpoint,
			observedOn,
			status,
			previous,
			syncCheckpoint,
			archived,
		);
		accountPresentations[account.id] = buildPresentationAccount(
			account,
			checkpoint,
			observedOn,
			status,
			previous,
		);
		addForwardAccountWarnings(conversionReport, account, checkpoint, path);
		return display;
	});

	const movements = document.postings.map((posting, index) => {
		const path = `movements.${index}`;
		const amount = postingAmountValue(posting, projection);
		const previous = previousPresentation?.movements[posting.id];
		addForwardPostingWarnings(conversionReport, posting, amount, path);
		return movementDisplay(posting, amount, previous);
	});

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
			"Financial-independence, posting-fulfillment, and cycle-fulfillment evaluations are listed with the editable evaluations and are read-only in this workspace.",
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
		movements: Object.fromEntries(
			document.postings.map((posting) => {
				const previous = previousPresentation?.movements[posting.id];
				const amount = postingAmountValue(posting, projection);
				return [
					posting.id,
					buildPresentationPosting(posting, amount, previous),
				];
			}),
		),
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
	const conversionReport = report();
	const checkpointByAccount = new Map<string, BackendCheckpoint[]>();
	const accountPresentations = options.presentation?.accounts ?? {};
	const movementPresentations = options.presentation?.movements ?? {};
	const sourcePath =
		options.sourcePath ?? sourceDocument?.sourcePath ?? "frontend";

	const accounts = plan.accounts.map((account, index): BackendAccount => {
		const storedAccount = sourceAccounts.get(account.id);
		const storedExtras = accountPresentations[account.id];
		const sourceCheckpoint = storedAccount
			? latestCheckpoint(
					sourceDocument as FinancialModelDocument,
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
			"Whether a balance is confirmed, its source, and its read-only state stay local and are not imported.",
			`accounts.${index}`,
		);
		return {
			...(storedAccount ?? {}),
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
		const storedExtras = movementPresentations[movement.id];
		const storedPosting = sourcePostings.get(movement.id);
		if (movement.id.startsWith("sfin-")) {
			lose(
				conversionReport,
				`movements.${movement.id}`,
				"Reserved SimpleFIN posting IDs cannot be created by the display plan.",
				`movements.${index}.id`,
			);
		}
		if (storedPosting?.source === "simplefin" && movement.readOnly !== true) {
			lose(
				conversionReport,
				`movements.${movement.id}.readOnly`,
				"SimpleFIN-owned postings cannot be edited through the display plan.",
				`movements.${index}.readOnly`,
			);
		}
		const originalAmountValue = storedPosting
			? postingAmountValue(storedPosting, null)
			: null;
		const baselineAmountValue =
			storedExtras?.amountValue ?? originalAmountValue;
		const sameAmount =
			baselineAmountValue !== null &&
			sameNumber(baselineAmountValue, movement.amount);
		const preservedAmount = storedExtras?.amount ?? storedPosting?.amount;
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
			storedExtras?.displayFrequency ??
			(storedPosting ? displayFrequency(storedPosting.frequency) : undefined);
		const sameFrequency = previousDisplayFrequency === movement.frequency;
		const frequency = sameFrequency
			? (storedExtras?.frequency ??
				storedPosting?.frequency ??
				backendFrequency(movement.frequency))
			: backendFrequency(movement.frequency);
		const originalDestinations =
			storedExtras && Object.hasOwn(storedExtras, "destinations")
				? storedExtras.destinations
				: storedPosting?.destinations;
		const previousDisplayDestination =
			storedExtras?.displayToId ?? storedPosting?.destinations?.[0] ?? null;
		const sameDestination = previousDisplayDestination === movement.toId;
		const destinations =
			sameDestination && originalDestinations !== undefined
				? originalDestinations
				: movement.toId === null
					? null
					: [movement.toId];
		const previousDisplayAnnualIncrease =
			storedExtras?.displayAnnualIncrease ??
			(storedPosting ? storedPosting.annualGrowthRate * 100 : undefined);
		const sameGrowth =
			previousDisplayAnnualIncrease !== undefined &&
			sameNumber(previousDisplayAnnualIncrease, movement.annualIncrease);
		const annualGrowthRate = sameGrowth
			? (storedExtras?.annualGrowthRate ??
				storedPosting?.annualGrowthRate ??
				movement.annualIncrease / 100)
			: movement.annualIncrease / 100;
		const annualRate =
			storedExtras?.annualRate ?? storedPosting?.annualRate ?? 0;
		const volatility =
			storedExtras?.volatility ?? storedPosting?.volatility ?? 0;
		if (
			storedPosting &&
			originalDestinations &&
			originalDestinations.length > 1 &&
			JSON.stringify(originalDestinations) !== JSON.stringify(destinations)
		) {
			lose(
				conversionReport,
				`movements.${movement.id}.destinations`,
				"The display movement can represent only one destination from the storedPosting backend posting.",
				`movements.${index}.destinations`,
			);
		}
		const previousReadOnly =
			storedExtras?.readOnly ?? storedPosting?.source === "simplefin";
		if (movement.readOnly !== previousReadOnly)
			lose(
				conversionReport,
				`movements.${movement.id}.readOnly`,
				"Display movement read-only state is not a backend posting field.",
				`movements.${index}.readOnly`,
			);
		provisional(conversionReport, `movements.${movement.id}.readOnly`);
		warn(
			conversionReport,
			"movement-presentation-storedExtras",
			"Transaction read-only state stays local and is not imported.",
			`movements.${index}`,
		);
		const source = storedExtras?.source ?? storedPosting?.source;
		return {
			...(storedPosting ?? {}),
			id: movement.id,
			name: movement.name,
			sourceAccountId: movement.fromId,
			destinations,
			amount,
			frequency,
			annualRate,
			annualGrowthRate,
			volatility,
			startDate: movement.startDate,
			endDate: movement.endDate,
			annualCap: storedExtras?.annualCap ?? storedPosting?.annualCap ?? null,
			priority: storedExtras?.priority ?? storedPosting?.priority ?? index + 1,
			enabled: movement.enabled,
			...(source === undefined ? {} : { source }),
		};
	});

	const removedPostingIDs = (sourceDocument?.postings ?? [])
		.filter((posting) => !plan.movements.some((item) => item.id === posting.id))
		.map((posting) => posting.id);
	for (const postingId of removedPostingIDs) {
		const storedPosting = sourcePostings.get(postingId);
		if (storedPosting?.source === "simplefin") {
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
				"The backend deposit will be removed from the canonical model.",
				`movements.${postingId}`,
			);
		}
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
				...(storedEvaluation ?? {}),
				instanceId: evaluation.id,
				name: evaluation.name,
				enabled: evaluation.enabled,
				config: {
					...(storedConfig ?? {}),
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
				...(storedEvaluation ?? {}),
				instanceId: evaluation.id,
				name: evaluation.name,
				enabled: evaluation.enabled,
				config: {
					...(storedConfig ?? {}),
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
		(sourceDocument ? defaultPlanName(sourceDocument) : "Waypoint plan");
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
		...(sourceEvaluations ?? {}),
		financialIndependence: [...financialIndependence],
		netWorthThreshold,
		accountBalance,
		postingFulfillment: [...postingFulfillment],
		cycleFulfillment: [...cycleFulfillment],
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
