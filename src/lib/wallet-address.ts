import {
  getWalletAddressValidationError as getSharedWalletAddressValidationError,
} from "@alpha-traders/contracts";
import type { SupportedNetwork } from "@/types/alpha-exchange";

export { normalizeWalletAddress } from "@alpha-traders/contracts";

export function getWalletAddressValidationError(network: SupportedNetwork, value: string) {
  return getSharedWalletAddressValidationError(network, value);
}
