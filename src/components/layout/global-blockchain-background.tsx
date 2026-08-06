"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";

const particleConfig = [
  { left: "8%", top: "18%", size: 3, duration: 24, delay: -7 },
  { left: "14%", top: "72%", size: 4, duration: 30, delay: -13 },
  { left: "22%", top: "40%", size: 3, duration: 26, delay: -10 },
  { left: "31%", top: "14%", size: 2, duration: 22, delay: -5 },
  { left: "39%", top: "62%", size: 4, duration: 28, delay: -15 },
  { left: "48%", top: "32%", size: 3, duration: 25, delay: -4 },
  { left: "56%", top: "78%", size: 3, duration: 32, delay: -12 },
  { left: "63%", top: "22%", size: 2, duration: 21, delay: -9 },
  { left: "72%", top: "54%", size: 4, duration: 29, delay: -11 },
  { left: "81%", top: "16%", size: 3, duration: 23, delay: -8 },
  { left: "88%", top: "70%", size: 2, duration: 27, delay: -14 },
  { left: "93%", top: "36%", size: 3, duration: 31, delay: -6 },
];

const pulseLines = [
  { left: "4%", top: "28%", width: "28vw", rotate: -8, delay: -2, duration: 9 },
  { left: "22%", top: "66%", width: "32vw", rotate: 14, delay: -5, duration: 12 },
  { left: "38%", top: "18%", width: "26vw", rotate: -18, delay: -1, duration: 10 },
  { left: "58%", top: "62%", width: "30vw", rotate: 6, delay: -6, duration: 11 },
  { left: "67%", top: "34%", width: "22vw", rotate: -13, delay: -3, duration: 8 },
  { left: "76%", top: "76%", width: "20vw", rotate: 18, delay: -7, duration: 13 },
];

const floatingCoins = [
  { coin: "btc", left: "4%", top: "12%", size: 58, duration: 62, delay: -8, driftX: 24, driftY: -18, rotate: 8, opacity: 0.24, parallax: 0.07 },
  { coin: "eth", left: "87%", top: "18%", size: 72, duration: 68, delay: -21, driftX: -20, driftY: 14, rotate: -10, opacity: 0.2, parallax: 0.09 },
  { coin: "sol", left: "78%", top: "74%", size: 66, duration: 74, delay: -30, driftX: -26, driftY: -16, rotate: 12, opacity: 0.22, parallax: 0.1 },
  { coin: "usdt", left: "11%", top: "78%", size: 62, duration: 70, delay: -13, driftX: 28, driftY: -10, rotate: -6, opacity: 0.23, parallax: 0.08 },
  { coin: "btc", left: "58%", top: "-3%", size: 50, duration: 84, delay: -35, driftX: 16, driftY: 22, rotate: -7, opacity: 0.16, parallax: 0.05 },
  { coin: "eth", left: "-4%", top: "52%", size: 48, duration: 88, delay: -18, driftX: 22, driftY: 18, rotate: 9, opacity: 0.17, parallax: 0.05 },
  { coin: "sol", left: "45%", top: "88%", size: 54, duration: 78, delay: -26, driftX: -16, driftY: -20, rotate: -11, opacity: 0.18, parallax: 0.06 },
  { coin: "usdt", left: "94%", top: "48%", size: 56, duration: 82, delay: -40, driftX: -24, driftY: 12, rotate: 10, opacity: 0.19, parallax: 0.06 },
  { coin: "bnb", left: "72%", top: "9%", size: 52, duration: 86, delay: -24, driftX: -14, driftY: 18, rotate: 8, opacity: 0.17, parallax: 0.05 },
  { coin: "xrp", left: "2%", top: "46%", size: 50, duration: 90, delay: -28, driftX: 20, driftY: 12, rotate: -9, opacity: 0.16, parallax: 0.04 },
  { coin: "ada", left: "83%", top: "36%", size: 48, duration: 92, delay: -32, driftX: -18, driftY: -14, rotate: 7, opacity: 0.15, parallax: 0.04 },
  { coin: "eth", left: "1%", top: "8%", size: 46, duration: 96, delay: -20, driftX: 14, driftY: 10, rotate: 6, opacity: 0.15, parallax: 0.04 },
  { coin: "usdt", left: "6%", top: "88%", size: 44, duration: 98, delay: -27, driftX: 12, driftY: -12, rotate: -8, opacity: 0.15, parallax: 0.04 },
  { coin: "bnb", left: "-2%", top: "72%", size: 42, duration: 94, delay: -33, driftX: 10, driftY: -8, rotate: 9, opacity: 0.14, parallax: 0.03 },
] as const;

