import { closeMesh, type ClosedMesh } from './compiled-geometry-mesh';

export type EnginePart = 'housing' | 'nozzle' | 'intake' | 'exhaust-back' | 'rim' | 'hub';
/** Normalized by engine length along X and radius in Y/Z, shared with the design mesh. */
export const ENGINE_GEOMETRY = {
 segments: 20, wall: 0.035,
 housing: { frontX: 0.5, rearX: -0.3, frontRadius: 1, rearRadius: 0.82 },
 nozzle: { frontX: -0.3, rearX: -0.5, frontRadius: 0.82, rearRadius: 0.55 },
 intake: { x: 0.401, radius: 0.92, thickness: 0.005 },
 exhaustBack: { x: -0.295, radius: 0.82, thickness: 0.005 },
 rim: { x: 0.465, radius: 0.96, tube: 0.035, segments: 6 },
 hub: { x: 0.44, radius: 0.24, length: 0.12, segments: 12 },
} as const;

/** Revolve a closed material cross-section, not a filled exterior silhouette. */
function revolvedMesh(profile: readonly (readonly [number, number])[], segments: number,
 length: number, radius: number, center: { x: number; y: number; z: number }): ClosedMesh {
 const points: { x: number; y: number; z: number }[] = [], indices: number[] = [];
 for (const [x, r] of profile) for (let j = 0; j < segments; j++) {
  const angle = j * 2 * Math.PI / segments;
  points.push({ x: center.x + x * length, y: center.y + r * Math.cos(angle) * radius, z: center.z + r * Math.sin(angle) * radius });
 }
 for (let row = 0; row < profile.length; row++) for (let j = 0; j < segments; j++) {
  const a = row * segments + j, b = row * segments + (j + 1) % segments;
  const c = (row + 1) % profile.length * segments + j, e = (row + 1) % profile.length * segments + (j + 1) % segments;
  indices.push(a, b, c, b, e, c);
 }
 return closeMesh(points, indices);
}

export function engineMeshes(length: number, radius: number, center: { x: number; y: number; z: number }): { part: EnginePart; mesh: ClosedMesh }[] {
 const g = ENGINE_GEOMETRY, result: { part: EnginePart; mesh: ClosedMesh }[] = [];
 for (const part of ['housing', 'nozzle'] as const) {
  const p = g[part];
  result.push({ part, mesh: revolvedMesh([[p.frontX, p.frontRadius], [p.rearX, p.rearRadius],
   [p.rearX, p.rearRadius - g.wall], [p.frontX, p.frontRadius - g.wall]], g.segments, length, radius, center) });
 }
 for (const part of ['intake', 'exhaust-back'] as const) {
  const p = part === 'intake' ? g.intake : g.exhaustBack, inside = p.x + (part === 'intake' ? -p.thickness : p.thickness);
  result.push({ part, mesh: revolvedMesh([[p.x, p.radius], [inside, p.radius], [inside, 0], [p.x, 0]], g.segments, length, radius, center) });
 }
 const rim: [number, number][] = [];
 for (let j = 0; j < g.rim.segments; j++) {
  const angle = j * 2 * Math.PI / g.rim.segments;
  rim.push([g.rim.x + g.rim.tube * Math.sin(angle), g.rim.radius + g.rim.tube * Math.cos(angle)]);
 }
 result.push({ part: 'rim', mesh: revolvedMesh(rim, g.segments, length, radius, center) });
 result.push({ part: 'hub', mesh: revolvedMesh([[g.hub.x + g.hub.length / 2, 0],
  [g.hub.x - g.hub.length / 2, g.hub.radius], [g.hub.x - g.hub.length / 2, 0]], g.hub.segments, length, radius, center) });
 return result;
}
