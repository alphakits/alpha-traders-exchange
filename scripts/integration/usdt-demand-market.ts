import { demandTestMarket } from "../../src/test-utils/usdt-demand-fixtures";
export async function getMarketSnapshot() { return demandTestMarket(); }
export async function getUsdtIlsReferenceRate() { return 3.2; }
export const DEFAULT_USD_ILS_RATE = 3.2;