const cryptoConnectionLines = [
  { left: "9%", top: "23%", width: "20vw", rotate: 12, duration: 34, delay: -4 },
  { left: "28%", top: "31%", width: "18vw", rotate: -6, duration: 40, delay: -11 },
  { left: "51%", top: "21%", width: "22vw", rotate: 8, duration: 38, delay: -8 },
  { left: "63%", top: "56%", width: "20vw", rotate: -14, duration: 42, delay: -15 },
  { left: "23%", top: "64%", width: "24vw", rotate: 11, duration: 44, delay: -18 },
  { left: "42%", top: "74%", width: "17vw", rotate: -9, duration: 36, delay: -6 },
] as const;

const cryptoNodes = [
  { left: "8%", top: "22%", size: 5, delay: -2 },
  { left: "19%", top: "25%", size: 4, delay: -4 },
  { left: "31%", top: "30%", size: 5, delay: -1 },
  { left: "48%", top: "24%", size: 4, delay: -3 },
  { left: "61%", top: "27%", size: 5, delay: -5 },
  { left: "75%", top: "58%", size: 4, delay: -6 },
  { left: "58%", top: "66%", size: 5, delay: -2 },
  { left: "41%", top: "72%", size: 4, delay: -7 },
  { left: "29%", top: "66%", size: 5, delay: -4 },
  { left: "18%", top: "61%", size: 4, delay: -8 },
] as const;

const cryptoDust = [
  { left: "12%", top: "18%", size: 2, duration: 20, delay: -3 },
  { left: "24%", top: "42%", size: 2, duration: 24, delay: -8 },
  { left: "37%", top: "28%", size: 3, duration: 28, delay: -2 },
  { left: "54%", top: "19%", size: 2, duration: 22, delay: -10 },
  { left: "67%", top: "44%", size: 2, duration: 26, delay: -6 },
  { left: "78%", top: "64%", size: 3, duration: 30, delay: -12 },
  { left: "52%", top: "69%", size: 2, duration: 24, delay: -9 },
  { left: "32%", top: "71%", size: 2, duration: 27, delay: -5 },
] as const;

