import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Compass, Flag, GitBranch, GitCompareArrows, HardDrive, LayoutDashboard, LockKeyhole, Menu, PanelLeftClose, RotateCcw, ShieldCheck, Wallet, X } from 'lucide-react';
import type { FinancialModelDocument, ServerStatus } from './api/index.ts';
import { changesBetween, type Plan } from './domain/model.ts';
import type { Projection, RangeResult } from './domain/projection.ts';
import { download } from './state/storage.ts';
import type { Snapshot, Workspace } from './state/storage.ts';
import { ErrorNotice, IconButton, Modal } from './components/ui.tsx';
import { EvidenceDialog, type EvidenceTarget } from './components/EvidenceDialog.tsx';
import { PlanEditor, type EditorTarget } from './components/PlanEditor.tsx';
import { Outlook } from './pages/Outlook.tsx';
import { PlanPage } from './pages/PlanPage.tsx';
import { GoalsPage } from './pages/GoalsPage.tsx';
import { ComparePage } from './pages/ComparePage.tsx';
import { SourcesPage } from './pages/SourcesPage.tsx';

type Page = 'outlook' | 'plan' | 'goals' | 'compare' | 'sources';

const pages: { id: Page; label: string; icon: typeof Compass; title: string; subtitle: string }[] = [
  { id: 'outlook', label: 'Outlook', icon: LayoutDashboard, title: 'Your financial outlook', subtitle: 'A little clarity for the road ahead.' },
  { id: 'plan', label: 'Your plan', icon: Wallet, title: 'The plan behind the picture', subtitle: 'The accounts, movements, and assumptions that shape your future.' },
  { id: 'goals', label: 'Goals', icon: Flag, title: 'Make the future meaningful', subtitle: 'Know where you’re headed, and what it takes to get there.' },
  { id: 'compare', label: 'Compare', icon: GitCompareArrows, title: 'Small changes. Clearer choices.', subtitle: 'See the consequence before you commit.' },
  { id: 'sources', label: 'Data & sources', icon: HardDrive, title: 'Confidence starts at the source', subtitle: 'Know what’s recorded, what’s assumed, and what needs a closer look.' },
];

const getPage = (): Page => pages.find((page) => page.id === window.location.hash.slice(1))?.id ?? 'outlook';

type WorkspaceController = {
  error: string | null;
  notice: string;
  volatile: boolean;
  updatePlan: (next: Plan) => boolean;
  save: () => boolean | Promise<boolean>;
  discard: () => boolean | Promise<boolean>;
  reloadDraft: () => Promise<boolean>;
  replace: (next: Plan) => boolean;
  capture: (snapshot: Snapshot) => void;
  retry: () => unknown;
  dismissNotice: () => void;
};

type ProjectionState = {
  base: Projection | Error | null;
  range: RangeResult | null;
  progress: number;
  rangeError: string | null;
  loading: boolean;
  retryRange: () => void;
  retryProjection: () => void;
};

