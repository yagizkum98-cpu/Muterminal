import { createCore } from './core.cjs';
import * as database from './database';
import * as challenge from './challenge';
import * as trace from './trace';
import * as traceAccess from './trace-access';
import * as traceControls from './trace-controls';
import * as mobileAccess from './mobile-access';
import * as features from './features';

export const { getSession, serveApi, ensurePilotAccounts } = createCore(database, challenge, features, trace, traceAccess, traceControls, mobileAccess);
