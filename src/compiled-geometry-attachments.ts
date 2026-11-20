import type { Mesh } from 'manifold-3d';
import { wingInstance, type AircraftDefinition } from './model';
import type { ClosedMesh } from './compiled-geometry-mesh';
import type { CompiledAttachmentSpan, CompiledPartKind } from './compiled-geometry-cache';

export interface GeometryOrigin {
 wingInstance: number; side: number; kind: CompiledPartKind; sourceIndex: number; supportWingInstance: number; movable: boolean; input?: ClosedMesh;
}

/** Read actual subtraction faces and their original triangles, not projected proximity. */
export function attachmentSpans(d: AircraftDefinition, receiver: GeometryOrigin, originals: ReadonlySet<number>, mesh: Mesh,
 coordinates: Float32Array, origins: ReadonlyMap<number, GeometryOrigin>,
 rootRange: (child: GeometryOrigin, parent: GeometryOrigin, onFin: boolean) => { spanStart: number; spanEnd: number } | undefined): CompiledAttachmentSpan[] {
 if (receiver.wingInstance < 0 || receiver.movable) return [];
 const spans = new Map<string, { span: CompiledAttachmentSpan; vertices: Set<number> }>();
 const tip = Math.abs(d.verticalTail.points[1].y);
 const add = (origin: GeometryOrigin, min: number, max: number, onFin: boolean, vertices: readonly number[] = []) => {
  const half = Math.abs(wingInstance(d, origin.wingInstance).wing.points[1].y);
  const key = `${origin.wingInstance},${origin.side},${onFin ? 2 : -1}`;
  let entry = spans.get(key);
  if (!entry) {
   entry = { span: { wingInstance: origin.wingInstance, side: origin.side, spanStart: half, spanEnd: 0,
    anchorWingInstance: onFin ? 2 : -1, anchorSide: onFin ? 1 : 0, anchorSpan: onFin ? tip : 0 }, vertices: new Set() };
   spans.set(key, entry);
  }
  entry.span.spanStart = Math.min(entry.span.spanStart, Math.max(0, min)); entry.span.spanEnd = Math.max(entry.span.spanEnd, Math.min(half, max));
  for (const vertex of vertices) entry.vertices.add(vertex);
 };
 for (let run = 0; run < mesh.runOriginalID.length; run++) {
  if (!mesh.backside(run)) continue;
  const parent = origins.get(mesh.runOriginalID[run]);
  if (!parent || parent.movable) continue;
  const tailFin = !!d.assembly.tailOnFin && (receiver.wingInstance === 1 && parent.wingInstance === 2 || receiver.wingInstance === 2 && parent.wingInstance === 1);
  const body = !(receiver.wingInstance === 1 && d.assembly.tailOnFin) && (parent.kind === 'fuselage' || parent.kind === 'cockpit'
   || parent.kind === 'canopy' || parent.kind === 'nose' || parent.kind === 'wing-support' && parent.supportWingInstance === receiver.wingInstance);
  if (!tailFin && !body) continue;
  const root = rootRange(receiver, parent, tailFin);
  if (!root) continue;
  for (let i = mesh.runIndex[run]; i < mesh.runIndex[run + 1]; i += 3) {
   const vertices = [mesh.triVerts[i], mesh.triVerts[i + 1], mesh.triVerts[i + 2]];
   const values = vertices.map(vertex => coordinates[vertex * 3]);
   if (Math.max(...values) < root.spanStart - 2e-6 || Math.min(...values) > root.spanEnd + 2e-6) continue;
   add(receiver, Math.min(...values), Math.max(...values), tailFin, vertices);
   if (!tailFin || !parent.input?.coordinates) continue;
   // Face IDs encode the original input triangle. Include its complete span,
   // including the winner whose skin was not split by this Boolean operation.
   const first = (mesh.faceID[i / 3] >>> 1) * 3, indices = parent.input.indices, local = parent.input.coordinates;
   if (first + 2 >= indices.length) throw Error('Attachment cap lost its original triangle');
   const a = local[indices[first] * 3], b = local[indices[first + 1] * 3], c = local[indices[first + 2] * 3];
   const parentRoot = rootRange(parent, receiver, true);
   if (!parentRoot || Math.max(a, b, c) < parentRoot.spanStart - 2e-6 || Math.min(a, b, c) > parentRoot.spanEnd + 2e-6) continue;
   add(parent, Math.min(a, b, c), Math.max(a, b, c), true);
  }
 }
 // Include adjacent original receiver skin triangles, so no triangle interpolates
 // between two attachment frames through the interior of a shared interface.
 for (const entry of spans.values()) {
  if (entry.span.wingInstance !== receiver.wingInstance || entry.span.side !== receiver.side) continue;
  for (let run = 0; run < mesh.runOriginalID.length; run++) {
   if (!originals.has(mesh.runOriginalID[run])) continue;
   for (let i = mesh.runIndex[run]; i < mesh.runIndex[run + 1]; i += 3) {
    if (!(mesh.faceID[i / 3] & 1)) continue;
    const a = mesh.triVerts[i], b = mesh.triVerts[i + 1], c = mesh.triVerts[i + 2];
    if (!entry.vertices.has(a) && !entry.vertices.has(b) && !entry.vertices.has(c)) continue;
    entry.span.spanStart = Math.min(entry.span.spanStart, coordinates[a * 3], coordinates[b * 3], coordinates[c * 3]);
    entry.span.spanEnd = Math.max(entry.span.spanEnd, coordinates[a * 3], coordinates[b * 3], coordinates[c * 3]);
    const input = origins.get(mesh.runOriginalID[run])?.input, first = (mesh.faceID[i / 3] >>> 1) * 3;
    if (input?.coordinates && first + 2 < input.indices.length) {
     const local = input.coordinates, ia = local[input.indices[first] * 3], ib = local[input.indices[first + 1] * 3], ic = local[input.indices[first + 2] * 3];
     entry.span.spanStart = Math.min(entry.span.spanStart, ia, ib, ic); entry.span.spanEnd = Math.max(entry.span.spanEnd, ia, ib, ic);
    }
   }
  }
 }
 return [...spans.values()].map(({ span }) => {
  const half = Math.abs(wingInstance(d, span.wingInstance).wing.points[1].y);
  return { ...span, spanStart: span.anchorWingInstance === -1 || span.wingInstance === 1 ? 0 : Math.max(0, span.spanStart), spanEnd: Math.min(half, span.spanEnd) };
 });
}
