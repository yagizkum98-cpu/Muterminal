import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PanelRole } from './panels';
import type { AccountScope } from './trace-access';

export function createCore(database: typeof import('./database'), challenge: typeof import('./challenge'), features: typeof import('./features'),
  trace: typeof import('./trace'), traceAccess: typeof import('./trace-access'), traceControls: typeof import('./trace-controls'),
  mobileAccess: typeof import('./mobile-access'), notifications: typeof import('./notifications')): {
  getSession(request: IncomingMessage, panel?: PanelRole | 'trace' | 'depo'): Promise<{
    role: PanelRole | 'trace'; email: string; displayName?: string; storeId: string; canApprove: boolean;
    scope?: AccountScope; mobile?: boolean; mobileApproval?: string; canSwitchPanels?: boolean;
  } | undefined>;
  serveApi(request: IncomingMessage, response: ServerResponse, path: string): Promise<void>;
  ensurePilotAccounts(): Promise<void>;
};
