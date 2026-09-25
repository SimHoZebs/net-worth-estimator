import { useRef, useState } from 'react';
import { Check, Download, FileJson, FileUp, HardDrive, Info, LockKeyhole, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { FinancialModelDocument, ServerStatus } from '../api/index.ts';
import * as errore from 'errore';
import type { Plan } from '../domain/model.ts';
import { payEvidence } from '../domain/evidence.ts';
import { dateLabel, money } from '../domain/format.ts';
import { download, ImportError, parsePlan, type Workspace } from '../state/storage.ts';
import { Badge, ErrorNotice, Modal } from '../components/ui.tsx';

type ImportCandidate =
  | { kind: 'plan'; document: Plan }
  | { kind: 'server'; document: FinancialModelDocument };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEvaluationTables(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.financialIndependence) && Array.isArray(value.netWorthThreshold) && Array.isArray(value.postingFulfillment);
}

function isFinancialModelDocument(value: unknown): value is FinancialModelDocument {
  if (!isRecord(value) || typeof value.sourcePath !== 'string' || !isEvaluationTables(value.evaluations)) return false;
  if (!Array.isArray(value.accounts) || !Array.isArray(value.checkpoints) || !Array.isArray(value.postings)) return false;
  const accountsValid = value.accounts.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.enabled === 'boolean');
  const checkpointsValid = value.checkpoints.every((item) => isRecord(item) && typeof item.Date === 'string' && typeof item.AccountId === 'string' && typeof item.Balance === 'number');
  const postingsValid = value.postings.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.enabled === 'boolean');
  return accountsValid && checkpointsValid && postingsValid;
}

