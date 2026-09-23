import styles from "./login-atmosphere.module.css";

/** Decorative only: no canvas loop, network request, or input interception. */
export function LoginAtmosphere() {
  return (
    <div className={styles.atmosphere} aria-hidden="true">
      <div className={styles.glow} />
      <div className={styles.grid} />
      <svg className={styles.circuit} viewBox="0 0 800 1000" fill="none" preserveAspectRatio="xMidYMid slice">
        <g className={styles.wires}>
          <path d="M0 100H110L180 170V290L255 365 M0 250H65L130 315V470 M800 130H685L625 190V295L550 370 M800 330H735L680 385V490 M0 810H105L170 745V635L245 560 M800 880H690L620 810V705L545 630 M65 0V80L220 235 M735 0V80L580 235 M70 1000V890L220 740 M735 1000V920L580 765" />
          <path d="M0 165H85L140 220V330 M800 220H720L665 275V330 M0 900H120L205 815V710 M800 790H740L680 730V650" />
        </g>
        <g className={styles.energy}>
          <path d="M0 100H110L180 170V290L255 365 M800 130H685L625 190V295L550 370 M0 810H105L170 745V635L245 560 M800 880H690L620 810V705L545 630" pathLength="100" />
        </g>
        <g className={styles.nodes}>
          {[[180, 170], [130, 470], [625, 190], [680, 490], [170, 635], [620, 705], [220, 235], [580, 765]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <rect x={x - 9} y={y - 9} width="18" height="18" rx="4" />
              <circle cx={x} cy={y} r="2.5" />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
