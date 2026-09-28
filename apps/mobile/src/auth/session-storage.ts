import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { parseRememberedLogin, type MobileAuthTokens, type RememberedLogin } from "@alpha-traders/contracts";

const INSTALL_MARKER_KEY = "alpha.mobile.install.v1";
const INSTALL_MARKER_VALUE = "initialized";
const SESSION_STORAGE_KEY = "alpha.mobile.session.v1";
const DEVICE_ID_STORAGE_KEY = "alpha.mobile.device-id.v1";
const REMEMBERED_LOGIN_KEY = "alpha.mobile.remembered-login.v1";
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

let installationPromise: Promise<void> | null = null;
let deviceIdPromise: Promise<string> | null = null;
let rememberedLoginQueue: Promise<void> = Promise.resolve();

export function initializeSecureStorageForInstall() {
  if (!installationPromise) {
    installationPromise = (async () => {
      const marker = await AsyncStorage.getItem(INSTALL_MARKER_KEY);
      if (marker === INSTALL_MARKER_VALUE) return;
      await Promise.all([
        SecureStore.deleteItemAsync(SESSION_STORAGE_KEY),
        SecureStore.deleteItemAsync(DEVICE_ID_STORAGE_KEY),
        SecureStore.deleteItemAsync(REMEMBERED_LOGIN_KEY),
      ]);
      await AsyncStorage.setItem(INSTALL_MARKER_KEY, INSTALL_MARKER_VALUE);
    })().catch((error) => {
      installationPromise = null;
      throw error;
    });
  }
  return installationPromise;
}

function isStoredTokens(value: unknown): value is MobileAuthTokens {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MobileAuthTokens>;
  return candidate.tokenType === "Bearer"
    && typeof candidate.accessToken === "string"
    && candidate.accessToken.startsWith("atr_at_v1.")
    && typeof candidate.refreshToken === "string"
    && candidate.refreshToken.startsWith("atr_rt_v1.")
    && typeof candidate.accessTokenExpiresAt === "string"
    && typeof candidate.refreshTokenExpiresAt === "string"
    && Number.isFinite(new Date(candidate.refreshTokenExpiresAt).getTime());
}

export async function loadStoredTokens() {
  await initializeSecureStorageForInstall();
  const stored = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isStoredTokens(parsed) || new Date(parsed.refreshTokenExpiresAt).getTime() <= Date.now()) {
      await clearStoredTokens();
      return null;
    }
    return parsed;
  } catch {
    await clearStoredTokens();
    return null;
  }
}

export async function saveStoredTokens(tokens: MobileAuthTokens) {
  await initializeSecureStorageForInstall();
  await SecureStore.setItemAsync(SESSION_STORAGE_KEY, JSON.stringify(tokens), secureOptions);
}

export async function clearStoredTokens() {
  await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
}

// Serialize reads/writes so a late save cannot undo a later opt-out. The
// remembered credentials are deliberately separate from revocable sessions:
// signing out stays signed out, while the next login can fill the form.
function withRememberedLogin<T>(operation: () => Promise<T>): Promise<T> {
  const task = rememberedLoginQueue.then(async () => {
    await initializeSecureStorageForInstall();
    return operation();
  });
  rememberedLoginQueue = task.then(() => undefined, () => undefined);
  return task;
}

export function loadRememberedLogin() {
  return withRememberedLogin(async () => {
    const stored = await SecureStore.getItemAsync(REMEMBERED_LOGIN_KEY);
    if (!stored) return null;
    const credentials = parseRememberedLogin(stored);
    if (!credentials) await SecureStore.deleteItemAsync(REMEMBERED_LOGIN_KEY);
    return credentials;
  });
}

export function saveRememberedLogin(input: RememberedLogin) {
  return withRememberedLogin(async () => {
    const credentials = parseRememberedLogin(input);
    if (!credentials) throw new Error("Invalid remembered login");
    await SecureStore.setItemAsync(REMEMBERED_LOGIN_KEY, JSON.stringify(credentials), secureOptions);
  });
}

export function clearRememberedLogin() {
  return withRememberedLogin(() => SecureStore.deleteItemAsync(REMEMBERED_LOGIN_KEY));
}

export async function getOrCreateDeviceId() {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      await initializeSecureStorageForInstall();
      const stored = await SecureStore.getItemAsync(DEVICE_ID_STORAGE_KEY);
      if (stored && /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(stored)) return stored;
      const created = Crypto.randomUUID();
      await SecureStore.setItemAsync(DEVICE_ID_STORAGE_KEY, created, secureOptions);
      return created;
    })().catch((error) => {
      deviceIdPromise = null;
      throw error;
    });
  }
  return deviceIdPromise;
}
