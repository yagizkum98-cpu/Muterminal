export const testerEmail = 'tester@muterminal.com';

export function scanEnabled(session?: { email: string; canSwitchPanels?: boolean }) {
  return process.env.MUTERMINAL_SCAN_ENABLED === 'true'
    || (session?.canSwitchPanels === true && session.email === testerEmail);
}
