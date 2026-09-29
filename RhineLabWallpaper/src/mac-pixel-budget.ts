import type { RenderQuality } from './render-quality';
export type MacDisplay = { scale: number | null; antialias: boolean };
export function normalizeMacDisplay(value: unknown): MacDisplay {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { scale: typeof v.scale === 'number' && Number.isFinite(v.scale)
    ? Math.max(50, Math.min(150, Math.round(v.scale / 5) * 5)) : null,
    antialias: v.antialias !== false };
}
export function manualDisplayQuality(quality: RenderQuality, display: MacDisplay | null, deviceRatio: number) {
  return display?.scale != null ? { ...quality, scale: display.scale, pixelRatio: Math.max(1, deviceRatio),
    antialias: display.antialias ? 'smaa' as const : 'off' as const } : quality;
}
/** Keep animation and material settings; reduce only 3D render-target dimensions. */
export function macPixelBudget(quality: RenderQuality, enabled: boolean, upstreamBudget: number, display: MacDisplay | null = null, deviceRatio = 1) {
  if (display?.scale != null) return { quality: manualDisplayQuality(quality, display, deviceRatio), budget: 8_294_400 };
  return {
    quality: enabled ? { ...quality, scale: quality.scale * 0.7 } : quality,
    budget: enabled ? Math.min(upstreamBudget, 921_600) : upstreamBudget,
  };
}
