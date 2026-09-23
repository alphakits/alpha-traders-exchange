import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import type { MobileLocale } from "@alpha-traders/contracts";
import { messages, type MessageKey } from "./messages";

const LOCALE_STORAGE_KEY = "alpha.mobile.session-locale.v2";

type LocaleContextValue = {
  locale: MobileLocale;
  isRTL: boolean;
  isHydrated: boolean;
  hasSelectedLocale: boolean;
  setLocale: (locale: MobileLocale) => Promise<void>;
  resetLocale: () => void;
  t: (key: MessageKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<MobileLocale>("en");
  const [isHydrated, setIsHydrated] = useState(false);
  const [hasSelectedLocale, setHasSelectedLocale] = useState(false);
  const localeRevision = useRef(0);
  const pendingWrite = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(LOCALE_STORAGE_KEY)
      .then((stored) => {
        if (!active || localeRevision.current > 0) return;
        if (stored === "ar" || stored === "en") {
          setLocaleState(stored);
          setHasSelectedLocale(true);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const persistLocale = useCallback((nextLocale: MobileLocale) => {
    pendingWrite.current = pendingWrite.current
      .then(() => AsyncStorage.setItem(LOCALE_STORAGE_KEY, nextLocale))
      .catch(() => undefined);
    return pendingWrite.current;
  }, []);

  const setLocale = useCallback(async (nextLocale: MobileLocale) => {
    localeRevision.current += 1;
    setLocaleState(nextLocale);
    setHasSelectedLocale(true);
    await persistLocale(nextLocale);
  }, [persistLocale]);

  const resetLocale = useCallback(() => {
    localeRevision.current += 1;
    setLocaleState("en");
    setHasSelectedLocale(false);
    void persistLocale("en");
  }, [persistLocale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    isRTL: locale === "ar",
    isHydrated,
    hasSelectedLocale,
    setLocale,
    resetLocale,
    t: (key) => messages[locale][key],
  }), [hasSelectedLocale, isHydrated, locale, resetLocale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}
