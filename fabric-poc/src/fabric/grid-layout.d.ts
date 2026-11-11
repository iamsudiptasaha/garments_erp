type Column = { key: string; label: string };

/** @public */
export function fitGridColumns<T extends Column>(
  columns: T[],
  records: Record<string, unknown>[],
  available: number,
  widths: Record<string, number | null>,
): (T & { width: number })[];
