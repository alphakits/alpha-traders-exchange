"use client";
/* eslint-disable @next/next/no-img-element -- OSM tiles intentionally use direct browser caching and an origin-only Referer, not the Next image proxy. */

import { useRef, useState } from "react";
import { MapPin, Minus, Plus } from "lucide-react";
import { MAP_TILE_SIZE, mapCoordinates, mapWorldPoint } from "@/lib/trade-location-map";
import type { TradeChatLocation } from "@alpha-traders/contracts";
import { Button } from "@/components/ui/button";

/** On-demand picker. Browser cache is honored; only visible tiles are requested. */
export function TradeLocationMap({ initial, isAr, onSelect, disabled = false }: {
  initial?: TradeChatLocation; isAr: boolean; onSelect: (point: TradeChatLocation) => void; disabled?: boolean;
}) {
  // The composer owns the selected point; never retain an outdated GPS/manual center.
  const center = { latitude: initial?.latitude ?? 32, longitude: initial?.longitude ?? 35 };
  const [zoom, setZoom] = useState(initial ? 16 : 7);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; world: { x: number; y: number } } | null>(null);
  const world = mapWorldPoint(center.latitude, center.longitude, zoom);
  const choose = (x: number, y: number) => {
    if (disabled) return;
    const point = mapCoordinates(x, y, zoom);
    onSelect({ version: 1, ...point, source: "meeting_point" });
  };
  // A 320 x 256 fixed coordinate canvas, scaled to fit narrow phone chat panels.
  const width = 320, height = 256;
  const tiles: Array<{ key: string; x: number; y: number; left: number; top: number }> = [];
  const limit = 2 ** zoom;
  for (let x = Math.floor((world.x - width / 2) / MAP_TILE_SIZE); x <= Math.floor((world.x + width / 2) / MAP_TILE_SIZE); x++) {
    for (let y = Math.floor((world.y - height / 2) / MAP_TILE_SIZE); y <= Math.floor((world.y + height / 2) / MAP_TILE_SIZE); y++) {
      if (y >= 0 && y < limit) tiles.push({ key: `${zoom}/${x}/${y}`, x: (x % limit + limit) % limit, y, left: x * MAP_TILE_SIZE - world.x + width / 2, top: y * MAP_TILE_SIZE - world.y + height / 2 });
    }
  }
  return <div className="space-y-2">
    <p className="text-xs leading-5 text-gray-300">{isAr ? "اضغط على المكان أو اسحب الخريطة. العلامة بالوسط هي نقطة اللقاء؛ الإرسال بحاجة لتأكيدك." : "Tap a place or drag the map. The center pin is the meeting point; sending still requires confirmation."}</p>
    <div className="flex justify-center"><div className="relative aspect-[5/4] w-full max-w-[320px] overflow-hidden rounded-xl border border-white/20 bg-gray-800" role="group" aria-label={isAr ? "اختيار نقطة اللقاء" : "Choose a meeting point"}>
      <div tabIndex={disabled ? -1 : 0} aria-disabled={disabled} role="application" aria-label={isAr ? "خريطة نقطة اللقاء، استخدم أسهم لوحة المفاتيح للتحريك" : "Meeting point map. Use arrow keys to move."}
        className="absolute inset-0 touch-none outline-offset-[-3px] focus-visible:outline-2 focus-visible:outline-amber-300"
        onKeyDown={event => { if (disabled) return; const shifts: Record<string, [number, number]> = { ArrowLeft: [-50, 0], ArrowRight: [50, 0], ArrowUp: [0, -50], ArrowDown: [0, 50] }; const shift = shifts[event.key]; if (shift) { event.preventDefault(); choose(world.x + shift[0], world.y + shift[1]); } }}
        onPointerDown={event => { if (disabled || event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, world }; }}
        onPointerUp={event => {
          const start = drag.current; drag.current = null; if (!start || disabled) return;
          const box = event.currentTarget.getBoundingClientRect(); if (box.width <= 0 || box.height <= 0) return;
          const scaleX = width / box.width, scaleY = height / box.height;
          const dx = event.clientX - start.x, dy = event.clientY - start.y;
          if (Math.hypot(dx, dy) < 6) choose(world.x + (event.clientX - box.left) * scaleX - width / 2, world.y + (event.clientY - box.top) * scaleY - height / 2);
          else choose(start.world.x - dx * scaleX, start.world.y - dy * scaleY);
        }} onPointerCancel={() => { drag.current = null; }}>
        {tiles.map(tile => <img key={tile.key} src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} alt="" draggable={false} referrerPolicy="origin" width={256} height={256} onError={() => setFailed(true)}
          className="pointer-events-none absolute max-w-none select-none" style={{ left: `${tile.left / width * 100}%`, top: `${tile.top / height * 100}%`, width: `${256 / width * 100}%`, height: `${256 / height * 100}%` }} />)}
        <MapPin aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-full fill-amber-300 text-black drop-shadow" />
      </div>
      <div className="absolute end-2 top-2 flex flex-col gap-1">
        <Button type="button" variant="secondary" size="sm" aria-label={isAr ? "تكبير الخريطة" : "Zoom in"} disabled={disabled || zoom >= 18} onClick={() => setZoom(value => Math.min(18, value + 1))}><Plus aria-hidden="true" className="h-4 w-4" /></Button>
        <Button type="button" variant="secondary" size="sm" aria-label={isAr ? "تصغير الخريطة" : "Zoom out"} disabled={disabled || zoom <= 3} onClick={() => setZoom(value => Math.max(3, value - 1))}><Minus aria-hidden="true" className="h-4 w-4" /></Button>
      </div>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="absolute bottom-0 end-0 bg-white/95 px-1 text-[10px] leading-5 text-black">© OpenStreetMap contributors</a>
    </div></div>
    {failed ? <p role="status" className="text-xs text-amber-200">{isAr ? "تعذر تحميل جزء من الخريطة. جرّب موقعك الحالي أو أدخل إحداثيات نقطة اللقاء أدناه." : "Some map tiles could not load. Use your current location or enter the meeting coordinates below."}</p> : null}
  </div>;
}
