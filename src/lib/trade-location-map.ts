export const MAP_TILE_SIZE = 256;
export function mapWorldPoint(latitude: number, longitude: number, zoom: number) {
  const size = MAP_TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
  return { x: (longitude + 180) / 360 * size, y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * size };
}
export function mapCoordinates(x: number, y: number, zoom: number) {
  const size = MAP_TILE_SIZE * 2 ** zoom;
  const wrapX = ((x % size) + size) % size;
  const boundY = Math.max(0, Math.min(size, y));
  return { latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * boundY / size))) * 180 / Math.PI, longitude: wrapX / size * 360 - 180 };
}
