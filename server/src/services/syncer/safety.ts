/** Reject ambiguous order sizes instead of silently turning them into one contract. */
export function mirroredQuantity(orderQty: unknown, multiplier: unknown): number | null {
  if (typeof orderQty !== 'number' || !Number.isSafeInteger(orderQty) || orderQty <= 0) return null;
  if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) return null;
  const result = Math.floor(orderQty * multiplier);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function validLimitPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
