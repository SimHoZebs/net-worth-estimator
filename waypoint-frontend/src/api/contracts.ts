export type IsoDate = string;
export type IsoDateTime = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonRecord = Record<string, JsonValue>;

export interface HumaLink {
  href: string;
  [key: string]: JsonValue | undefined;
}
export type HumaLinks = HumaLink[] | Record<string, HumaLink | HumaLink[] | undefined>;

export interface HumaMetadata {
  $schema?: string;
  links?: HumaLinks;
  _links?: HumaLinks;
}

export interface ProblemDetails extends HumaMetadata {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export type IsoDateOrNull = IsoDate | null;
export type OptionalString = string | null;

export const NO_FLOOR_SENTINEL = -10_000_000_000_000;
export const NO_CEILING_SENTINEL = 10_000_000_000_000;

export interface BackendAccount extends HumaMetadata {
  id: string;
  label: string;
  minBalance: number | null;
  maxBalance: number | null;
  color: string | null;
  enabled: boolean;
}
export type Account = BackendAccount;

export interface BackendCheckpoint extends HumaMetadata {
  Date: IsoDate;
  AccountId: string;
  Balance: number;
  source?: string;
}
export type Checkpoint = BackendCheckpoint;

export interface AmountInputBinding extends HumaMetadata {
  source: string;
  value?: JsonValue;
  provider?: string;
  arguments?: JsonObject;
}

export interface ExpressionAmountConfig extends JsonObject {
  expression: string;
}

export interface ExpressionPostingAmountResolution extends HumaMetadata {
  resolver: 'expression';
  config: ExpressionAmountConfig;
  inputs?: Record<string, AmountInputBinding> | null;
}

export interface OtherPostingAmountResolution extends HumaMetadata {
  resolver: string;
  config: JsonValue;
  inputs?: Record<string, AmountInputBinding> | null;
}

export type PostingAmountResolution = ExpressionPostingAmountResolution | OtherPostingAmountResolution;
export type AmountResolution = PostingAmountResolution;

export type PostingFrequency = 'once' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';

export interface BackendPosting extends HumaMetadata {
  id: string;
  label: string;
  sourceAccountId: string | null;
  destinations: string[] | null;
  amount: PostingAmountResolution;
  frequency: PostingFrequency;
  annualRate: number;
  annualGrowthRate: number;
  volatility: number;
  startDate: IsoDate;
  endDate: IsoDate | null;
  annualCap: number | null;
  priority: number;
  enabled: boolean;
  source?: string;
}
export type Posting = BackendPosting;

export type EvaluationConfig = JsonValue;
export type EvaluationResultPayload = JsonValue;
export type Link = HumaLink;
export type Links = HumaLinks;

export interface EvaluationInstance<TConfig extends EvaluationConfig = EvaluationConfig> extends HumaMetadata {
  instanceId: string;
  label: string;
  enabled: boolean;
  config: TConfig;
}

export type FinancialIndependenceConfig = EvaluationConfig;
export type NetWorthThresholdConfig = EvaluationConfig;
export type PostingFulfillmentConfig = EvaluationConfig;
export type FinancialIndependenceEvaluation = EvaluationInstance<FinancialIndependenceConfig>;
export type NetWorthThresholdEvaluation = EvaluationInstance<NetWorthThresholdConfig>;
export type PostingFulfillmentEvaluation = EvaluationInstance<PostingFulfillmentConfig>;

export interface EvaluationTables extends HumaMetadata {
  financialIndependence: FinancialIndependenceEvaluation[];
  netWorthThreshold: NetWorthThresholdEvaluation[];
  postingFulfillment: PostingFulfillmentEvaluation[];
}

export interface FinancialModelDocument extends HumaMetadata {
  sourcePath: string;
  accounts: BackendAccount[];
  checkpoints: BackendCheckpoint[];
  evaluations: EvaluationTables;
  postings: BackendPosting[];
}

export interface ModelOverrides extends HumaMetadata {
  addedAccounts: BackendAccount[];
  addedPostings: BackendPosting[];
  disabledAccountIds: string[];
  disabledPostingIds: string[];
}

export interface ProjectionRuntimeSettings extends HumaMetadata {
  fallbackProjectionStartDate: IsoDate;
  horizonYears: number;
  evaluations: EvaluationTables;
}

export interface IncomeSourceDefinition extends HumaMetadata {
  id: string;
  label: string;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  annualGrossIncome: number;
}

export interface IncomeTaxBracket extends HumaMetadata {
  upTo: number | null;
  rate: number;
}

export interface IncomeTaxProfile extends HumaMetadata {
  id: string;
  label: string;
  deduction: number;
  brackets: IncomeTaxBracket[];
  sourceUrl: string | null;
}

export interface IncomeDataSnapshot extends HumaMetadata {
  incomeSources: IncomeSourceDefinition[];
  taxProfiles: IncomeTaxProfile[];
}

export interface ModelValidationIssue extends HumaMetadata {
  severity: 'error' | 'warning' | string;
  code: string;
  message: string;
  path: JsonValue[];
}

export interface AccountDelta {
  postingId: string;
  delta: number;
}

export interface CheckpointCorrection {
  accountId: string;
  observedBalance: number;
  modeledBalance: number;
  adjustment: number;
}

export interface AccountSnapshot {
  accountId: string;
  date: IsoDate;
  balance: number;
  impacts: AccountDelta[];
}

export interface ProjectionRow {
  date: IsoDate;
  isHistorical: boolean;
  netWorth: number;
  accountSnapshots: AccountSnapshot[];
  externalInflowAmount: number;
  externalOutflowAmount: number;
  internalTransferAmount: number;
  checkpointCorrections: CheckpointCorrection[];
}

export interface ProjectionAccountSummary {
  accountId: string;
  label: string;
  color: string | null;
  enabled: boolean;
  startingBalance: number;
  endingBalance: number;
}

export interface MovementOrigin {
  type: string;
  postingId: string;
}

export interface MovementAccountDelta {
  accountId: string;
  delta: number;
}

export interface IncomeResolverEvent {
  resolver: string;
  requestedAmount: number;
  realizedAmount: number;
  destinationAccountId: string | null;
  taxableAmountAfter: number;
  employerMatchAmount: number;
  employerMatchRealizedAmount: number;
}

export interface IncomeEvent {
  annualGrossIncome: number;
  grossAmount: number;
  resolvers: IncomeResolverEvent[];
  netCashRequested: number;
  netCashRealized: number;
  employerMatchRequested: number;
  employerMatchRealized: number;
}

export interface MovementEvent {
  date: IsoDate;
  sequence: number;
  origin: MovementOrigin;
  requestedAmount: number;
  realizedAmount: number;
  accountDeltas: MovementAccountDelta[] | null;
  income?: IncomeEvent;
}

export interface ProjectionTimeline {
  rows: ProjectionRow[];
}

export interface ProjectionTotals {
  externalInflowAmount: number;
  externalOutflowAmount: number;
  internalTransferAmount: number;
}

export interface ProjectionMilestones {
  latestHistoricalDate: IsoDate | null;
  projectionStartDate: IsoDate;
}

export interface ProjectionSummary {
  currentNetWorth: number;
  finalNetWorth: number;
}

export type EvaluationResultStatus = 'satisfied' | 'not-satisfied' | 'warning' | 'indeterminate' | string;

export interface EvaluationDiagnostic {
  code: string;
  severity: string;
  message: string;
  date?: IsoDate;
  relatedAccountIds?: string[];
  relatedPostingIds?: string[];
}

export interface EvaluationResultEnvelope extends HumaMetadata {
  instanceId: string;
  label: string;
  status: EvaluationResultStatus;
  deterministic: EvaluationResultPayload;
  probabilistic: EvaluationResultPayload;
  diagnostics: EvaluationDiagnostic[];
}

export interface EvaluationResultTables extends HumaMetadata {
  financialIndependence: EvaluationResultEnvelope[];
  netWorthThreshold: EvaluationResultEnvelope[];
  postingFulfillment: EvaluationResultEnvelope[];
}

export interface ProjectionResult extends HumaMetadata {
  timeline: ProjectionTimeline;
  accountSummaries: ProjectionAccountSummary[];
  totals: ProjectionTotals;
  milestones: ProjectionMilestones;
  summary: ProjectionSummary;
  evaluations: EvaluationResultTables;
  movementEvents?: MovementEvent[];
}

export interface DeterministicProjectionRequest extends HumaMetadata {
  document?: FinancialModelDocument | null;
  overrides?: ModelOverrides;
  settings: ProjectionRuntimeSettings;
  incomeData?: IncomeDataSnapshot | null;
}

export interface DeterministicProjectionResponse extends HumaMetadata {
  result?: ProjectionResult | null;
  issues?: ModelValidationIssue[];
  error?: string;
}

export type ProjectionRequest = DeterministicProjectionRequest;
export type ProjectionRequestBody = DeterministicProjectionRequest;
export type ProjectionResponse = DeterministicProjectionResponse;

export interface PercentileBands {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface StochasticConfig {
  runCount: number;
  seed: number | null;
}

export interface StochasticBandRow {
  date: IsoDate;
  isHistorical: boolean;
  netWorth: PercentileBands;
}

export type StochasticProgressPhase = 'preparing' | 'deterministic-evaluations' | 'stochastic-runs' | string;

export interface StochasticEvaluationWorkload {
  type: string;
  instanceId: string;
  label: string;
  completedUnits: number;
  totalUnits: number;
  unitLabel: string;
  unitAction: string;
  intensiveUnitsCompleted?: number;
  intensiveUnitLabel?: string;
  intensiveUnitAction?: string;
  description?: string;
}

export interface StochasticProgress {
  phase: StochasticProgressPhase;
  completedRuns: number;
  totalRuns: number;
  fraction: number;
  evaluationWorkloads: StochasticEvaluationWorkload[];
}

export interface StochasticProjectionResult extends HumaMetadata {
  config: StochasticConfig;
  bands: StochasticBandRow[];
  milestones: {
    finalNetWorthPercentiles: PercentileBands;
  };
  evaluations: EvaluationResultTables;
}

export interface StochasticProjectionRequest extends DeterministicProjectionRequest {
  config: StochasticConfig;
}

export interface StochasticProjectionResponse extends HumaMetadata {
  result?: StochasticProjectionResult | null;
  issues?: ModelValidationIssue[];
  error?: string;
}

export type StochasticRequest = StochasticProjectionRequest;
export type StochasticRequestBody = StochasticProjectionRequest;
export type StochasticResponse = StochasticProjectionResponse;

export interface ServerStatus extends HumaMetadata {
  readOnly: boolean;
  authEnabled: boolean;
}

export type StatusResponse = ServerStatus;

export interface FinancialModelResponse extends HumaMetadata {
  document: FinancialModelDocument | null;
  issues: ModelValidationIssue[];
  revision?: string;
}

export type ModelResponse = FinancialModelResponse;

export interface SimpleFINSummary extends HumaMetadata {
  checkpointsInserted: number;
  checkpointsUpdated: number;
  checkpointsSkipped: number;
  pendingDeleted: number;
  pendingInserted: number;
  skipped: Record<string, number>;
  dryRun: boolean;
}

export type SimpleFinSummary = SimpleFINSummary;

export interface ProgressSSEData {
  progress: StochasticProgress;
}

export interface PartialSSEData {
  progress: StochasticProgress;
  partial: StochasticProjectionResult;
}

export interface ResultSSEData {
  result: StochasticProjectionResult;
}

export interface ErrorSSEData {
  error: string;
}

export type StochasticSSEData = ProgressSSEData | PartialSSEData | ResultSSEData | ErrorSSEData;
