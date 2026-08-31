/**
 * Core types for browser-debug-agent V2 orchestrator.
 */

// --- Session ---

export interface SessionManifest {
  id: string;
  createdAt: string;
  backend: string;
  backendVersion?: string;
  url?: string;
  serverPid?: number;
  serverOwned: boolean;
  browserPid?: number;
  browserOwned: boolean;
  port?: number;
  profileDir?: string;
  artifactDir: string;
  status: 'active' | 'stopped' | 'crashed';
}

// --- Evidence ---

export interface EvidenceEvent {
  v: 1;
  session: string;
  seq: number;
  ts: string;
  command: string;
  backend: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  artifacts: Artifact[];
  redactions: string[];
}

export interface Artifact {
  path: string;
  mediaType: string;
  digest?: string;
}

// --- Server ---

export interface ServerInfo {
  url: string;
  pid?: number;
  owned: boolean;
  command?: string;
}

// --- Adapter ---

export interface BrowserAdapter {
  name: string;
  version(): Promise<string>;
  open(url: string, opts?: OpenOpts): Promise<void>;
  snapshot(): Promise<SnapshotResult>;
  interact(action: InteractAction): Promise<InteractResult>;
  evaluate(expr: string): Promise<unknown>;
  console(): Promise<ConsoleEntry[]>;
  network(): Promise<NetworkEntry[]>;
  screenshot(opts?: ScreenshotOpts): Promise<Artifact>;
  navigate(url: string): Promise<void>;
  resize(width: number, height: number): Promise<void>;
  reload(): Promise<void>;
  waitFor(selector: string, timeout?: number): Promise<boolean>;
  cookies(): Promise<CookieEntry[]>;
  setCookie(cookie: CookieEntry): Promise<void>;
  localStorage(origin?: string): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export interface OpenOpts {
  viewport?: { width: number; height: number };
  headless?: boolean;
  /** Use the user's real Chrome profile (cookies, login, localStorage). Read-only by default. */
  profile?: 'isolated' | 'user' | 'custom';
  /** Custom user-data-dir path (only with profile: 'custom') */
  userDataDir?: string;
}

export interface SnapshotResult {
  refs: Record<string, string>;
  tree: string;
}

export interface InteractAction {
  type: 'click' | 'fill' | 'press' | 'hover' | 'select';
  ref?: string;
  selector?: string;
  value?: string;
  key?: string;
}

export interface InteractResult {
  ok: boolean;
  error?: string;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  text: string;
  ts?: string;
}

export interface NetworkEntry {
  method: string;
  url: string;
  status: number;
  duration?: number;
}

export interface ScreenshotOpts {
  fullPage?: boolean;
  selector?: string;
  path?: string;
}

export interface CookieEntry {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: number;
}

// --- Verify ---

export interface VerifyAssertion {
  type: 'console_errors' | 'network_status' | 'visible' | 'js' | 'snapshot_contains';
  expect: unknown;
  label?: string;
}

export interface VerifyManifest {
  url: string;
  viewport?: { width: number; height: number };
  assertions: VerifyAssertion[];
}

export interface VerifyResult {
  assertion: VerifyAssertion;
  status: 'pass' | 'fail' | 'skip';
  actual?: unknown;
  error?: string;
}

// --- Redaction ---

export const REDACT_PATTERNS = [
  /[Aa]uthorization:\s*.+/g,
  /[Cc]ookie:\s*.+/g,
  /[Ss]et-[Cc]ookie:\s*.+/g,
  /token=[^&\s"]+/gi,
  /api[_-]?key=[^&\s"]+/gi,
  /password=[^&\s"]+/gi,
] as const;
