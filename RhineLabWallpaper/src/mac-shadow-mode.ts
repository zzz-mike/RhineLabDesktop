export type MacShadowMode = 'off' | 'original' | 'texture';
export const normalizeShadowMode = (value: unknown): MacShadowMode =>
  value === 'original' || value === 'texture' ? value : 'off';
/** Explicit Mac selection wins over legacy quality/power-saving shadow switches. */
export function shadowPolicy(mode: MacShadowMode | null, resolution: number, superPerformance: boolean) {
  const original = mode === null ? resolution > 0 && !superPerformance : mode === 'original';
  return { original, projected: mode === 'texture', aoAllowed: mode === null || mode === 'original',
    resolution: original ? resolution || 2048 : 0 };
}
