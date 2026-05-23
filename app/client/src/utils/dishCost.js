// Re-export shim — real implementation lives in app/shared/dishCost.js.
// Server (server/alerts.js) imports the same module via ../shared/dishCost.js
// for the FC% calculation on price-jump alerts.
export * from '../../../shared/dishCost.js';
