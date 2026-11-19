import { createCore } from './core.cjs';
import * as database from './database';
import * as challenge from './challenge';
import * as trace from './trace';
import * as traceAccess from './trace-access';
import * as traceControls from './trace-controls';
import { scanEnabled } from './features';

export const { getSession, serveApi, ensurePilotAccounts } = createCore(database, challenge, scanEnabled, trace, traceAccess, traceControls);
