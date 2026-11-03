/**
 * MediaPipe's WASM loader uses self.import as an optional dynamic-import
 * hook when importScripts() is unavailable in an ES-module worker.
 *
 * Some browser/bundler combinations expose a truthy, non-callable
 * self.import value. MediaPipe treats any truthy value as a function,
 * which causes "self.import is not a function" during camera startup.
 *
 * Install a native dynamic-import bridge only when the existing hook is
 * missing or unusable. The @vite-ignore comment keeps this specifier-based
 * import native in the production worker bundle.
 */
export function installModuleWorkerDynamicImport(scope) {
  if (!scope || (typeof scope !== 'object' && typeof scope !== 'function')) {
    return false;
  }

  if (typeof scope.import === 'function') return true;

  const dynamicImport = (specifier) => import(/* @vite-ignore */ specifier);

  try {
    Object.defineProperty(scope, 'import', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: dynamicImport
    });
  } catch {
    try {
      scope.import = dynamicImport;
    } catch {
      // A locked-down worker global may reject both defineProperty and assignment.
    }
  }

  return typeof scope.import === 'function';
}
