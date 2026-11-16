export const STICK_DEADZONE = 0.05;
export function stickPosition(x: number, y: number) {
 const length = Math.hypot(x, y), limit = Math.max(1, length);
 const gain = length > STICK_DEADZONE ? Math.min(1, (length - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / length : 0;
 return { x: x / limit, y: y / limit, roll: x * gain, pitch: y * gain };
}
