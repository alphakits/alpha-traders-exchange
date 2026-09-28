import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const PREFERENCES_KEY = "alpha.mobile.biometric-lock.preferences.v1";
const SECURE_KEY_PREFIX = "alpha.mobile.biometric-lock.v1";

export type BiometricOperationResult = "success" | "unsupported" | "invalidated" | "failed";

type BiometricPreferences = Record<string, true>;

const protectedOptions = (prompt: string): SecureStore.SecureStoreOptions => ({
  authenticationPrompt: prompt,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
});

async function accountKey(userId: string) {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, userId);
  return digest.slice(0, 40);
}

async function secureKey(userId: string) {
  return `${SECURE_KEY_PREFIX}.${await accountKey(userId)}`;
}

async function readPreferences(): Promise<BiometricPreferences> {
  const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([key, enabled]) => /^[a-f0-9]{40}$/.test(key) && enabled === true),
    ) as BiometricPreferences;
  } catch {
    return {};
  }
}

async function setPreference(userId: string, enabled: boolean) {
  const key = await accountKey(userId);
  const preferences = await readPreferences();
  if (enabled) preferences[key] = true;
  else delete preferences[key];
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

export function canUseBiometricLock() {
  try {
    return SecureStore.canUseBiometricAuthentication();
  } catch {
    return false;
  }
}

export async function isBiometricLockEnabled(userId: string) {
  const preferences = await readPreferences();
  return preferences[await accountKey(userId)] === true;
}

export async function enableBiometricLock(userId: string, prompt: string): Promise<BiometricOperationResult> {
  if (!canUseBiometricLock()) return "unsupported";
  let key = "";
  try {
    key = await secureKey(userId);
    const secret = Crypto.randomUUID();
    await SecureStore.setItemAsync(key, secret, protectedOptions(prompt));
    // Android authenticates the protected write. iOS authenticates only when
    // the newly created item is first read or later updated.
    if (Platform.OS === "ios") {
      const verified = await SecureStore.getItemAsync(key, protectedOptions(prompt));
      if (verified !== secret) {
        await SecureStore.deleteItemAsync(key);
        return "failed";
      }
    }
    await setPreference(userId, true);
    return "success";
  } catch {
    if (key) {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // An orphaned sentinel is inert because the preference was never enabled.
      }
    }
    return "failed";
  }
}

export async function unlockBiometricLock(userId: string, prompt: string): Promise<BiometricOperationResult> {
  if (!canUseBiometricLock()) return "unsupported";
  try {
    const value = await SecureStore.getItemAsync(await secureKey(userId), protectedOptions(prompt));
    return value ? "success" : "invalidated";
  } catch {
    return "failed";
  }
}

export async function disableBiometricLock(userId: string, prompt: string): Promise<BiometricOperationResult> {
  if (!canUseBiometricLock()) return "unsupported";
  try {
    const key = await secureKey(userId);
    const value = await SecureStore.getItemAsync(key, protectedOptions(prompt));
    if (!value) {
      await clearInvalidatedBiometricLock(userId);
      return "success";
    }
    await setPreference(userId, false);
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // A disabled preference makes an undeleted sentinel inert.
    }
    return "success";
  } catch {
    return "failed";
  }
}

export async function clearInvalidatedBiometricLock(userId: string) {
  await setPreference(userId, false);
  try {
    await SecureStore.deleteItemAsync(await secureKey(userId));
  } catch {
    // Invalidated platform keys may already be gone.
  }
}