export function WorkspaceShell({ workspace, plan, state, projection, savedProjection, years, setYears, ranges, setRanges, serverMode = false, serverStatus = null, serverDocument = null, onImportServerDocument, readOnly = false, authRequired = false, authTokenActive = false, authControl, loading = false, retrySavedProjection }: {
  workspace: Workspace;
  plan: Plan;
  state: WorkspaceController;
  projection: ProjectionState;
  savedProjection: Projection | Error | null;
  years: number;
  setYears: (years: number) => void;
  ranges: boolean;
  setRanges: (ranges: boolean) => void;
  serverMode?: boolean;
  serverStatus?: ServerStatus | null;
  serverDocument?: FinancialModelDocument | null;
  onImportServerDocument?: (document: FinancialModelDocument) => Promise<boolean>;
  readOnly?: boolean;
  authRequired?: boolean;
  authTokenActive?: boolean;
  authControl?: ReactNode;
  loading?: boolean;
  retrySavedProjection: () => void;
}) {
  const [page, setPage] = useState<Page>(getPage);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(() => window.innerWidth <= 800);
  const sidebarRef = useRef<HTMLElement>(null);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [returnToAccount, setReturnToAccount] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<EvidenceTarget | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const changes = changesBetween({ saved: workspace.saved, current: plan });
  const currentPage = pages.find((item) => item.id === page) ?? pages[0]!;
  const sourceReadOnly = readOnly || workspace.saved.readOnly;

  useEffect(() => {
    const onHash = () => { setPage(getPage()); setMobileOpen(false); requestAnimationFrame(() => headingRef.current?.focus()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { document.title = `${currentPage.label} · Waypoint`; }, [currentPage.label]);
  useEffect(() => {
    if (!state.volatile) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [state.volatile]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const update = () => { setMobileLayout(media.matches); if (!media.matches) setMobileOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement;
    sidebarRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const elements = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') ?? []);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous instanceof HTMLElement) previous.focus(); };
  }, [mobileOpen]);

  const navigate = (next: Page) => { window.location.hash = next; setPage(next); setMobileOpen(false); };
  const tryChange = () => setEditor({ kind: 'movement', item: plan.movements.find((movement) => movement.id === 'invest' && movement.enabled && !movement.readOnly && movement.provenance === 'planned') ?? plan.movements.find((movement) => movement.enabled && !movement.readOnly && movement.provenance === 'planned') ?? null });
  const editFromEvidence = (target: EditorTarget) => {
    setReturnToAccount(evidence?.kind === 'account' ? evidence.id : null);
    setEditor(target);
  };
  const closeEditor = () => {
    setEditor(null);
    if (returnToAccount) setEvidence({ kind: 'account', id: returnToAccount });
    setReturnToAccount(null);
  };
  const confirmDiscard = async () => {
    if (discarding) return;
    setDiscarding(true);
    try {
      if (await state.discard()) setDiscardOpen(false);
    } finally {
      setDiscarding(false);
    }
  };
  const statusLabel = !serverMode ? 'Local workspace' : sourceReadOnly ? 'Server read-only' : authTokenActive ? 'Server · token in memory' : authRequired ? 'Auth required' : 'Server workspace';

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    {mobileOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebarRef} className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} inert={mobileLayout && !mobileOpen} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen ? true : undefined} aria-label="Workspace navigation">
      <div className="brand-row"><WaypointBrand /><IconButton icon={PanelLeftClose} label="Close navigation" className="mobile-only" onClick={() => setMobileOpen(false)} /></div>
      <button className="household-select" onClick={() => navigate('sources')}><span className="household-avatar">H</span><span><strong>{plan.name}</strong><small>{serverMode ? 'Server household' : 'Personal workspace'}</small></span><ChevronDown size={14} /></button>
      <span className="nav-label">YOUR BIG PICTURE</span>
      <nav aria-label="Main navigation"><ul>{pages.filter((item) => item.id !== 'sources').map((item) => <li key={item.id}><a className={page === item.id ? 'nav-link active' : 'nav-link'} href={`#${item.id}`} aria-current={page === item.id ? 'page' : undefined}><item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{item.id === 'compare' && changes.length > 0 && <span className="nav-count">{changes.length}</span>}</a></li>)}</ul></nav>
      <div className="sidebar-bottom"><div className="local-card"><span className="local-icon"><ShieldCheck size={20} strokeWidth={1.5} /></span><strong>A little more peace of mind.</strong><p>{serverMode ? 'Your canonical server model lives on the server. Temporary edits stay in this browser until you save.' : 'Your plan stays on this device. Your decisions stay yours.'}</p><button className="text-button" onClick={() => setEvidence({ kind: 'method' })}>How it works <ArrowUpRight size={14} /></button></div><a className={`nav-link ${page === 'sources' ? 'active' : ''}`} href="#sources" aria-current={page === 'sources' ? 'page' : undefined}><HardDrive size={19} strokeWidth={1.7} /><span>Data & sources</span></a><button className="nav-link help-link" onClick={() => setEvidence({ kind: 'method' })}><CircleHelp size={19} strokeWidth={1.7} /><span>A guide to your outlook</span></button><div className="sidebar-status"><span className="status-dot" />{statusLabel} <LockKeyhole size={12} /></div></div>
    </aside>
    <div className="workspace" inert={mobileOpen}>
      <header className="topbar"><div className="breadcrumb"><IconButton icon={Menu} label="Open navigation" className="mobile-only" onClick={() => setMobileOpen(true)} /><span className="desktop-only">Your household</span><span className="breadcrumb-slash desktop-only">/</span><strong>{currentPage.label}</strong></div><div className="topbar-status">{plan.origin === 'example' && <button className="example-pill" onClick={() => navigate('sources')}>Example plan <ArrowUpRight size={12} /></button>}{loading ? <span className="saved-indicator"><span className="spinner" aria-hidden="true" />Updating server</span> : <span className={`saved-indicator ${changes.length ? 'draft-indicator' : ''}`}>{changes.length ? <GitBranch size={14} /> : <Check size={14} />}{changes.length ? 'Temporary version' : serverMode ? 'Saved server plan' : 'Saved plan'}</span>}<span className="profile-avatar" aria-label="Household workspace">H</span></div></header>
      <main id="main-content" className="main-content">
        <div className="page-heading"><div><div className="eyebrow">PLAN WITH PERSPECTIVE</div><h1 ref={headingRef} tabIndex={-1}>{currentPage.title}</h1><p>{currentPage.subtitle}</p></div>{page !== 'sources' && <button className="button primary try-change" onClick={tryChange}><GitBranch size={17} />Try a change <ArrowUpRight size={16} /></button>}</div>
         {state.error && <ErrorNotice message={state.error} action={state.error.includes('stale') ? 'Discard draft and load latest' : state.error.includes('another tab') ? 'Reload latest saved plan' : serverMode ? 'Retry server request' : 'Retry browser save'} onAction={() => state.error?.includes('stale') ? void state.reloadDraft() : state.error?.includes('another tab') ? window.location.reload() : state.retry()} />}
        {authControl}
         {state.volatile && <button className="button secondary export-recovery" onClick={() => download({ name: 'waypoint-recovery.json', content: JSON.stringify(plan, null, 2) })}>{serverMode ? 'Export local draft recovery' : 'Export work before leaving'}</button>}
        {sourceReadOnly && <div className="inline-notice"><LockKeyhole size={17} />{serverMode ? 'This server is read-only. You can test changes and export a copy; the saved server model cannot be replaced.' : 'This source is read-only. You can test changes and export a copy; the saved source cannot be edited.'}</div>}
        {projection.base === null ? <ProjectionLoading onRetry={projection.retryProjection} /> : projection.base instanceof Error ? <ErrorNotice message={projection.base.message} action={serverMode ? 'Retry server calculation' : 'Inspect assumptions'} onAction={serverMode ? projection.retryProjection : () => setEditor({ kind: 'assumptions' })} /> : <>
          {projection.rangeError && ranges && <ErrorNotice message={projection.rangeError} action="Retry scenario calculation" onAction={projection.retryRange} />}
          {page === 'outlook' && <Outlook plan={plan} projection={projection.base} range={projection.range} ranges={ranges} setRanges={setRanges} years={years} setYears={setYears} progress={projection.progress} rangeError={projection.rangeError} onEvidence={() => setEvidence({ kind: 'position' })} onFailure={() => setEvidence({ kind: 'failure' })} onAccount={(account) => setEvidence({ kind: 'account', id: account.id })} onPlan={() => navigate('plan')} onGoals={() => navigate('goals')} onGoal={(id) => setEvidence({ kind: 'goal', id })} onTiming={() => setEvidence({ kind: 'timing' })} onAssumptions={() => setEditor({ kind: 'assumptions' })} />}
          {page === 'plan' && <PlanPage plan={plan} onEdit={setEditor} onUpdate={state.updatePlan} onAccount={(id) => setEvidence({ kind: 'account', id })} />}
          {page === 'goals' && <GoalsPage plan={plan} projection={projection.base} range={projection.range} onEdit={(item) => setEditor({ kind: 'goal', item })} onUpdate={state.updatePlan} onEvidence={(id) => setEvidence({ kind: 'goal', id })} />}
          {page === 'compare' && !savedProjection && <ProjectionLoading label="Loading the saved server comparison" onRetry={retrySavedProjection} />}
          {page === 'compare' && savedProjection instanceof Error && <ErrorNotice message={savedProjection.message} action="Retry saved server calculation" onAction={retrySavedProjection} />}
          {page === 'compare' && savedProjection && !(savedProjection instanceof Error) && <ComparePage saved={workspace.saved} plan={plan} projection={projection.base} savedProjection={savedProjection} snapshot={workspace.snapshot} years={years} serverMode={serverMode} readOnly={sourceReadOnly} onCapture={state.capture} onSave={() => Promise.resolve(state.save())} onDiscard={() => setDiscardOpen(true)} />}
           {page === 'sources' && <SourcesPage plan={plan} workspace={workspace} onReplace={state.replace} serverMode={serverMode} serverStatus={serverStatus} serverDocument={serverDocument} onImportServerDocument={onImportServerDocument} readOnly={sourceReadOnly} />}
          {evidence && <EvidenceDialog target={evidence} plan={plan} projection={projection.base} range={projection.range} temporary={Boolean(workspace.draft)} serverMode={serverMode} onClose={() => setEvidence(null)} onEdit={editFromEvidence} />}
        </>}
        <footer className="page-footer"><span><LockKeyhole size={12} />{serverMode ? 'Server model · local draft recovery' : 'Private to this browser'}</span><button onClick={() => setEvidence({ kind: 'method' })}>Planning estimates, not financial advice <ArrowUpRight size={12} /></button></footer>
      </main>
      {changes.length > 0 && <div className="draft-bar"><div><span className="draft-icon"><GitBranch size={18} /></span><span><strong>Exploring a temporary version</strong><small>{changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'} · saved {serverMode ? 'server ' : ''}plan unchanged</small></span></div><div><button className="button draft-discard" onClick={() => setDiscardOpen(true)}><RotateCcw size={15} /><span>Discard</span></button><button className="button primary" onClick={() => navigate('compare')}>Review & save <ArrowRight size={15} /></button></div></div>}
    </div>
    {editor && <PlanEditor target={editor} plan={plan} onApply={state.updatePlan} onClose={closeEditor} />}
    {discardOpen && <Modal title="Return to your saved plan?" eyebrow="Discard temporary version" onClose={() => setDiscardOpen(false)}><p>Your {changes.length} unsaved {changes.length === 1 ? 'change will' : 'changes will'} be removed. Your saved plan and captured comparison measures stay intact.</p><div className="modal-actions"><button className="button secondary" onClick={() => setDiscardOpen(false)}>Keep exploring</button><button className="button danger" disabled={discarding} onClick={() => { void confirmDiscard(); }}>{discarding ? 'Discarding…' : 'Discard changes'}</button></div></Modal>}
    {state.notice && <div className="toast" role="status"><Check size={17} /><span>{state.notice}</span><IconButton icon={X} label="Dismiss notification" onClick={state.dismissNotice} /></div>}
  </div>;
}

function ProjectionLoading({ label = 'Calculating your server outlook', onRetry }: { label?: string; onRetry: () => void }) {
  return <div className="recovery-screen"><WaypointBrand /><h1>{label}.</h1><div className="recovery-progress" role="status"><span className="spinner" aria-hidden="true" />Connecting the displayed plan to the projection service.</div><p>The saved server model has not been changed.</p><div className="recovery-actions"><button className="button secondary" onClick={onRetry}>Retry server calculation</button></div></div>;
}

function WaypointBrand() {
  return <a className="brand" href="#outlook" aria-label="Waypoint home"><span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m5 23 6-15 6 12 5-9 5 12" /></svg></span><span>waypoint<span className="brand-period">.</span></span></a>;
}
