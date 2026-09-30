// Where the NVDA app tests find Crits & Giggles inside the guest. The ports
// match the root playwright.config.ts; global-setup.ts forwards them to the
// app servers that run-tests.ps1 starts on the host.
export const APP_PORTS = { app: 5174, api: 3005 } as const;
export const appUrl = `http://localhost:${APP_PORTS.app}`;
export const apiUrl = `http://localhost:${APP_PORTS.api}/api`;
