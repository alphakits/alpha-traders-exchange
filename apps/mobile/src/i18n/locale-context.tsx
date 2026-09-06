import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import type { MobileLocale } from "@alpha-traders/contracts";
import { messages, type MessageKey } from "./messages";

const LOCALE_STORAGE_KEY = "alpha.mobile.locale.v1";

type LocaleContextValue = {
  locale: MobileLocale;
  isRTL: boolean;
  isHydrated: boolean;
  hasSelectedLocale: boolean;
  setLocale: (locale: MobileLocale) => Promise<void>;
  t: (key: MessageKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function inferredLocale(): MobileLocale {
  return getLocales()[0]?.languageCode === "ar" ? "ar" : "en";
}

export function LocaleProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<MobileLocale>(inferredLocale);
  const [isHydrated, setIsHydrated] = useState(false);
  const [hasSelectedLocale, setHasSelectedLocale] = useState(false);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(LOCALE_STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        if (stored === "ar" || stored === "en") {
          setLocaleState(stored);
          setHasSelectedLocale(true);
        }
      })
      .finally(() => {
        if (active) setIsHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback(async (nextLocale: MobileLocale) => {
    setLocaleState(nextLocale);
    setHasSelectedLocale(true);
    await AsyncStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    isRTL: locale === "ar",
    isHydrated,
    hasSelectedLocale,
    setLocale,
    t: (key) => messages[locale][key],
  }), [hasSelectedLocale, isHydrated, locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}
