"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./app-login-network.module.css";

const streams = ["010110100101", "101001101010", "001011010011", "110100101100", "011010010101", "100101101001", "010011010110"];
const satellites = [
  { x: 120, y: 157, symbol: "₿" },
  { x: 255, y: 85, symbol: "Ξ" },
  { x: 586, y: 88, symbol: "₮" },
  { x: 720, y: 156, symbol: "₿" },
];

/** Decorative app-only scene. No market data, network calls, or canvas loop. */
export function AppLoginNetwork() {
  const id = useId();
  const scene = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);

  useEffect(() => {
    const updateVisibility = () => setForeground(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting), { rootMargin: "40px" },
    );
    if (scene.current && observer) observer.observe(scene.current);
    if (!observer) setVisible(true);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  return (
    <div ref={scene} className={styles.scene} aria-hidden="true" data-app-login-network data-animate={visible && foreground ? "true" : "false"}>
      <div className={styles.aura} />
      <div className={styles.matrix} dir="ltr">
        {streams.map((digits, index) => <span key={digits} style={{ left: `${9 + index * 13.5}%`, animationDelay: `${-index * 1.7}s`, animationDuration: `${9 + index % 3 * 2}s` }}>{digits}</span>)}
      </div>
      <svg className={styles.network} viewBox="0 0 840 280" fill="none">
        <defs>
          <linearGradient id={`${id}-gold`} x1="350" y1="60" x2="490" y2="195" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFE7A6" /><stop offset=".52" stopColor="#D2A845" /><stop offset="1" stopColor="#806026" />
          </linearGradient>
          <linearGradient id={`${id}-wire`} x1="70" y1="120" x2="770" y2="180" gradientUnits="userSpaceOnUse">
            <stop stopColor="#D4AF37" stopOpacity=".1" /><stop offset=".5" stopColor="#DDC17A" stopOpacity=".7" /><stop offset="1" stopColor="#56BFA7" stopOpacity=".15" />
          </linearGradient>
          <radialGradient id={`${id}-floor`}>
            <stop stopColor="#DFB954" stopOpacity=".16" /><stop offset="1" stopColor="#DFB954" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx="420" cy="200" rx="285" ry="63" fill={`url(#${id}-floor)`} />
        <g stroke="#C9A855" strokeOpacity=".1">
          <path d="M70 265 340 116M215 280 376 116M420 280V116M625 280 464 116M770 265 500 116M45 244H795M100 208H740M165 176H675M238 148H602" />
        </g>
        <g stroke={`url(#${id}-wire)`} strokeWidth="1.2">
          <path d="M120 157 230 213 420 155 611 213 720 156M255 85 330 111 420 155 510 111 586 88M230 213 310 245 420 210 532 245 611 213" />
        </g>
        <g className={styles.packets} stroke="#E8CF8A" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 28">
          <path pathLength="100" d="M120 157 230 213 420 155 611 213 720 156" />
          <path pathLength="100" d="M255 85 330 111 420 155 510 111 586 88" />
        </g>
        <ellipse cx="420" cy="200" rx="115" ry="30" stroke="#B99742" strokeOpacity=".25" />
        <ellipse className={styles.orbit} cx="420" cy="200" rx="131" ry="38" stroke="#67BDA5" strokeOpacity=".45" strokeDasharray="12 44 2 24" />
        {satellites.map(({ x, y, symbol }, index) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
            <g className={styles.satellite} style={{ animationDelay: `${-index * 1.2}s` }}>
              <path d="M0-25 29-9V24L0 41-29 24V-9Z" fill="#0C100D" stroke="#C9AC65" strokeOpacity=".44" />
              <path d="M-29-9 0 8 29-9M0 8V41" stroke="#C9AC65" strokeOpacity=".22" />
              <text x="0" y="-3" textAnchor="middle" fill={index === 2 ? "#77CBB1" : "#E2C580"} fontSize="18" fontFamily="sans-serif">{symbol}</text>
            </g>
          </g>
        ))}
        <g className={styles.core}>
          <path d="M420 58 478 92V157L420 191 362 157V92Z" fill="#11130E" stroke={`url(#${id}-gold)`} strokeWidth="1.6" />
          <path d="M420 58 478 92 420 126 362 92Z" fill="#D4AF37" fillOpacity=".11" />
          <path d="M420 126 478 92V157L420 191Z" fill="#61B69E" fillOpacity=".06" />
          <path d="M362 92 420 126 478 92M420 126V191" stroke={`url(#${id}-gold)`} strokeOpacity=".7" />
          <path d="M420 76 449 93 420 110 391 93Z" stroke="#EED69A" strokeOpacity=".6" />
          <circle cx="420" cy="93" r="3" fill="#FFE6A4" />
          <path d="M374 111V149L404 167M436 167 466 149V111" stroke="#D8BA6D" strokeOpacity=".32" />
        </g>
        <g fill="#F1D58B">
          <circle cx="230" cy="213" r="2.5" /><circle cx="611" cy="213" r="2.5" />
          <circle cx="330" cy="111" r="2" /><circle cx="510" cy="111" r="2" />
          <circle cx="310" cy="245" r="1.5" /><circle cx="532" cy="245" r="1.5" />
        </g>
      </svg>
      <div className={styles.signature} dir="ltr"><span /> ACADEMY <b>×</b> EXCHANGE <span /></div>
    </div>
  );
}
