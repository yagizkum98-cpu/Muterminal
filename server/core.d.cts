import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PanelRole } from './panels';

export function createCore(database: typeof import('./database'), challenge: typeof import('./challenge'), scanEnabled: () => boolean): {
  getSession(request: IncomingMessage): Promise<{ role: PanelRole; email: string; displayName?: string; storeId: string } | undefined>;
  serveApi(request: IncomingMessage, response: ServerResponse, path: string): Promise<void>;
  ensurePilotAccounts(): Promise<void>;
};
