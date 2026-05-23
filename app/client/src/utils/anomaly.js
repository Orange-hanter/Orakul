// Re-export shim — real implementation lives in app/shared/anomaly.js.
// Server (server/telegram.js) imports the same module via ../shared/anomaly.js
// so we never run two divergent copies of the z-score detector again.
export * from '../../../shared/anomaly.js';
