/** 单一发动机目录：尺寸m、质量kg、推力N、耗油L/s、转速响应s；游戏工程参数，非厂商性能声明。 */
export const engineCatalog = {
  'jet-01': {
    name: 'J-360 微型喷气发动机',
    mass: 4.5,
    maxThrust: 360,
    /** 等效排气速度，供低亚声速净推力模型使用。 */
    exhaustVelocity: 500,
    length: 0.55,
    radius: 0.14,
    fuelFlow: 0.012,
    spoolTime: 1.8,
  },
} as const;
export type EngineType = keyof typeof engineCatalog;
export const FUEL_DENSITY = 0.8;

/** NASA对流层标准日密度比；11km以上连续接等温层，海平面以下使用额定条件。 */
export function engineDensityRatio(altitude: number): number {
  const height = Math.max(0, altitude), tropopause = 11_000;
  const temperatureRatio = 1 - 0.00649 * Math.min(height, tropopause) / 288.14;
  return temperatureRatio ** 4.256 * Math.exp(-Math.max(0, height - tropopause) * 0.000157);
}

/** F=ṁ(Ve−V0)，ṁ按密度缩放；额定静推力对应海平面、无进气冲压阻力。 */
export function engineThrustFactor(altitude: number, axialAirspeed: number, exhaustVelocity: number): number {
  return engineDensityRatio(altitude) * Math.max(0, 1 - Math.max(0, axialAirspeed) / exhaustVelocity);
}
