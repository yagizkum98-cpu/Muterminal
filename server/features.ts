export const testerEmail = 'tester@muterminal.com';

export function crossDockEnabled() {
  return process.env.MUTERMINAL_CROSS_DOCK_ENABLED === 'true';
}

export function scanEnabled(session?: { email: string; canSwitchPanels?: boolean }) {
  return process.env.MUTERMINAL_SCAN_ENABLED === 'true'
    || (session?.canSwitchPanels === true && session.email === testerEmail);
}
