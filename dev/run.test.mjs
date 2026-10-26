import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperation } from './run.mjs';

test('refresh requires explicit source and destination scopes before any service operation', () => {
  assert.throws(() => validateOperation('refresh-db', {}), /source-plan/);
  assert.throws(() => validateOperation('refresh-db', { 'source-plan': 'plans/source' }), /--plan/);
  assert.throws(() => validateOperation('refresh-db', { 'source-plan': 'plans/source', plan: 'plans/sample' }), /private plan/);
  assert.doesNotThrow(() => validateOperation('refresh-db', { 'source-plan': 'plans/source', plan: 'plans/owner' }));
});

test('publication explicitly selects reviewed source and cannot redirect its public destination', () => {
  assert.throws(() => validateOperation('publish-sample', {}), /source-plan/);
  assert.throws(() => validateOperation('publish-sample', { 'source-plan': 'plans/source', plan: 'plans/private' }), /always targets/);
  assert.doesNotThrow(() => validateOperation('publish-sample', { 'source-plan': 'plans/source' }));
  assert.throws(() => validateOperation('setup', { plan: 'plans/private' }), /only to refresh-db/);
  assert.doesNotThrow(() => validateOperation('setup', { from: 'shared.db', 'source-plan': 'plans/reviewed-owner' }));
});

test('legacy setup migration uses an explicit manifest and a fresh destination', () => {
  assert.doesNotThrow(() => validateOperation('setup', { manifest: '/approved/migration.json' }));
  assert.throws(() => validateOperation('setup', { manifest: 'migration.json', from: 'source.db' }), /cannot combine/);
  assert.throws(() => validateOperation('refresh-db', { manifest: 'migration.json' }), /only to setup/);
});
