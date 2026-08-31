export type {
  SessionManifest,
  EvidenceEvent,
  Artifact,
  ServerInfo,
  BrowserAdapter,
  OpenOpts,
  SnapshotResult,
  InteractAction,
  InteractResult,
  ConsoleEntry,
  NetworkEntry,
  ScreenshotOpts,
  VerifyAssertion,
  VerifyManifest,
  VerifyResult,
} from './types.js';

export { SessionManager } from './session.js';
export { ServerManager } from './server.js';
export { Evidence } from './evidence.js';
export { verify } from './verify.js';
export { ChromeCdpAdapter } from './adapters/chrome-cdp.js';
export { createAdapter, listBackends } from './adapters/factory.js';
export type { BackendName } from './adapters/factory.js';
export { startDaemon, stopDaemon, sendCommand, isDaemonRunning, socketPath } from './daemon.js';
