const requestedPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? "3000", 10);

export const E2E_PORT =
  Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65_535
    ? requestedPort
    : 3000;

export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
