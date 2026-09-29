import { createScanBus } from './scan-bus'
import type { ScanBus } from './scan-bus'

// Module-level singleton — shared across all route handlers in the same process.
// Both the scan creation route (POST /api/scans) and the SSE stream route
// (GET /api/scans/:id/stream) import this so events flow to subscribers.
const bus: ScanBus = createScanBus()

export { bus as sharedBus }
