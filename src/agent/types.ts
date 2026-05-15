export const API_VERSION = "1";
export const AGENT_VERSION = "0.1.0";

export type CredentialScope =
  | "read"
  | "read:status"
  | "read:logs"
  | "read:events";

export interface ServerMeta {
  apiVersion: string;
  agentVersion: string;
  instanceId: string;
  host: string;
  platform: "dokku";
  platformVersion: string | null;
  capabilities: string[];
}

export interface AppSummary {
  name: string;
  urls: string[];
  running: boolean | null;
  deployed: boolean | null;
  processCount: number | null;
  httpsActive: boolean | null;
  containerStatus: string | null;
  ports: string | null;
  domains: string[];
}

export interface LogLine {
  index: number;
  raw: string;
  message: string;
  timestamp: string | null;
  timestampText: string | null;
  source: string | null;
}

export interface AppLogs {
  status: "ok";
  app: string;
  lines: number;
  logs: LogLine[];
  truncated: boolean;
}

export interface PlatformEvent {
  index: number;
  raw: string;
  message: string;
  timestamp: string | null;
  timestampText: string | null;
  host: string | null;
  source: string | null;
  pid: number | null;
  action: string | null;
  app: string | null;
  args: string[];
}

export interface PlatformEventsOk {
  status: "ok";
  limit: number;
  events: PlatformEvent[];
  truncated: boolean;
}

export interface PlatformEventsUnavailable {
  status: "unavailable";
  limit: number;
  events: [];
  retryable: true;
  message: string;
  raw: string;
}

export type PlatformEvents = PlatformEventsOk | PlatformEventsUnavailable;

export interface PlatformVersion {
  platform: "dokku";
  version: string | null;
  raw: string;
}

export interface DokkuPlatform {
  version(): Promise<PlatformVersion>;
  listApps(): Promise<string[]>;
  getApp(app: string): Promise<AppSummary>;
  getAppLogs(app: string, lines: number): Promise<AppLogs>;
  getEvents(limit: number): Promise<PlatformEvents>;
}

export interface PublicPairingSession {
  id: string;
  scope: string;
  expectedDeviceName: string | null;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
  canceledAt: string | null;
}

export interface PublicCredential {
  id: string;
  scope: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