function CoinLogo({ coin }: { coin: "btc" | "eth" | "sol" | "usdt" | "bnb" | "xrp" | "ada" }) {
  if (coin === "btc") {
    return (
      <svg viewBox="0 0 64 64" className="global-chain-bg__coin-svg" aria-hidden="true">
        <circle cx="32" cy="32" r="24" className="global-chain-bg__coin-ring" />
        <text x="32" y="39" textAnchor="middle" className="global-chain-bg__coin-text">₿</text>
      </svg>
    );
  }

  if (coin === "eth") {
    return (
      <svg viewBox="0 0 64 64" className="global-chain-bg__coin-svg" aria-hidden="true">
        <circle cx="32" cy="32" r="24" className="global-chain-bg__coin-ring" />
        <polygon points="32,12 22,31 32,37 42,31" className="global-chain-bg__coin-shape" />
        <polygon points="32,40 22,33 32,52 42,33" className="global-chain-bg__coin-shape--muted" />
      </svg>
    );
  }

  if (coin === "sol") {
    return (
      <svg viewBox="0 0 64 64" className="global-chain-bg__coin-svg" aria-hidden="true">
        <circle cx="32" cy="32" r="24" className="global-chain-bg__coin-ring" />
        <rect x="18" y="18" width="28" height="6" rx="3" className="global-chain-bg__coin-sol-a" />
        <rect x="18" y="29" width="28" height="6" rx="3" className="global-chain-bg__coin-sol-b" />
        <rect x="18" y="40" width="28" height="6" rx="3" className="global-chain-bg__coin-sol-c" />
      </svg>
    );
  }

  if (coin === "bnb") {
    return (
      <svg viewBox="0 0 64 64" className="global-chain-bg__coin-svg" aria-hidden="true">
        <circle cx="32" cy="32" r="24" className="global-chain-bg__coin-ring" />
        <polygon points="32,18 38,24 32,30 26,24" className="global-chain-bg__coin-shape--muted" />
        <polygon points="32,34 38,40 32,46 26,40" className="global-chain-bg__coin-shape--muted" />
        <polygon points="24,26 30,32 24,38 18,32" className="global-chain-bg__coin-shape--muted" />
        <polygon points="40,26 46,32 40,38 34,32" className="global-chain-bg__coin-shape--muted" />
      </svg>
    );
  }

  if (coin === "xrp") {
    return (
      <svg viewBox="0 0 64 64" className="global-chain-bg__coin-svg" aria-hidden="true">
        <circle cx="32" cy="32" r="24" className="global-chain-bg__coin-ring" />
        <path d="M18 22c3.2 0 4.8 1.3 6.6 3.1l2.3 2.2c1.8 1.8 3.2 2.7 5.1 2.7s3.3-.9 5.1-2.7l2.3-2.2c1.8-1.8 3.4-3.1 6.6-3.1" className="global-chain-bg__coin-stroke" />
        <path d="M18 42c3.2 0 4.8-1.3 6.6-3.1l2.3-2.2c1.8-1.8 3.2-2.7 5.1-2.7s3.3.9 5.1 2.7l2.3 2.2c1.8 1.8 3.4 3.1 6.6 3.1" className="global-chain-bg__coin-stroke" />
      </svg>
    );
  }

  if (coin === "ada") {
    return (
      <svg viewBox="0 0 64 64" className="global-chain-bg__coin-svg" aria-hidden="true">
        <circle cx="32" cy="32" r="24" className="global-chain-bg__coin-ring" />
        <circle cx="32" cy="32" r="3" className="global-chain-bg__coin-shape" />
        <circle cx="23" cy="32" r="1.8" className="global-chain-bg__coin-shape--muted" />
        <circle cx="41" cy="32" r="1.8" className="global-chain-bg__coin-shape--muted" />
        <circle cx="27.5" cy="24.5" r="1.6" className="global-chain-bg__coin-shape--muted" />
        <circle cx="36.5" cy="24.5" r="1.6" className="global-chain-bg__coin-shape--muted" />
        <circle cx="27.5" cy="39.5" r="1.6" className="global-chain-bg__coin-shape--muted" />
        <circle cx="36.5" cy="39.5" r="1.6" className="global-chain-bg__coin-shape--muted" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 64 64" className="global-chain-bg__coin-svg" aria-hidden="true">
      <circle cx="32" cy="32" r="24" className="global-chain-bg__coin-ring" />
      <circle cx="32" cy="32" r="14" className="global-chain-bg__coin-stroke" />
      <path d="M21 24h22M32 24v16M24 30h16" className="global-chain-bg__coin-stroke" />
    </svg>
  );
}

export function GlobalBlockchainBackground() {
  const pathname = usePathname();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [lowPower, setLowPower] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  const showCryptoOverlay = useMemo(() => {
    return pathname.includes("/usdt-exchange") || pathname.endsWith("/dashboard") || pathname.includes("/dashboard/seller");
  }, [pathname]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const mobileQuery = window.matchMedia("(max-width: 768px)");
    const updateMotion = () => setReduceMotion(mediaQuery.matches);
    const updateDesktop = () => setIsDesktop(desktopQuery.matches);
    const updateMobile = () => setIsMobileViewport(mobileQuery.matches);

    updateMotion();
    updateDesktop();
    updateMobile();
    mediaQuery.addEventListener("change", updateMotion);
    desktopQuery.addEventListener("change", updateDesktop);
    mobileQuery.addEventListener("change", updateMobile);

    return () => {
      mediaQuery.removeEventListener("change", updateMotion);
      desktopQuery.removeEventListener("change", updateDesktop);
      mobileQuery.removeEventListener("change", updateMobile);
    };
  }, []);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) {
      setLowPower(true);
      return;
    }

    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number; addEventListener: (name: string, cb: () => void) => void; removeEventListener: (name: string, cb: () => void) => void }> }).getBattery;
    if (!getBattery) return;

    let mounted = true;
    let batteryRef: { charging: boolean; level: number; addEventListener: (name: string, cb: () => void) => void; removeEventListener: (name: string, cb: () => void) => void } | null = null;
    const syncLowPower = () => {
      if (!mounted || !batteryRef) return;
      setLowPower(!batteryRef.charging && batteryRef.level <= 0.25);
    };

    getBattery()
      .then((battery) => {
        if (!mounted) return;
        batteryRef = battery;
        syncLowPower();
        battery.addEventListener("levelchange", syncLowPower);
        battery.addEventListener("chargingchange", syncLowPower);
      })
      .catch(() => {});

    return () => {
      mounted = false;
      if (batteryRef) {
        batteryRef.removeEventListener("levelchange", syncLowPower);
        batteryRef.removeEventListener("chargingchange", syncLowPower);
      }
    };
  }, []);

  const useLiteBackground = isMobileViewport || reduceMotion || lowPower;
  const visiblePulseLines = useLiteBackground ? pulseLines.slice(0, 2) : pulseLines;
  const visibleParticles = useLiteBackground ? particleConfig.slice(0, 4) : particleConfig;
  const shouldShowCryptoLayer = showCryptoOverlay && !useLiteBackground;

  useEffect(() => {
    if (!shouldShowCryptoLayer || !isDesktop || !layerRef.current) return;

    const layer = layerRef.current;
    const onMouseMove = (event: MouseEvent) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        layer.style.setProperty("--coin-parallax-x", `${x * 24}px`);
        layer.style.setProperty("--coin-parallax-y", `${y * 18}px`);
      });
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [shouldShowCryptoLayer, isDesktop]);

  return (
    <div className="global-chain-bg" aria-hidden="true">
      <div className="global-chain-bg__vignette" />
      <div className="global-chain-bg__mesh" />
      {!useLiteBackground ? (
        <svg className="global-chain-bg__network" viewBox="0 0 1920 1080" preserveAspectRatio="none">
          <g className="global-chain-bg__network-lines">
            <path d="M60 240 L380 180 L640 330 L920 250 L1260 380 L1580 280 L1860 360" />
            <path d="M120 760 L360 680 L620 760 L900 660 L1170 760 L1470 650 L1820 740" />
            <path d="M250 130 L470 320 L720 210 L980 420 L1230 320 L1490 520" />
            <path d="M300 940 L540 740 L800 860 L1100 720 L1360 860 L1710 690" />
            <path d="M520 90 L660 300 L860 140 L1090 290 L1300 150 L1550 260" />
            <path d="M740 980 L860 760 L1080 900 L1260 700 L1490 860 L1760 640" />
          </g>
          <g className="global-chain-bg__network-nodes">
            <circle cx="380" cy="180" r="4" />
            <circle cx="920" cy="250" r="4" />
            <circle cx="1260" cy="380" r="5" />
            <circle cx="360" cy="680" r="4" />
            <circle cx="900" cy="660" r="5" />
            <circle cx="1470" cy="650" r="4" />
            <circle cx="470" cy="320" r="4" />
            <circle cx="980" cy="420" r="5" />
            <circle cx="1490" cy="520" r="4" />
            <circle cx="540" cy="740" r="4" />
            <circle cx="1100" cy="720" r="5" />
            <circle cx="1710" cy="690" r="4" />
          </g>
        </svg>
      ) : null}
      <div className="global-chain-bg__hexband global-chain-bg__hexband--one" />
      <div className="global-chain-bg__hexband global-chain-bg__hexband--two" />
      {shouldShowCryptoLayer ? (
        <div
          ref={layerRef}
          className="global-chain-bg__crypto-layer"
          data-reduced-motion={reduceMotion ? "true" : "false"}
          data-low-power={lowPower ? "true" : "false"}
        >
          <div className="global-chain-bg__crypto-grid" />
          {cryptoConnectionLines.map((line, index) => {
            const style = {
              left: line.left,
              top: line.top,
              width: line.width,
              transform: `rotate(${line.rotate}deg)`,
              animationDuration: `${line.duration}s`,
              animationDelay: `${line.delay}s`,
            } satisfies CSSProperties;

            return (
              <span key={`crypto-link-${index}`} className="global-chain-bg__crypto-connection" style={style}>
                <span className="global-chain-bg__crypto-connection-pulse" />
                <span className="global-chain-bg__crypto-data-packet" />
              </span>
            );
          })}
          {cryptoNodes.map((node, index) => {
            const style = {
              left: node.left,
              top: node.top,
              width: `${node.size}px`,
              height: `${node.size}px`,
              animationDelay: `${node.delay}s`,
            } satisfies CSSProperties;
            return <span key={`crypto-node-${index}`} className="global-chain-bg__crypto-node" style={style} />;
          })}
          {cryptoDust.map((dust, index) => {
            const style = {
              left: dust.left,
              top: dust.top,
              width: `${dust.size}px`,
              height: `${dust.size}px`,
              animationDuration: `${dust.duration}s`,
              animationDelay: `${dust.delay}s`,
            } satisfies CSSProperties;
            return <span key={`crypto-dust-${index}`} className="global-chain-bg__crypto-dust" style={style} />;
          })}
          {floatingCoins.map((item, index) => {
            const style = {
              left: item.left,
              top: item.top,
              width: `${item.size}px`,
              height: `${item.size}px`,
              animationDuration: `${item.duration}s`,
              animationDelay: `${item.delay}s`,
              "--coin-drift-x": `${item.driftX}px`,
              "--coin-drift-y": `${item.driftY}px`,
              "--coin-rotate": `${item.rotate}deg`,
              "--coin-opacity": `${item.opacity}`,
              "--coin-parallax-factor": `${item.parallax}`,
            } as CSSProperties;

            return (
              <span key={`${item.coin}-${index}`} className={`global-chain-bg__crypto-coin global-chain-bg__crypto-coin--${item.coin}`} style={style}>
                <CoinLogo coin={item.coin} />
              </span>
            );
          })}
        </div>
      ) : null}
      {visiblePulseLines.map((line, index) => {
        const style = {
          left: line.left,
          top: line.top,
          width: line.width,
          transform: `rotate(${line.rotate}deg)`,
          animationDelay: `${line.delay}s`,
          animationDuration: `${line.duration}s`,
        } satisfies CSSProperties;
        return <div key={`pulse-line-${index}`} className="global-chain-bg__pulse-line" style={style} />;
      })}
      {visibleParticles.map((particle, index) => {
        const style = {
          left: particle.left,
          top: particle.top,
          width: `${particle.size}px`,
          height: `${particle.size}px`,
          animationDuration: `${particle.duration}s`,
          animationDelay: `${particle.delay}s`,
        } satisfies CSSProperties;
        return <span key={`particle-${index}`} className="global-chain-bg__particle" style={style} />;
      })}
    </div>
  );
}
