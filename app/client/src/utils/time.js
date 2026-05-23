// Re-export shim. The real implementation lives in app/shared/time.js so the
// server (Node ESM) imports the exact same module via ../shared/time.js.
// Relative path used here (not the Vite @shared alias) so Node test runner
// can resolve it too — see tests/.
export * from '../../../shared/time.js';