export function SourcesPage({ plan, workspace, onReplace, serverMode = false, serverStatus = null, readOnly = workspace.saved.readOnly || Boolean(serverStatus?.readOnly), serverDocument = null, onImportServerDocument }: {
  plan: Plan;
  workspace: Workspace;
  onReplace: (plan: Plan) => boolean;
  serverMode?: boolean;
  serverStatus?: ServerStatus | null;
  readOnly?: boolean;
  serverDocument?: FinancialModelDocument | null;
  onImportServerDocument?: (document: FinancialModelDocument) => Promise<boolean>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const evidence = payEvidence(plan);
  const recorded = plan.accounts.filter((account) => account.provenance === 'recorded');
  const age = Math.floor((Date.now() - Date.parse(plan.startDate)) / 86400000);
  const sourceAccess = readOnly ? 'Read-only server' : serverStatus?.authEnabled ? 'Auth required' : serverMode ? 'Writable server' : 'Writable local copy';
  const serverAccountCount = serverDocument?.accounts.length ?? plan.accounts.length;
  const serverPostingCount = serverDocument?.postings.length ?? plan.movements.length;
  const planCandidate = candidate?.kind === 'plan' ? candidate.document : null;
  const serverCandidate = candidate?.kind === 'server' ? candidate.document : null;

  const exportPlan = () => {
    if (serverMode) {
      if (!serverDocument) {
        setError('The canonical server model is not available. Retry the server load before exporting.');
        return;
      }
      download({ name: 'waypoint-server-model.json', content: JSON.stringify(serverDocument, null, 2) });
      return;
    }
    download({ name: `waypoint-${workspace.draft ? 'temporary' : 'saved'}-plan.json`, content: JSON.stringify(plan, null, 2) });
  };

  const exportWorkspace = () => download({
    name: serverMode ? 'waypoint-local-recovery.json' : 'waypoint-workspace-backup.json',
    content: JSON.stringify(workspace, null, 2),
  });

  const onFile = async (file: File) => {
    setError(null);
    if (file.size > 2_000_000) {
      setError(serverMode ? 'The server model file is larger than 2 MB. Choose a smaller JSON file.' : 'The plan file is larger than 2 MB. Choose a smaller Waypoint JSON export.');
      return;
    }
    if (serverMode && readOnly) {
      setError('This server is read-only and cannot accept a model import.');
      return;
    }
    setReading(true);
    const text = await file.text().catch((cause) => new ImportError({ detail: 'The selected file could not be read.', cause }));
    setReading(false);
    if (text instanceof Error) {
      setError(text.message);
      return;
    }
    if (serverMode) {
      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        setError('The selected server model file is not valid JSON.');
        return;
      }
      if (!isFinancialModelDocument(value)) {
        setError('Choose a Waypoint server model JSON file with accounts, checkpoints, postings, and evaluations.');
        return;
      }
      setCandidate({ kind: 'server', document: value });
      return;
    }
    const parsed = parsePlan(text);
    if (parsed instanceof Error) {
      setError(parsed.message);
      return;
    }
    setCandidate({ kind: 'plan', document: parsed });
  };

  const applyPlan = () => {
    if (!planCandidate) return;
    const result = errore.try({ try: () => onReplace(planCandidate), catch: (cause) => new ImportError({ detail: 'The plan could not be applied.', cause }) });
    if (result instanceof Error) {
      setError(result.message);
      return;
    }
    if (result) setCandidate(null);
  };

  const importServerModel = async () => {
    if (!serverCandidate || !onImportServerDocument || readOnly || workspace.draft) return;
    setImporting(true);
    setError(null);
    try {
      const imported = await onImportServerDocument(serverCandidate);
      if (imported) {
        setCandidate(null);
      } else {
        setError('The server did not activate this model. Review the server response before trying again.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The server model could not be imported. The active model was not changed.');
    } finally {
      setImporting(false);
    }
  };

  return <>
    <section className="source-banner"><span className="source-banner-icon"><HardDrive size={25} /></span><div><h2>{serverMode ? 'Your canonical server model lives on the server.' : plan.origin === 'example' ? 'An example plan. A real workspace.' : 'Your plan stays in your browser.'}</h2><p>{serverMode ? 'Export the authoritative server document below. Temporary edits and workspace backups stay in this browser for recovery.' : plan.origin === 'example' ? 'All figures are illustrative. Explore freely, or import your own plan.' : 'This workspace uses local data. There is no bank connection or server synchronization.'}</p></div><Badge tone={serverMode ? 'outline' : 'green'}><LockKeyhole size={12} />{serverMode ? sourceAccess : 'Local only'}</Badge></section>
    {error && <ErrorNotice message={error} />}
    <div className="sources-grid">
      <section className="panel source-health">
        <div className="section-top"><h2>Data health</h2><ShieldCheck size={20} /></div>
        <dl className="detail-list">
          <div><dt>Source</dt><dd>{serverMode ? serverDocument ? serverDocument.sourcePath : 'Canonical server model unavailable' : plan.origin === 'example' ? 'Illustrative household' : 'User-provided plan'}</dd></div>
          <div><dt>{serverMode ? 'Display start' : 'Starting position'}</dt><dd>{dateLabel(plan.startDate, true)}{age > 30 && <Badge tone="amber">{age} days old</Badge>}</dd></div>
          <div><dt>{serverMode ? 'Display balance coverage' : 'Balance-check coverage'}</dt><dd>{recorded.length} of {serverAccountCount} accounts</dd></div>
          {serverMode && <div><dt>Server postings</dt><dd>{serverPostingCount}</dd></div>}
          <div><dt>{serverMode ? 'Display validation' : 'Validation'}</dt><dd className="inline-success"><Check size={15} />All structural checks passed</dd></div>
          <div><dt>{serverMode ? 'Display revision date' : 'Last local save'}</dt><dd>{dateLabel(workspace.saved.updatedAt, true)}</dd></div>
          <div><dt>{serverMode ? 'Display revision' : 'Saved revision'}</dt><dd>{workspace.saved.revision}</dd></div>
          <div><dt>Source access</dt><dd>{sourceAccess}</dd></div>
        </dl>
        <p className="section-note">Validation checks structure and references. It does not independently verify balances, bank provenance, or financial assumptions.</p>
      </section>
      <section className="panel portability">
        <h2>{serverMode ? 'Server model and local recovery' : 'Your data, on your terms'}</h2>
        <p>{serverMode ? 'Export the canonical server document. Browser drafts and workspace backups remain local recovery copies.' : 'Download a plan for safekeeping, or review a new one before replacing this workspace.'}</p>
        <button className="portability-action" onClick={exportPlan} disabled={serverMode && !serverDocument}><Download size={21} /><span><strong>{serverMode ? 'Export server model' : `Export ${workspace.draft ? 'temporary' : 'saved'} plan`}</strong><small>{serverMode ? 'Canonical FinancialModelDocument JSON' : 'Portable JSON · includes all plan records'}</small></span><span>↗</span></button>
        <button className="portability-action" onClick={() => inputRef.current?.click()} disabled={reading || importing || (serverMode && (readOnly || !onImportServerDocument))}><FileUp size={21} /><span><strong>{reading ? 'Reading your file…' : importing ? 'Importing model…' : serverMode ? 'Import server model' : 'Import a plan'}</strong><small>{serverMode ? 'Server model JSON · maximum 2 MB · explicit review before upload' : 'Waypoint JSON · maximum 2 MB · reviewed before applying'}</small></span><span>↗</span></button>
        <button className="text-button backup-button" onClick={exportWorkspace}><FileJson size={15} />{serverMode ? 'Download local recovery backup' : 'Download full workspace backup'}</button>
        <small className="muted">{serverMode ? 'Local recovery includes the display draft and comparison measures; it is not the canonical server model.' : 'Workspace backups include the saved plan, draft, and comparison measures. To import a plan, use a plan export.'}</small>
        <input className="sr-only" ref={inputRef} type="file" accept=".json,application/json" aria-label={serverMode ? 'Import Waypoint server model' : 'Import Waypoint plan'} onChange={(event) => { const file = event.target.files?.[0]; if (file) void onFile(file); event.target.value = ''; }} />
      </section>
    </div>
    <section className="panel provenance-panel"><div className="section-top"><div><h2>Behind the balances</h2><p>{serverMode ? 'Display view of the canonical server records.' : 'Every starting value has a basis.'}</p></div></div><div className="table-scroll"><table><thead><tr><th scope="col">Account</th><th scope="col">Source</th><th scope="col">As of</th><th scope="col">Basis</th><th scope="col">Balance</th></tr></thead><tbody>{plan.accounts.map((account) => <tr key={account.id}><th scope="row">{account.name}</th><td>{account.source}</td><td>{dateLabel(account.observedOn, true)}</td><td><Badge tone={account.provenance === 'recorded' ? 'green' : 'outline'}>{account.provenance}</Badge></td><td className="numeric">{money(account.balance)}</td></tr>)}</tbody></table></div></section>
    <section className="panel pay-evidence"><div className="section-top"><div><h2>What the income records suggest</h2><p>Posting-derived evidence · independent of planned income</p></div><Badge tone="amber">{evidence.strong ? 'Moderate evidence' : 'Limited evidence'}</Badge></div>{evidence.comparable.length ? <><div className="assumption-metrics"><div><span>Typical external inflow</span><strong>{money(evidence.typical)}</strong><p>Potential net pay; payer unverified</p></div><div><span>Observed cadence</span><strong>{evidence.monthly ? 'Monthly' : 'Unclear'}</strong><p>{evidence.comparable.length} comparable records of {evidence.candidates.length}</p></div><div><span>Annualized estimate</span><strong>{evidence.annualized === null ? 'Insufficient data' : money(evidence.annualized)}</strong><p>{evidence.annualized === null ? 'Cadence is not established' : 'Assumes this monthly cadence continues'}</p></div></div><details className="evidence-records"><summary>Inspect {evidence.candidates.length} supporting and excluded records</summary><div className="table-scroll"><table><thead><tr><th scope="col">Record</th><th scope="col">Date</th><th scope="col">Amount</th><th scope="col">Use</th></tr></thead><tbody>{evidence.candidates.map((movement) => <tr key={movement.id}><th scope="row">{movement.name}</th><td>{dateLabel(movement.startDate, true)}</td><td>{movement.amountKnown ? money(movement.amount) : 'Unavailable'}</td><td>{evidence.excluded.includes(movement) ? movement.enabled ? 'Excluded: differs by 20% or more' : 'Excluded: disabled' : 'Comparable'}</td></tr>)}</tbody></table></div></details></> : <p className="section-note">No recorded one-time external inflows are available. Add records in Plan to inspect income evidence.</p>}<div className="inline-notice"><Info size={18} /><span>These inflows may include non-payroll income. This inference does not establish gross salary or bank provenance and never changes {serverMode ? 'the canonical server model' : 'your plan'}. Fewer than six comparable records limit confidence.</span></div></section>
    {planCandidate && <Modal title="Review imported plan" eyebrow="Your current plan is still intact" onClose={() => setCandidate(null)}><div className="import-summary"><FileJson size={30} /><h3>{planCandidate.name}</h3><p>{planCandidate.accounts.length} accounts · {planCandidate.movements.length} movements · {planCandidate.goals.length} goals</p><p>Starts {dateLabel(planCandidate.startDate, true)} · {planCandidate.origin === 'example' ? 'Example data' : 'Personal data'}</p></div>{workspace.draft && <div className="inline-notice amber"><TriangleAlert size={18} />Save or discard your temporary version before importing another plan. Export is available now.</div>}<p className="section-note">Replacing this workspace removes its comparison snapshot. Download your current plan before continuing.</p><div className="modal-actions"><button className="button secondary" onClick={exportPlan}><Download size={16} />Export current plan</button><button className="button primary" disabled={Boolean(workspace.draft)} onClick={applyPlan}>Replace workspace</button></div></Modal>}
    {serverCandidate && <Modal title="Review server model import" eyebrow="The current server model remains unchanged" onClose={() => setCandidate(null)}><div className="import-summary"><FileJson size={30} /><h3>{serverCandidate.sourcePath.split('/').filter(Boolean).at(-1) || 'Waypoint model'}</h3><p>{serverCandidate.accounts.length} accounts · {serverCandidate.postings.length} postings · {serverCandidate.checkpoints.length} checkpoints</p><p>{serverCandidate.evaluations.financialIndependence.length + serverCandidate.evaluations.netWorthThreshold.length + serverCandidate.evaluations.postingFulfillment.length} evaluations</p></div><div className="inline-notice"><LockKeyhole size={18} /><span>The server validates the canonical accounts, checkpoints, postings, and evaluations before activation. The file is sent only after you confirm.</span></div>{workspace.draft && <div className="inline-notice amber"><TriangleAlert size={18} />Save or discard your temporary version before replacing the server model. The local recovery backup is available now.</div>}{!onImportServerDocument && <div className="inline-notice amber"><TriangleAlert size={18} />Server model import is unavailable in this view. Use the server recovery importer to restore a model.</div>}<div className="modal-actions"><button className="button secondary" onClick={exportPlan}><Download size={16} />Export current server model</button><button className="button primary" disabled={importing || readOnly || Boolean(workspace.draft) || !onImportServerDocument} onClick={() => { void importServerModel(); }}>{importing ? 'Importing…' : 'Import to server'}</button></div></Modal>}
  </>;
}
