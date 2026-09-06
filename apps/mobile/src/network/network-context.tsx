import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { onlineManager } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { resolveNativeNetworkAvailability } from "./network-state";

type NetworkContextValue = {
  isOnline: boolean | null;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: PropsWithChildren) {
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const applyState = (state: NetInfoState) => {
      if (!active) return;
      const nextOnline = resolveNativeNetworkAvailability({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      });
      setIsOnline(nextOnline);
      if (nextOnline !== null) onlineManager.setOnline(nextOnline);
    };
    const unsubscribe = NetInfo.addEventListener(applyState);
    void NetInfo.fetch().then(applyState).catch(() => {
      if (!active) return;
      setIsOnline(true);
      onlineManager.setOnline(true);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ isOnline }), [isOnline]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetworkStatus() {
  const context = useContext(NetworkContext);
  if (!context) throw new Error("useNetworkStatus must be used inside NetworkProvider");
  return context;
}
