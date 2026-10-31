/** 单一发动机目录：尺寸m、质量kg、推力N、耗油L/s、转速响应s；游戏工程参数，非厂商性能声明。 */
export const engineCatalog = {
  'jet-01': {
    name: 'J-180 微型喷气发动机',
    mass: 4.5,
    maxThrust: 180,
    length: 0.55,
    radius: 0.14,
    fuelFlow: 0.012,
    spoolTime: 1.8,
  },
} as const;
export type EngineType = keyof typeof engineCatalog;
export const FUEL_DENSITY = 0.8;
