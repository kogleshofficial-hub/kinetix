import test from 'node:test';
import assert from 'node:assert/strict';
import { installModuleWorkerDynamicImport } from '../src/engine/motion/KinetixWorkerImport.js';

test('replaces a truthy non-function worker import hook with native dynamic import', async () => {
  const scope = { import: { injected: true } };

  assert.equal(installModuleWorkerDynamicImport(scope), true);
  assert.equal(typeof scope.import, 'function');

  const module = await scope.import('data:text/javascript,export default 42');
  assert.equal(module.default, 42);
});

test('preserves an existing callable worker import hook', () => {
  const existing = async () => ({ default: 'existing-loader' });
  const scope = { import: existing };

  assert.equal(installModuleWorkerDynamicImport(scope), true);
  assert.equal(scope.import, existing);
});

test('returns false when the worker global cannot accept an import hook', () => {
  const scope = {};
  Object.defineProperty(scope, 'import', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: false
  });
  Object.preventExtensions(scope);

  assert.equal(installModuleWorkerDynamicImport(scope), false);
});
