import { describe, expect, it } from 'vitest';
import type { FinancialModelDocument, ProjectionResult } from './contracts.ts';
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL } from './contracts.ts';
import { backendToDisplayPlan, displayPlanToBackendDocument } from './adapter.ts';

function documentFixture(): FinancialModelDocument {
  return {
    sourcePath: '/configs/household.json',
    accounts: [
      { id: 'cash', label: 'Cash', minBalance: NO_FLOOR_SENTINEL, maxBalance: NO_CEILING_SENTINEL, color: null, enabled: true },
      { id: 'loan', label: 'Loan', minBalance: null, maxBalance: null, color: null, enabled: true },
    ],
    checkpoints: [
      { Date: '2026-01-31', AccountId: 'cash', Balance: 100 },
      { Date: '2026-03-01', AccountId: 'cash', Balance: 999 },
      { Date: '2026-01-31', AccountId: 'loan', Balance: -40 },
    ],
    evaluations: {
      financialIndependence: [],
      netWorthThreshold: [{ instanceId: 'target', label: 'Reach target', enabled: true, config: { target: 500 } }],
      postingFulfillment: [],
    },
    postings: [{
      id: 'salary',
      label: 'Salary',
      sourceAccountId: null,
      destinations: ['cash'],
      amount: { resolver: 'expression', config: { expression: '250' }, inputs: {} },
      frequency: 'monthly',
      annualRate: 0,
      annualGrowthRate: 0.02,
      volatility: 0.1,
      startDate: '2026-02-05',
      endDate: null,
      annualCap: null,
      priority: 3,
      enabled: true,
      source: 'model',
    }],
  };
}

function projectionFixture(): ProjectionResult {
  return {
    timeline: { rows: [] },
    accountSummaries: [],
    totals: { externalInflowAmount: 0, externalOutflowAmount: 0, internalTransferAmount: 0 },
    milestones: { latestHistoricalDate: '2026-01-31', projectionStartDate: '2026-02-01' },
    summary: { currentNetWorth: 60, finalNetWorth: 60 },
    evaluations: { financialIndependence: [], netWorthThreshold: [], postingFulfillment: [] },
    movementEvents: [],
  };
}

