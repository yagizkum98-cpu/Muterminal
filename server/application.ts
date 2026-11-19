import { createCore } from './core.cjs';
import * as database from './database';
import * as challenge from './challenge';
import { scanEnabled } from './features';

export const { getSession, serveApi, ensurePilotAccounts } = createCore(database, challenge, scanEnabled);
