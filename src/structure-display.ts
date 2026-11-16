/** Shared load scale for HUD bars and wing vertex colors. */
export function structureLoadColor(ratio: number): number {
 if (ratio <= 0.5) return 0x397d85;
 const t = Math.max(0, Math.min(1, (ratio - 0.5) * 2));
 const a = t < 0.5 ? 0xeac127 : 0xe88423, b = t < 0.5 ? 0xe88423 : 0xc9302b;
 const f = t < 0.5 ? t * 2 : (t - 0.5) * 2;
 const r = Math.round((a >> 16) * (1 - f) + (b >> 16) * f);
 const g = Math.round(((a >> 8) & 255) * (1 - f) + ((b >> 8) & 255) * f);
 const blue = Math.round((a & 255) * (1 - f) + (b & 255) * f);
 return r << 16 | g << 8 | blue;
}