describe('backend and display plan adapter', () => {
  it('uses the latest checkpoint at or before projection start and maps bounds, postings, and goals', () => {
    const conversion = backendToDisplayPlan({ document: documentFixture(), status: { readOnly: false, authEnabled: true }, projection: projectionFixture() });

    expect(conversion.plan.startDate).toBe('2026-02-01');
    expect(conversion.plan.accounts[0]?.balance).toBe(100);
    expect(conversion.plan.accounts[0]?.observedOn).toBe('2026-01-31');
    expect(conversion.plan.accounts[0]?.floor).toBe(0);
    expect(conversion.plan.accounts[0]?.ceiling).toBeNull();
    expect(conversion.plan.accounts[1]?.kind).toBe('debt');
    expect(conversion.plan.movements[0]).toMatchObject({ amount: 250, fromId: null, toId: 'cash', frequency: 'monthly', annualIncrease: 2 });
    expect(conversion.plan.goals).toEqual([{ id: 'target', name: 'Reach target', kind: 'net-worth', target: 500, accountId: null, enabled: true }]);
    expect(conversion.report.provisionalFields).toContain('accounts.0.floor');
    expect(conversion.report.provisionalFields).toContain('movements.0.metadata');
  });

  it('treats only explicit SimpleFIN postings as recorded', () => {
    const modelDocument = documentFixture();
    modelDocument.postings[0] = { ...modelDocument.postings[0]!, frequency: 'once', startDate: '2026-01-01', source: 'model' };
    const modelConversion = backendToDisplayPlan({ document: modelDocument, status: { readOnly: false, authEnabled: false }, projection: projectionFixture() });

    expect(modelConversion.plan.movements[0]?.provenance).toBe('planned');
    expect(modelConversion.report.warnings).toContainEqual(expect.objectContaining({ code: 'posting-provenance-inferred', path: 'movements.0.provenance' }));
    expect(modelConversion.report.provisionalFields).toContain('movements.0.provenance');

    const simplefinDocument = structuredClone(modelDocument);
    simplefinDocument.postings[0]!.source = 'simplefin';
    const simplefinConversion = backendToDisplayPlan({ document: simplefinDocument, status: { readOnly: false, authEnabled: false }, projection: projectionFixture() });
    expect(simplefinConversion.plan.movements[0]).toMatchObject({ provenance: 'recorded', readOnly: true });
  });

  it('preserves unchanged backend rows and allows expression-backed amount edits', () => {
    const conversion = backendToDisplayPlan({ document: documentFixture(), status: { readOnly: false, authEnabled: false }, projection: projectionFixture(), startDate: '2026-02-01' });
    const reverse = displayPlanToBackendDocument(conversion.plan, { sidecar: conversion.sidecar });
    const amountEdit = displayPlanToBackendDocument({
      ...conversion.plan,
      movements: conversion.plan.movements.map((movement) => movement.id === 'salary' ? { ...movement, amount: 300 } : movement),
    }, { sidecar: conversion.sidecar });

    expect(reverse.report.losses).toEqual([]);
    expect(reverse.document).toEqual(documentFixture());
    expect(amountEdit.report.losses).toEqual([]);
    expect(amountEdit.document.postings[0]?.amount).toEqual({ resolver: 'expression', config: { expression: '300' }, inputs: {} });
    const reloaded = backendToDisplayPlan({ document: amountEdit.document, status: { readOnly: false, authEnabled: false }, sidecar: conversion.sidecar });
    expect(reloaded.sidecar.presentation.movements.salary?.amountValue).toBe(300);
  });

  it('marks provider-backed amounts as provisional and read-only', () => {
    const document = documentFixture();
    document.postings[0]!.amount = { resolver: 'income', config: { incomeSourceId: 'salary', resolvers: [] }, inputs: {} };
    const conversion = backendToDisplayPlan({ document, status: { readOnly: false, authEnabled: false }, projection: projectionFixture() });
    expect(conversion.plan.movements[0]).toMatchObject({ amount: 0, amountKnown: false, readOnly: true });
  });

  it('blocks removal of an account with a SimpleFIN-owned checkpoint', () => {
    const document = documentFixture();
    document.checkpoints[0]!.source = 'simplefin';
    const conversion = backendToDisplayPlan({ document, status: { readOnly: false, authEnabled: false }, projection: projectionFixture(), startDate: '2026-02-01' });
    const reverse = displayPlanToBackendDocument({ ...conversion.plan, accounts: conversion.plan.accounts.filter((account) => account.id !== 'cash') }, { sidecar: conversion.sidecar });
    expect(reverse.report.losses).toContainEqual(expect.objectContaining({ field: 'accounts.cash' }));
  });

  it('does not invent checkpoints for untouched accounts without observations', () => {
    const document = documentFixture();
    document.accounts.push({ id: 'unobserved', label: 'Unobserved', minBalance: NO_FLOOR_SENTINEL, maxBalance: NO_CEILING_SENTINEL, color: null, enabled: true });
    const conversion = backendToDisplayPlan({ document, status: { readOnly: false, authEnabled: false }, projection: projectionFixture(), startDate: '2026-02-01' });
    const edited = { ...conversion.plan, movements: conversion.plan.movements.map((movement) => movement.id === 'salary' ? { ...movement, amount: 300 } : movement) };
    const reverse = displayPlanToBackendDocument(edited, { sidecar: conversion.sidecar });
    expect(reverse.report.losses).toEqual([]);
    expect(reverse.document.checkpoints.some((checkpoint) => checkpoint.AccountId === 'unobserved')).toBe(false);
  });

  it('preserves checkpoint history while replacing the displayed observation and supports deletions', () => {
    const document = documentFixture();
    document.accounts[0]!.enabled = false;
    const conversion = backendToDisplayPlan({ document, status: { readOnly: false, authEnabled: false }, projection: projectionFixture(), startDate: '2026-02-01' });
    expect(conversion.plan.accounts[0]?.enabled).toBe(false);
    const edited = {
      ...conversion.plan,
      accounts: conversion.plan.accounts.filter((account) => account.id === 'cash').map((account) => ({ ...account, balance: 123, observedOn: '2026-02-02' })),
      movements: conversion.plan.movements.slice(0, 0),
    };
    const reverse = displayPlanToBackendDocument(edited, { sidecar: conversion.sidecar });
    expect(reverse.report.losses).toEqual([]);
    expect(reverse.document.checkpoints.filter((checkpoint) => checkpoint.AccountId === 'cash')).toEqual(expect.arrayContaining([
      expect.objectContaining({ Date: '2026-01-31', Balance: 100 }),
      expect.objectContaining({ Date: '2026-03-01', Balance: 999 }),
      expect.objectContaining({ Date: '2026-02-02', Balance: 123 }),
    ]));
    expect(reverse.document.accounts.map((account) => account.id)).toEqual(['cash']);
    expect(reverse.document.postings).toEqual([]);
    const conflicting = displayPlanToBackendDocument({
      ...edited,
      accounts: edited.accounts.map((account) => account.id === 'cash' ? { ...account, observedOn: '2026-03-01' } : account),
    }, { sidecar: conversion.sidecar });
    expect(conflicting.report.losses).toContainEqual(expect.objectContaining({ field: 'accounts.cash.checkpoints' }));
  });

  it('returns a complete backend document and reports local-only losses instead of uploading them', () => {
    const conversion = backendToDisplayPlan({ document: documentFixture(), status: { readOnly: false, authEnabled: false }, projection: projectionFixture(), startDate: '2026-02-01' });
    const plan = {
      ...conversion.plan,
      assumptions: { inflation: 2, volatility: 10 },
      goals: [...conversion.plan.goals, { id: 'reserve', name: 'Reserve', kind: 'reserve' as const, target: 1000, accountId: 'cash', enabled: true }],
    };
    const reverse = displayPlanToBackendDocument(plan, { sidecar: conversion.sidecar });

    expect(reverse.document.accounts.map((account) => account.id)).toEqual(['cash', 'loan']);
    expect(reverse.document.accounts[0]?.minBalance).toBe(NO_FLOOR_SENTINEL);
    expect(reverse.document.accounts[0]?.maxBalance).toBe(NO_CEILING_SENTINEL);
    expect(reverse.document.postings[0]).toMatchObject({ id: 'salary', destinations: ['cash'], frequency: 'monthly' });
    expect(reverse.document.evaluations.netWorthThreshold[0]?.config).toEqual({ target: 500 });
    expect(JSON.stringify(reverse.document)).not.toContain('"origin"');
    expect(JSON.stringify(reverse.document)).not.toContain('"assumptions"');
    expect(reverse.report.losses.some((loss) => loss.field === 'goals.reserve')).toBe(true);
    expect(reverse.report.losses.some((loss) => loss.field === 'assumptions')).toBe(true);
    expect(reverse.report.hasLosses).toBe(true);
  });
});
