export function mergeUniquePages<T extends { id: string }>(pages: readonly (readonly T[])[]) {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const page of pages) {
    for (const item of page) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

export function nextPageOffset(
  pagination: { nextOffset: number | null },
  loadedPageCount: number,
  maxLoadedPages = 4,
) {
  if (loadedPageCount >= maxLoadedPages) return undefined;
  return pagination.nextOffset ?? undefined;
}
