"use client";

import { useEffect, useRef } from "react";

/** Small decorative canvas; pauses off-screen, in background tabs and for reduced motion. */
export function NetworkGlobe() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = true;
    let previous = 0;
    let rotation = 0;
    const nodes = Array.from({ length: 72 }, (_, i) => {
      const y = 1 - (i / 71) * 2;
      const radius = Math.sqrt(1 - y * y) * (i % 13 === 0 ? 1.25 : 1);
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
    });
    function draw(now: number) {
      if (!context || !canvas) return;
      if (now - previous < 34 && !media.matches) { frame = requestAnimationFrame(draw); return; }
      previous = now;
      context.clearRect(0, 0, 480, 360);
      rotation += media.matches ? 0 : 0.003;
      const projected = nodes.map((node, i) => {
        const z = node.z * Math.cos(rotation) + node.x * Math.sin(rotation);
        const x = node.x * Math.cos(rotation) - node.z * Math.sin(rotation);
        // Stagger births and fades so new connections form while old rear nodes disappear.
        const phase = (rotation * 0.16 + i * 0.618) % 1;
        const lifetime = Math.min(1, phase / 0.12, (1 - phase) / 0.25);
        return { x: 260 + x * 140, y: 180 + node.y * 140, alpha: Math.max(0.03, (z + 1.1) / 2.5) * lifetime };
      });
      projected.forEach((node, i) => {
        projected.slice(i + 1).forEach((other) => {
          const distance = Math.hypot(other.x - node.x, other.y - node.y);
          if (distance > 68) return;
          context.strokeStyle = `rgba(212,175,55,${Math.min(node.alpha, other.alpha) * 0.3 * (1 - distance / 68)})`;
          context.beginPath(); context.moveTo(node.x, node.y); context.lineTo(other.x, other.y); context.stroke();
        });
        context.fillStyle = `rgba(224,194,104,${node.alpha})`;
        context.beginPath(); context.arc(node.x, node.y, 1.8, 0, Math.PI * 2); context.fill();
      });
      if (visible && !document.hidden && !media.matches) frame = requestAnimationFrame(draw);
    }
    const resume = () => { cancelAnimationFrame(frame); if (visible && !document.hidden) draw(performance.now()); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", resume);
    media.addEventListener("change", resume);
    resume();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", resume); media.removeEventListener("change", resume); };
  }, []);
  return <canvas ref={ref} width={480} height={360} className="pointer-events-none absolute -right-20 -top-12 h-72 w-96 opacity-45 sm:right-0 sm:h-80 sm:w-[28rem]" aria-hidden="true" />;
}
