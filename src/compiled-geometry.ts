import Module, { type Manifold, type Mesh, type Box, type Vec3 } from 'manifold-3d';
import { Matrix4, Quaternion, Triangle, Vector3 } from 'three';
import { BODY_GEOMETRY, WING_CONTROL_LIMIT, aircraftWings, engineMounts, fuselageBeamRadius, fuselageEnds,
 mainWingSupport, cockpitGeometry, fuelTankDimensions, fuelTankPosition, wingControlAxis, wingControlHinge, wingInstance, wingInstancePoint, wingSupports, type AircraftDefinition, type BodyEllipsoid, type WingSupport } from './model';
import { engineCatalog } from './engines';
import { centeredMeshPositions, closeMesh, restoreSpanStations, wingCoordinates, wingMesh, type ClosedMesh } from './compiled-geometry-mesh';
import { engineMeshes } from './engine-geometry';
import { attachmentSpans, type GeometryOrigin } from './compiled-geometry-attachments';
import { geometryKey, getCompiledAircraft, installCompiledAircraft, type CompiledAircraft, type CompiledControl,
 type CompiledPartition, type CompiledPartKind, type CompiledSourceMesh, type CompiledGeometryFrame, type CompiledSourceCell, type CompiledAttachmentSpan } from './compiled-geometry-cache';
export { geometryKey, getCompiledAircraft, installCompiledAircraft } from './compiled-geometry-cache';
export type { CompiledAircraft, CompiledPartition, CompiledControl, CompiledPartKind, CompiledSourceMesh, CompiledAttachmentSpan } from './compiled-geometry-cache';

const api = await Module({ locateFile: () => new URL('../node_modules/manifold-3d/manifold.wasm', import.meta.url).href });
api.setup();
const RawManifold = api.Manifold.prototype.constructor as typeof api.Manifold;
const CLEARANCE = 2e-6;

type Source = {
 kind: CompiledPartKind; sourceIndex: number; wingInstance: number; side: number; supportWingInstance: number;
 materialId: CompiledPartition['materialId']; materialAmount: number; originalID: number; solid: Manifold;
 enginePart?: CompiledPartition['enginePart']; engineIndex?: number;
 support?: WingSupport; mesh?: ClosedMesh; frame?: CompiledGeometryFrame; vertices?: Float32Array; planes?: Float64Array;
};
type Piece = { source: Source; solid: Manifold; originalID: number; spanStart: number; spanEnd: number; movable: boolean; uStart?: number; uEnd?: number; input?: ClosedMesh; inputs?: { originalID: number; input: ClosedMesh }[] };
type Moving = Piece & { hinge: Vec3; axis: Vec3; limit: number; radius: number; bounds: Box; vertices: Float32Array };

/** One compilation owns every WASM handle, including failed operations. Mesh is plain JS. */
class Solids {
 private readonly handles = new Set<Manifold>();
 own(solid: Manifold): Manifold {
  this.handles.add(solid);
  const status = solid.status();
  if (status !== 'NoError') throw Error(`Manifold compilation failed: ${status}`);
  return solid;
 }
 release(solid: Manifold): void { if (this.handles.delete(solid)) solid.delete(); }
 close(): void { for (const solid of this.handles) solid.delete(); this.handles.clear(); }
 mesh(mesh: ClosedMesh, originalID: number): Manifold {
  const local = centeredMeshPositions(mesh.positions);
  const solid = this.own(new RawManifold(new api.Mesh({ numProp: 3, vertProperties: local.positions, triVerts: mesh.indices,
   runIndex: new Uint32Array([0, mesh.indices.length]), runOriginalID: new Uint32Array([originalID]),
   faceID: mesh.faceIDs.map((face, triangle) => triangle * 2 + (face & 1)) })));
  if (local.offset.every(value => value === 0)) return solid;
  const positioned = this.own(solid.translate(local.offset)); this.release(solid); return positioned;
 }
}


function overlap(a: Box, b: Box): boolean {
 return a.min.every((value, i) => value < b.max[i] && a.max[i] > b.min[i]);
}

function rotate(pool: Solids, moving: Moving, angle: number): Manifold {
 const quaternion = new Quaternion().setFromAxisAngle(new Vector3(...moving.axis), angle);
 const matrix = new Matrix4().makeRotationFromQuaternion(quaternion), pivot = new Vector3(...moving.hinge);
 const translation = pivot.clone().sub(pivot.clone().applyMatrix4(matrix)); matrix.setPosition(translation);
 return pool.own(moving.solid.transform(matrix.elements as Parameters<Manifold['transform']>[0]));
}

function travelSupport(moving: Moving, direction: Vector3, low: number, high: number, maximum: boolean, out: Vector3): void {
 const [px, py, pz] = moving.hinge, [ax, ay, az] = moving.axis;
 const cosLow = Math.cos(low), sinLow = Math.sin(low), cosHigh = Math.cos(high), sinHigh = Math.sin(high);
 let best = maximum ? -Infinity : Infinity;
 for (let i = 0; i < moving.vertices.length; i += 3) {
  const rx = moving.vertices[i] - px, ry = moving.vertices[i + 1] - py, rz = moving.vertices[i + 2] - pz;
  const parallel = rx * ax + ry * ay + rz * az;
  const bx = px + ax * parallel, by = py + ay * parallel, bz = pz + az * parallel;
  const cx = rx - ax * parallel, cy = ry - ay * parallel, cz = rz - az * parallel;
  const sx = ay * rz - az * ry, sy = az * rx - ax * rz, sz = ax * ry - ay * rx;
  const a = direction.x * cx + direction.y * cy + direction.z * cz, b = direction.x * sx + direction.y * sy + direction.z * sz;
  const base = direction.x * bx + direction.y * by + direction.z * bz;
  let cosine = cosLow, sine = sinLow, value = base + a * cosine + b * sine;
  const endpoint = base + a * cosHigh + b * sinHigh;
  if (maximum ? endpoint > value : endpoint < value) { value = endpoint; cosine = cosHigh; sine = sinHigh; }
  let extreme = Math.atan2(b, a) + (maximum ? 0 : Math.PI);
  if (extreme > Math.PI) extreme -= 2 * Math.PI;
  if (extreme >= low && extreme <= high) {
   const radius = Math.hypot(a, b), candidate = base + (maximum ? radius : -radius);
   if (radius > 0 && (maximum ? candidate > value : candidate < value)) {
    value = candidate; cosine = (maximum ? a : -a) / radius; sine = (maximum ? b : -b) / radius;
   }
  }
  if (maximum ? value > best : value < best) { best = value; out.set(bx + cx * cosine + sx * sine, by + cy * cosine + sy * sine, bz + cz * cosine + sz * sine); }
 }
}

function bodySupportPlanes(source: Source): Float64Array {
 if (source.planes) return source.planes;
 const mesh = source.solid.getMesh(), vertices = mesh.vertProperties, planes: number[] = [];
 const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
 for (let i = 0; i < mesh.triVerts.length; i += 3) {
  a.fromArray(vertices, mesh.triVerts[i] * 3); b.fromArray(vertices, mesh.triVerts[i + 1] * 3); c.fromArray(vertices, mesh.triVerts[i + 2] * 3);
  normal.crossVectors(b.sub(a), c.sub(a)).normalize(); let distance = -Infinity;
  for (let vertex = 0; vertex < vertices.length; vertex += 3) distance = Math.max(distance,
   normal.x * vertices[vertex] + normal.y * vertices[vertex + 1] + normal.z * vertices[vertex + 2]);
  planes.push(normal.x, normal.y, normal.z, distance);
 }
 source.planes = new Float64Array(planes); return source.planes;
}

/** A separating plane uses exact angular support extrema over every mesh vertex.
 * Bounded closest-point iterations only search for that plane; failure falls through
 * to the existing Manifold distance proof, never to a collision verdict. */
function continuousSeparatingPlane(moving: Moving, vertices: Float32Array, obstacleBounds: Box, other: Moving | undefined,
 low: number, high: number, otherLow: number, otherHigh: number, planes?: Float64Array): boolean {
 const nearest = new Vector3(), first = new Vector3(), second = new Vector3(), difference = new Vector3(), edge = new Vector3();
 const simplex: Vector3[] = [], active: number[] = [], origin = new Vector3(), candidate = new Vector3(), barycentric = new Vector3(), triangle = new Triangle();
 let scale = 1;
 for (let axis = 0; axis < 3; axis++) {
  nearest.setComponent(axis, (moving.bounds.min[axis] + moving.bounds.max[axis] - obstacleBounds.min[axis] - obstacleBounds.max[axis]) / 2);
  scale = Math.max(scale, Math.abs(moving.bounds.min[axis]), Math.abs(moving.bounds.max[axis]), Math.abs(obstacleBounds.min[axis]), Math.abs(obstacleBounds.max[axis]));
 }
 const roundoff = CLEARANCE + scale * 2 ** -23;
 if (nearest.lengthSq() < 1e-20) nearest.set(1, 0, 0);
 if (planes && !other) for (let i = 0; i < planes.length; i += 4) {
  edge.set(planes[i], planes[i + 1], planes[i + 2]); travelSupport(moving, edge, low, high, false, first);
  if (edge.dot(first) > planes[i + 3] + roundoff) return true;
 }
 for (let pass = 0; pass < 24; pass++) {
  travelSupport(moving, nearest, low, high, false, first);
  if (other) travelSupport(other, nearest, otherLow, otherHigh, true, second);
  else {
   let best = -Infinity;
   for (let i = 0; i < vertices.length; i += 3) {
    const value = nearest.x * vertices[i] + nearest.y * vertices[i + 1] + nearest.z * vertices[i + 2];
    if (value > best) { best = value; second.fromArray(vertices, i); }
   }
  }
  difference.copy(first).sub(second);
  const length = nearest.length();
  if (nearest.dot(difference) > roundoff * length) return true;
  if (length < 1e-12 || simplex.some(point => point.distanceToSquared(difference) < 1e-24)) return false;
  simplex.push(difference.clone());
  if (simplex.length === 4) {
   const a = simplex[0];
   edge.subVectors(simplex[1], a); first.subVectors(simplex[2], a); second.subVectors(simplex[3], a);
   difference.crossVectors(first, second); const determinant = edge.dot(difference);
   if (Math.abs(determinant) > 1e-24) {
    candidate.copy(a).negate();
    const u = candidate.dot(difference) / determinant, v = edge.dot(difference.crossVectors(candidate, second)) / determinant;
    const w = edge.dot(difference.crossVectors(first, candidate)) / determinant;
    if (u >= 0 && v >= 0 && w >= 0 && u + v + w <= 1) return false;
   }
  }
  let best = Infinity; active.length = 0;
  for (let i = 0; i < simplex.length; i++) {
   const squared = simplex[i].lengthSq();
   if (squared < best) { best = squared; nearest.copy(simplex[i]); active.splice(0, active.length, i); }
   for (let j = i + 1; j < simplex.length; j++) {
    edge.subVectors(simplex[j], simplex[i]); const edgeSquared = edge.lengthSq(); if (edgeSquared === 0) continue;
    const t = Math.max(0, Math.min(1, -simplex[i].dot(edge) / edgeSquared));
    candidate.copy(simplex[i]).addScaledVector(edge, t); const edgeDistance = candidate.lengthSq();
    if (edgeDistance < best) { best = edgeDistance; nearest.copy(candidate); active.splice(0, active.length, i, j); }
    for (let k = j + 1; k < simplex.length; k++) {
     triangle.set(simplex[i], simplex[j], simplex[k]); if (triangle.getArea() < 1e-20) continue;
     triangle.closestPointToPoint(origin, candidate); const faceDistance = candidate.lengthSq();
     if (faceDistance < best) {
      best = faceDistance; nearest.copy(candidate); triangle.getBarycoord(candidate, barycentric); active.length = 0;
      if (barycentric.x > 1e-12) active.push(i); if (barycentric.y > 1e-12) active.push(j); if (barycentric.z > 1e-12) active.push(k);
     }
    }
   }
  }
  const retained = active.map(index => simplex[index]); simplex.length = 0; simplex.push(...retained);
 }
 return false;
}

/** Distance is 1-Lipschitz in each moving body. This proves whole angle intervals,
 * not merely their sampled poses. Unresolved contact within 2 micrometres stays fixed. */
function continuousClear(pool: Solids, moving: Moving, obstacle: Manifold, other?: Moving, obstacleSource?: Source): boolean {
 const obstacleBounds = other?.bounds ?? obstacle.boundingBox();
 if (!overlap(moving.bounds, obstacleBounds)) return true;
 const vertices = other?.vertices ?? (obstacleSource ? obstacleSource.vertices ??= obstacle.getMesh().vertProperties : obstacle.getMesh().vertProperties);
 const planes = !other && obstacleSource && (obstacleSource.kind === 'fuselage' || obstacleSource.kind === 'cockpit' || obstacleSource.kind === 'canopy' || obstacleSource.kind === 'nose')
  ? bodySupportPlanes(obstacleSource) : undefined;
 const intersects = (a: Manifold, b: Manifold): boolean => {
  if (!overlap(a.boundingBox(), b.boundingBox())) return false;
  const intersection = pool.own(a.intersect(b));
  try { return intersection.volume() > 1e-15; } finally { pool.release(intersection); }
 };
 const visit = (lo: number, hi: number, otherLo: number, otherHi: number, depth: number): boolean => {
  if (continuousSeparatingPlane(moving, vertices, obstacleBounds, other, lo, hi, otherLo, otherHi, planes)) return true;
  // One actual intersecting pose disproves full travel. These probes never
  // certify safety; interval-wide support/distance bounds still do that.
  if (depth === 0) for (const angles of other ? [[lo, otherLo], [lo, otherHi], [hi, otherLo], [hi, otherHi]] : [[lo, 0], [hi, 0]]) {
   const first = rotate(pool, moving, angles[0]), second = other ? rotate(pool, other, angles[1]) : obstacle;
   try { if (intersects(first, second)) return false; }
   finally { pool.release(first); if (other) pool.release(second); }
  }
  const middle = (lo + hi) / 2, otherMiddle = (otherLo + otherHi) / 2;
  const a = rotate(pool, moving, middle), b = other ? rotate(pool, other, otherMiddle) : obstacle;
  try {
   if (intersects(a, b)) return false;
   const distanceA = 2 * moving.radius * Math.sin((hi - lo) / 4);
   const distanceB = other ? 2 * other.radius * Math.sin((otherHi - otherLo) / 4) : 0;
   const bound = distanceA + distanceB;
   const gap = a.minGap(b, bound + CLEARANCE * 2);
   if (gap > bound + CLEARANCE) return true;
   if (gap <= CLEARANCE || depth === 22) return false;
   if (distanceA >= distanceB) return visit(lo, middle, otherLo, otherHi, depth + 1) && visit(middle, hi, otherLo, otherHi, depth + 1);
   return visit(lo, hi, otherLo, otherMiddle, depth + 1) && visit(lo, hi, otherMiddle, otherHi, depth + 1);
  } finally { pool.release(a); if (other) pool.release(b); }
 };
 return visit(-moving.limit, moving.limit, other ? -other.limit : 0, other ? other.limit : 0, 0);
}

function movingPiece(d: AircraftDefinition, piece: Piece): Moving {
 const { key } = wingInstance(d, piece.source.wingInstance);
 const hinge = wingControlHinge(d, piece.source.wingInstance, piece.source.side, 0, new Vector3());
 const axis = wingControlAxis(d, piece.source.wingInstance, piece.source.side, new Vector3());
 const limit = key === 'verticalTail' ? WING_CONTROL_LIMIT.vertical : WING_CONTROL_LIMIT.horizontal;
 const bounds: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
 const mesh = piece.solid.getMesh(); let radius = 0;
 const relative = new Vector3(), parallel = new Vector3(), radial = new Vector3(), sine = new Vector3(), base = new Vector3();
 for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
  relative.fromArray(mesh.vertProperties, i).sub(hinge);
  parallel.copy(axis).multiplyScalar(relative.dot(axis)); radial.copy(relative).sub(parallel);
  sine.crossVectors(axis, radial); base.copy(hinge).add(parallel); radius = Math.max(radius, radial.length());
  for (let component = 0; component < 3; component++) {
   const a = radial.getComponent(component), b = sine.getComponent(component), offset = base.getComponent(component);
   const extreme = Math.atan2(b, a), angles = [-limit, limit, 0];
   for (const angle of [extreme, extreme - Math.PI, extreme + Math.PI]) if (angle >= -limit && angle <= limit) angles.push(angle);
   for (const angle of angles) {
    const value = offset + a * Math.cos(angle) + b * Math.sin(angle);
    bounds.min[component] = Math.min(bounds.min[component], value - CLEARANCE);
    bounds.max[component] = Math.max(bounds.max[component], value + CLEARANCE);
   }
  }
 }
 return { ...piece, hinge: hinge.toArray() as Vec3, axis: axis.toArray() as Vec3, limit, radius, bounds, vertices: mesh.vertProperties };
}

function wingFrame(d: AircraftDefinition, id: number, side: number): CompiledGeometryFrame {
 const origin = wingInstancePoint(d, id, side, 0, 0.25, 0, new Vector3()), instance = wingInstance(d, id);
 // Keep the shared miter plane axis-aligned through Float32 quantization.
 // Dihedral/cant live in the shape; only horizontal installation incidence is rigid.
 const matrix = instance.key === 'verticalTail' ? new Matrix4() : new Matrix4().makeRotationZ(instance.incidence * Math.PI / 180);
 return { matrix: matrix.setPosition(origin).toArray() };
}

/** Quantize in the installation frame before applying the rigid pose. */
function wingSolid(d: AircraftDefinition, pool: Solids, source: Pick<Source, 'wingInstance' | 'side' | 'frame'>,
 start: number, end: number, from: number, to: number, originalID: number): { input: ClosedMesh; solid: Manifold } {
 const matrix = new Matrix4().fromArray(source.frame!.matrix);
 const input = wingMesh(d, source.wingInstance, source.side, start, end, from, to, matrix.clone().invert());
 const local = pool.mesh(input, originalID), solid = pool.own(local.transform(matrix.elements as Parameters<Manifold['transform']>[0]));
 pool.release(local); return { input, solid };
}

function wingCells(d: AircraftDefinition, source: Source, mesh: ClosedMesh): CompiledSourceCell[] {
 const { wing: w, key } = wingInstance(d, source.wingInstance), half = Math.abs(w.points[1].y), cells: CompiledSourceCell[] = [];
 const hinge = wingControlHinge(d, source.wingInstance, source.side, 0, new Vector3());
 const axis = wingControlAxis(d, source.wingInstance, source.side, new Vector3());
 const limit = key === 'verticalTail' ? WING_CONTROL_LIMIT.vertical : WING_CONTROL_LIMIT.horizontal;
 const relative = new Vector3(), parallel = new Vector3(), radial = new Vector3(), sine = new Vector3(), base = new Vector3();
 for (let index = 0; index * 0.8 < half - 1e-9; index++) {
  const spanStart = index * 0.8, spanEnd = Math.min(spanStart + 0.8, half);
  const bounds: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  const motionBounds: Box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < mesh.positions.length; i += 3) {
   const span = mesh.coordinates![i];
   if (span < spanStart - 0.200001 || span > spanEnd + 0.200001) continue;
   for (let component = 0; component < 3; component++) {
    const value = mesh.positions[i + component];
    bounds.min[component] = Math.min(bounds.min[component], value); bounds.max[component] = Math.max(bounds.max[component], value);
    motionBounds.min[component] = Math.min(motionBounds.min[component], value - CLEARANCE);
    motionBounds.max[component] = Math.max(motionBounds.max[component], value + CLEARANCE);
   }
   if (!(w.controlSurface > 0) || mesh.coordinates![i + 1] < 1 - w.controlSurface - 1e-9) continue;
   relative.fromArray(mesh.positions, i).sub(hinge); parallel.copy(axis).multiplyScalar(relative.dot(axis));
   radial.copy(relative).sub(parallel); sine.crossVectors(axis, radial); base.copy(hinge).add(parallel);
   for (let component = 0; component < 3; component++) {
    const a = radial.getComponent(component), b = sine.getComponent(component), offset = base.getComponent(component), extreme = Math.atan2(b, a);
    for (const angle of [-limit, limit, 0, extreme, extreme - Math.PI, extreme + Math.PI]) {
     if (angle < -limit || angle > limit) continue;
     const value = offset + a * Math.cos(angle) + b * Math.sin(angle);
     motionBounds.min[component] = Math.min(motionBounds.min[component], value - CLEARANCE);
     motionBounds.max[component] = Math.max(motionBounds.max[component], value + CLEARANCE);
    }
   }
  }
  cells.push({ spanStart, spanEnd, bounds, motionBounds });
 }
 return cells;
}


/** Each circular vertex arc lies inside the endpoint sector scaled by sec(halfAngle).
 * The union of these small convex hulls therefore encloses continuous travel. Only
 * the same wing's hinge/strip seams are cut with this envelope; other bodies use exact distance queries. */
function hingeSweep(pool: Solids, moving: Moving): Manifold {
 const positions = moving.input!.positions, parts: Manifold[] = [], intervals = Math.ceil(2 * moving.limit / (4 * Math.PI / 180));
 const matrix = new Matrix4().fromArray(moving.source.frame!.matrix), inverse = matrix.clone().invert();
 const pivot = new Vector3(...moving.hinge).applyMatrix4(inverse);
 const axis = new Vector3(...moving.axis).transformDirection(inverse).multiplyScalar(Math.sign(matrix.determinant()));
 const relative = new Vector3(), parallel = new Vector3(), radial = new Vector3(), rotated = new Vector3();
 for (let interval = 0; interval < intervals; interval++) {
  const start = -moving.limit + interval * 2 * moving.limit / intervals, end = -moving.limit + (interval + 1) * 2 * moving.limit / intervals;
  const scale = 1 / Math.cos((end - start) / 2), points: Vec3[] = [];
  for (let i = 0; i < positions.length; i += 3) {
   relative.fromArray(positions, i).sub(pivot); parallel.copy(axis).multiplyScalar(relative.dot(axis)); radial.copy(relative).sub(parallel);
   for (const angle of [start, end]) for (const factor of [1, scale]) {
    rotated.copy(radial).multiplyScalar(factor).applyAxisAngle(axis, angle).add(parallel).add(pivot);
    points.push([rotated.x, rotated.y, rotated.z]);
   }
  }
  parts.push(pool.own(api.Manifold.hull(points)));
 }
 const sweep = pool.own(api.Manifold.union(parts)); for (const part of parts) pool.release(part);
 const world = pool.own(sweep.transform(matrix.elements as Parameters<Manifold['transform']>[0])); pool.release(sweep); return world;
}

function addSources(d: AircraftDefinition, pool: Solids, changed?: ReadonlySet<number>): Source[] {
 const sources: Source[] = [];
 const add = (kind: CompiledPartKind, solid: Manifold, wingInstance = -1, side = 0, supportWingInstance = -1, support?: WingSupport): Source => {
  const w = wingInstance >= 0 ? wingInstance : supportWingInstance;
  const wing = w >= 0 ? wingInstanceFromId(w) : undefined;
  const source = { kind, sourceIndex: sources.length, wingInstance, side, supportWingInstance,
   materialId: wing?.materialId ?? 'carbon-epoxy', materialAmount: wing?.materialAmount ?? 1,
   originalID: api.Manifold.reserveIDs(1), solid, support };
  sources.push(source); return source;
 };
 const wingInstanceFromId = (id: number) => wingInstance(d, id).wing;
 const transformed = (solid: Manifold, matrix: Matrix4): Manifold => {
  const result = pool.own(solid.transform(matrix.elements as Parameters<Manifold['transform']>[0])); pool.release(solid); return result;
 };
 const ellipsoid = (kind: CompiledPartKind, shape: BodyEllipsoid, x: number, upper = false) => {
  let solid = pool.own(api.Manifold.sphere(1, 32));
  if (upper) { const half = pool.own(solid.trimByPlane([0, 1, 0], 0)); pool.release(solid); solid = half; }
  if (kind === 'cockpit') {
   const seam = BODY_GEOMETRY.shell.x, front = shape.x + shape.xRadius, rear = shape.x - shape.xRadius;
   const raw = solid.getMesh(), positions = new Float32Array(raw.vertProperties);
   for (let i = 0; i < positions.length; i += raw.numProp) {
    const value = positions[i], halfLength = value < 0 ? seam - rear : front - seam;
    positions[i] = (seam + value * halfLength - shape.x) / shape.xRadius;
   }
   if (!positions.every(Number.isFinite)) throw Error('Non-finite cockpit geometry');
   const warped = pool.mesh({ positions, indices: raw.triVerts, faceIDs: raw.faceID }, api.Manifold.reserveIDs(1));
   pool.release(solid); solid = warped;
  }
  const matrix = new Matrix4().makeScale(shape.xRadius, shape.yRadius, shape.zRadius); matrix.setPosition(x + shape.x, shape.y, 0);
  add(kind, transformed(solid, matrix));
 };
 // Recreate analytic body cutters from the same recipe as a full compilation.
 // Reimporting their Float32 exports changes near-tangent ownership boundaries.
 const { nose, tail } = fuselageEnds(d);
 const beam = pool.own(api.Manifold.cylinder(nose - tail, fuselageBeamRadius(d, tail), fuselageBeamRadius(d, nose), 24));
 add('fuselage', transformed(beam, new Matrix4().makeRotationY(Math.PI / 2).setPosition(tail, 0, 0)));
 if (!d.birdman) { ellipsoid('cockpit', cockpitGeometry(d), d.cockpit.position); ellipsoid('canopy', BODY_GEOMETRY.canopy, d.cockpit.position, true); }
 ellipsoid('nose', BODY_GEOMETRY.nose, nose);
 const main = mainWingSupport(d);
 if ((!changed || changed.has(0)) && main.mass > 1e-12) {
  const points: Vector3[] = [];
  for (const z of [-0.03, 0.03]) for (const [x, y] of [[main.frontX, main.frontY], [main.backX, main.backY],
   [main.backX, main.backY - main.height], [main.frontX, main.frontY - main.height]]) points.push(new Vector3(x, y, z));
  const mesh = closeMesh(points, [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 6, 5, 2, 3, 6, 3, 7, 6, 3, 0, 7, 0, 4, 7]);
  const source = add('wing-support', pool.mesh(mesh, api.Manifold.reserveIDs(1)), -1, 0, 0); source.originalID = source.solid.originalID();
 }
 for (const support of wingSupports(d)) {
  if (changed && !changed.has(support.wingInstance)) continue;
  const originalID = api.Manifold.reserveIDs(1), solid = pool.mesh(closeMesh(support.points, support.indices), originalID);
  const source = add('wing-support', solid, -1, support.side, support.wingInstance, support); source.originalID = originalID;
 }
 if (!changed) for (const [engineIndex, mount] of engineMounts(d).entries()) {
  const spec = engineCatalog[d.engine.type];
  for (const { part, mesh } of engineMeshes(spec.length, spec.radius, mount)) {
   const source = add('engine', pool.mesh(mesh, api.Manifold.reserveIDs(1)));
   source.enginePart = part; source.engineIndex = engineIndex;
  }
  if (mount.supportLength > 1e-9) {
   const direction = new Vector3(0, mount.y, mount.z).normalize(), q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
   const matrix = new Matrix4().makeRotationFromQuaternion(q); matrix.setPosition(new Vector3(mount.x, 0, 0).addScaledVector(direction, mount.supportLength / 2));
   add('engine-support', transformed(pool.own(api.Manifold.cube([mount.supportWidth, mount.supportLength, 0.06], true)), matrix)).engineIndex = engineIndex;
  }
 }
 if (!changed && d.engine.count > 0 && d.fuelTank.capacity > 0) {
  const dimensions = fuelTankDimensions(d.fuelTank.capacity), position = fuelTankPosition(d);
  const matrix = new Matrix4().makeScale(dimensions.length / 2, dimensions.radius, dimensions.radius); matrix.setPosition(position.x, position.y, position.z);
  add('fuel-tank', transformed(pool.own(api.Manifold.sphere(1, 24)), matrix));
 }
 for (const { id, key, wing: w } of aircraftWings(d)) for (const side of key === 'verticalTail' && !w.mirrored ? [1] : [-1, 1]) {
  if (changed && !changed.has(id)) continue;
  const originalID = api.Manifold.reserveIDs(1), frame = wingFrame(d, id, side);
  const { input, solid } = wingSolid(d, pool, { wingInstance: id, side, frame }, 0, Math.abs(w.points[1].y), 0, 1, originalID);
  const matrix = new Matrix4().fromArray(frame.matrix), positions = new Float32Array(input.positions.length), point = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
   point.fromArray(input.positions, i).applyMatrix4(matrix); positions[i] = point.x; positions[i + 1] = point.y; positions[i + 2] = point.z;
  }
  const indices = matrix.determinant() < 0 ? input.indices.slice() : input.indices;
  if (indices !== input.indices) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const source = add('wing', solid, id, side); source.originalID = originalID;
  source.mesh = { ...input, positions, indices }; source.frame = frame;
 }
 return sources;
}

function trim(pool: Solids, solid: Manifold, cutters: readonly Manifold[]): Manifold {
 let result = solid;
 for (const cutter of cutters) {
  if (!overlap(result.boundingBox(), cutter.boundingBox())) continue;
  const next = pool.own(result.subtract(cutter));
  if (result !== solid) pool.release(result); result = next;
  if (result.isEmpty()) break;
 }
 return result;
}

function coveredByConvexBody(solid: Manifold, body: Manifold): boolean {
 const bounds = solid.boundingBox(), outer = body.boundingBox();
 if (bounds.min.some((value, axis) => value < outer.min[axis] || bounds.max[axis] > outer.max[axis])) return false;
 const mesh = solid.getMesh(), cage = body.getMesh(), p = cage.vertProperties, stride = cage.numProp;
 // Every vertex inside every oriented face plane proves containment in these
 // convex body primitives. Bounding boxes only reject impossible containment.
 for (let i = 0; i < cage.triVerts.length; i += 3) {
  const a = cage.triVerts[i] * stride, b = cage.triVerts[i + 1] * stride, c = cage.triVerts[i + 2] * stride;
  const bx = p[b] - p[a], by = p[b + 1] - p[a + 1], bz = p[b + 2] - p[a + 2];
  const cx = p[c] - p[a], cy = p[c + 1] - p[a + 1], cz = p[c + 2] - p[a + 2];
  const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
  for (let j = 0; j < mesh.vertProperties.length; j += mesh.numProp) {
   const v = mesh.vertProperties;
   if (nx * (v[j] - p[a]) + ny * (v[j + 1] - p[a + 1]) + nz * (v[j + 2] - p[a + 2]) > 0) return false;
  }
 }
 return true;
}

/** Clearance cells are analysis samples, not independent Boolean or structural bodies. */
function coalescePieces(d: AircraftDefinition, pool: Solids, input: readonly Piece[]): Piece[] {
 const body = input.filter(piece => piece.source.kind !== 'wing');
 let wings = input.filter(piece => piece.source.kind === 'wing');
 for (const chordwise of [false, true]) {
  wings.sort((a, b) => a.source.sourceIndex - b.source.sourceIndex || Number(a.movable) - Number(b.movable)
   || (chordwise ? a.spanStart - b.spanStart || a.spanEnd - b.spanEnd || a.uStart! - b.uStart!
    : a.uStart! - b.uStart! || a.uEnd! - b.uEnd! || a.spanStart - b.spanStart));
  const joined: Piece[] = [];
  for (let i = 0; i < wings.length;) {
   const first = wings[i], group = [first]; let last = first; i++;
   while (i < wings.length) {
    const next = wings[i];
    if (first.source !== next.source || first.movable !== next.movable) break;
    const adjacent = chordwise ? !first.movable && first.spanStart === next.spanStart && first.spanEnd === next.spanEnd && Math.abs(last.uEnd! - next.uStart!) < 1e-9
     : first.uStart === next.uStart && first.uEnd === next.uEnd && Math.abs(last.spanEnd - next.spanStart) < 1e-9
      && Math.floor((first.spanStart + 1e-8) / 0.8) === Math.floor((next.spanStart + 1e-8) / 0.8);
    if (!adjacent) break;
    group.push(next); last = next; i++;
   }
   if (group.length === 1) { joined.push(first); continue; }
   const originalID = api.Manifold.reserveIDs(1), spanEnd = chordwise ? first.spanEnd : last.spanEnd, uEnd = chordwise ? last.uEnd! : first.uEnd!;
   const { input, solid } = wingSolid(d, pool, first.source, first.spanStart, spanEnd, first.uStart!, uEnd, originalID);
   joined.push({ ...first, solid, input, originalID, spanEnd, uEnd });
   for (const piece of group) pool.release(piece.solid);
  }
  wings = joined;
 }
 // Fixed chord fragments have no separate motion or fracture identity inside a
 // structural cell. Union their existing solids; never resample their boundary.
 const groups = new Map<string, Piece[]>(), result: Piece[] = [];
 for (const piece of wings) {
  if (piece.movable) { result.push(piece); continue; }
  const key = `${piece.source.sourceIndex},${Math.floor((piece.spanStart + 1e-8) / 0.8)}`, group = groups.get(key);
  if (group) group.push(piece); else groups.set(key, [piece]);
 }
 for (const group of groups.values()) {
  const first = group[0]; if (group.length === 1) { result.push(first); continue; }
  const solid = pool.own(api.Manifold.union(group.map(piece => piece.solid)));
  result.push({ ...first, solid, spanStart: Math.min(...group.map(piece => piece.spanStart)), spanEnd: Math.max(...group.map(piece => piece.spanEnd)),
   uStart: Math.min(...group.map(piece => piece.uStart!)), uEnd: Math.max(...group.map(piece => piece.uEnd!)),
   inputs: group.flatMap(piece => piece.inputs ?? [{ originalID: piece.originalID, input: piece.input! }]) });
  for (const piece of group) pool.release(piece.solid);
 }
 return body.concat(result);
}

function supportCoordinates(d: AircraftDefinition, source: Source, positions: Float32Array, coordinates: Float32Array): void {
 const point = new Vector3(), nearest = new Vector3(), closest = new Vector3(), barycentric = new Vector3(), triangle = new Triangle();
 if (source.support) {
  const support = source.support;
  for (let i = 0; i < positions.length; i += 3) {
   point.fromArray(positions, i); let distance = Infinity, weight = 0;
   for (let j = 0; j < support.indices.length; j += 3) {
    const a = support.indices[j], b = support.indices[j + 1], c = support.indices[j + 2];
    triangle.a.copy(support.points[a] as Vector3); triangle.b.copy(support.points[b] as Vector3); triangle.c.copy(support.points[c] as Vector3);
    triangle.closestPointToPoint(point, nearest); const squared = nearest.distanceToSquared(point);
    if (squared >= distance || triangle.getArea() < 1e-15) continue;
    distance = squared; closest.copy(nearest); triangle.getBarycoord(closest, barycentric);
    weight = barycentric.x * support.vertexWeights[a] + barycentric.y * support.vertexWeights[b] + barycentric.z * support.vertexWeights[c];
   }
   coordinates[i] = Math.max(0, Math.min(1, weight));
  }
 } else {
  const support = mainWingSupport(d);
  for (let i = 0; i < positions.length; i += 3) {
   const x = positions[i], f = (x - support.frontX) / (support.backX - support.frontX);
   const wingY = support.frontY + f * (support.backY - support.frontY);
   coordinates[i] = Math.max(0, Math.min(1, (positions[i + 1] - wingY + support.height) / support.height));
  }
 }
}

/** Keep only removed-volume components connected to the declared installation cap. */
function rootAttachmentRange(d: AircraftDefinition, pool: Solids, source: Source, parents: Source[], atTip: boolean): { spanStart: number; spanEnd: number } | undefined {
 const input = source.mesh!;
 if (!input.coordinates) throw Error('Wing attachment lost source coordinates');
 const seed = atTip ? Math.fround(Math.abs(wingInstance(d, source.wingInstance).wing.points[1].y)) : 0;
 const rootFaces = new Set<number>();
 for (let i = 0; i < input.indices.length; i += 3) {
  if (input.coordinates[input.indices[i] * 3] === seed && input.coordinates[input.indices[i + 1] * 3] === seed
   && input.coordinates[input.indices[i + 2] * 3] === seed) rootFaces.add(i / 3);
 }
 const ownIDs = new Set(source.solid.getMesh().runOriginalID);
 const touching = parents.filter(parent => overlap(source.solid.boundingBox(), parent.solid.boundingBox()));
 if (!touching.length) return;
 const parent = touching.length === 1 ? touching[0].solid : pool.own(api.Manifold.union(touching.map(item => item.solid)));
 const removed = pool.own(source.solid.intersect(parent));
 if (touching.length > 1) pool.release(parent);
 let spanStart = Infinity, spanEnd = -Infinity;
 const coordinates = new Float32Array(3), point = { x: 0, y: 0, z: 0 };
 const components = removed.decompose();
 try { for (const component of components) {
  const mesh = component.getMesh(); let rooted = false;
  for (let run = 0; run < mesh.runOriginalID.length && !rooted; run++) {
   if (!ownIDs.has(mesh.runOriginalID[run])) continue;
   for (let i = mesh.runIndex[run]; i < mesh.runIndex[run + 1]; i += 3) if (rootFaces.has(mesh.faceID[i / 3] >>> 1)) { rooted = true; break; }
  }
  if (rooted) for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
   point.x = mesh.vertProperties[i]; point.y = mesh.vertProperties[i + 1]; point.z = mesh.vertProperties[i + 2];
   wingCoordinates(d, source.wingInstance, source.side, point, coordinates, 0, input);
   spanStart = Math.min(spanStart, coordinates[0]); spanEnd = Math.max(spanEnd, coordinates[0]);
  }
 } } finally { for (const component of components) component.delete(); pool.release(removed); }
 if (spanEnd >= spanStart) return { spanStart, spanEnd };
}

function exportPiece(d: AircraftDefinition, piece: Piece, origins: ReadonlyMap<number, GeometryOrigin>, rootRange: Parameters<typeof attachmentSpans>[6], stations: readonly number[]): { partition: CompiledPartition; moment: Vec3; attachments: CompiledAttachmentSpan[] } {
 const { source } = piece, mesh: Mesh = piece.solid.getMesh(), count = mesh.vertProperties.length / mesh.numProp;
 const originals = new Set(piece.inputs?.map(input => input.originalID) ?? [piece.originalID]);
 const positions = new Float32Array(count * 3), coordinates = new Float32Array(count * 3);
 const point = { x: 0, y: 0, z: 0 };
 for (let i = 0; i < count; i++) {
  const from = i * mesh.numProp, to = i * 3;
  positions[to] = point.x = mesh.vertProperties[from]; positions[to + 1] = point.y = mesh.vertProperties[from + 1]; positions[to + 2] = point.z = mesh.vertProperties[from + 2];
  if (source.kind === 'wing') wingCoordinates(d, source.wingInstance, source.side, point, coordinates, to, source.mesh);
 }
 if (source.kind === 'wing-support') supportCoordinates(d, source, positions, coordinates);
 let surfaceArea = 0; const moment: Vec3 = [0, 0, 0];
 if (source.kind === 'wing') {
  const w = wingInstance(d, source.wingInstance).wing, half = Math.abs(w.points[1].y);
  const chordX = (index: number): number => {
   const span = coordinates[index * 3], u = coordinates[index * 3 + 1], f = span / half;
   const lead = w.points[0].x + (w.points[1].x - w.points[0].x) * f;
   return lead + u * (w.points[3].x - w.points[0].x + (w.points[2].x - w.points[1].x - w.points[3].x + w.points[0].x) * f);
  };
  for (let run = 0; run < mesh.runOriginalID.length; run++) {
   if (!originals.has(mesh.runOriginalID[run])) continue;
   for (let j = mesh.runIndex[run]; j < mesh.runIndex[run + 1]; j += 3) {
    if (!(mesh.faceID[j / 3] & 1)) continue;
    const a = mesh.triVerts[j], b = mesh.triVerts[j + 1], c = mesh.triVerts[j + 2];
    const ax = chordX(a), bx = chordX(b), cx = chordX(c), ay = coordinates[a * 3], by = coordinates[b * 3], cy = coordinates[c * 3];
    const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 4;
    surfaceArea += area;
    for (let axis = 0; axis < 3; axis++) moment[axis] += area * (positions[a * 3 + axis] + positions[b * 3 + axis] + positions[c * 3 + axis]) / 3;
   }
  }
 }
 const selectedFaces = new Uint8Array(mesh.triVerts.length / 3);
 if (source.kind === 'wing') {
  // Sweep hulls have no material origin. Other Boolean cut faces retain their
  // declared source and do not need hinge-station refinement.
  for (let run = 0; run < mesh.runOriginalID.length; run++) {
   if (!originals.has(mesh.runOriginalID[run]) && !origins.has(mesh.runOriginalID[run])) selectedFaces.fill(1, mesh.runIndex[run] / 3, mesh.runIndex[run + 1] / 3);
  }
  if (piece.movable) {
   const hinge = 1 - wingInstance(d, source.wingInstance).wing.controlSurface;
   for (let i = 0; i < mesh.triVerts.length; i += 3) {
    if ([0, 1, 2].every(corner => Math.abs(coordinates[mesh.triVerts[i + corner] * 3 + 1] - hinge) < 1e-5)) selectedFaces[i / 3] = 1;
   }
  }
 }
 const exported = source.kind === 'wing' ? restoreSpanStations({ positions, coordinates,
  indices: new Uint32Array(mesh.triVerts), faceIDs: new Uint32Array(mesh.faceID) }, stations, selectedFaces)
  : { positions, coordinates, indices: new Uint32Array(mesh.triVerts) };
 if (source.kind === 'wing') for (let i = positions.length; i < exported.positions.length; i += 3) {
  point.x = exported.positions[i]; point.y = exported.positions[i + 1]; point.z = exported.positions[i + 2];
  wingCoordinates(d, source.wingInstance, source.side, point, exported.coordinates!, i, source.mesh);
 }
 return { partition: { wingInstance: source.wingInstance, side: source.side, spanStart: piece.spanStart, spanEnd: piece.spanEnd,
  movable: piece.movable, positions: exported.positions, indices: exported.indices, coordinates: exported.coordinates!, surfaceArea,
  kind: source.kind, sourceIndex: source.sourceIndex, materialId: source.materialId, materialAmount: source.materialAmount,
  supportWingInstance: source.supportWingInstance, enginePart: source.enginePart, engineIndex: source.engineIndex }, moment,
  attachments: attachmentSpans(d, { ...source, movable: piece.movable, input: piece.input }, originals, mesh, coordinates, origins, rootRange) };
}

function sourceMesh(d: AircraftDefinition, source: Source): CompiledSourceMesh {
 const raw = source.solid.getMesh();
 const mesh: ClosedMesh = source.mesh ?? { positions: new Float32Array(raw.vertProperties),
  indices: new Uint32Array(raw.triVerts), faceIDs: new Uint32Array(raw.faceID) };
 const bounds = source.solid.boundingBox();
 const cells = source.kind === 'wing' ? wingCells(d, source, mesh) : undefined;
 const motionBounds: Box = cells ? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] } : bounds;
 for (const cell of cells ?? []) for (let axis = 0; axis < 3; axis++) {
  motionBounds.min[axis] = Math.min(motionBounds.min[axis], cell.motionBounds.min[axis]);
  motionBounds.max[axis] = Math.max(motionBounds.max[axis], cell.motionBounds.max[axis]);
 }
 return { sourceIndex: source.sourceIndex, kind: source.kind, wingInstance: source.wingInstance, side: source.side,
  supportWingInstance: source.supportWingInstance, materialId: source.materialId, materialAmount: source.materialAmount,
  enginePart: source.enginePart, engineIndex: source.engineIndex,
  positions: mesh.positions, indices: mesh.indices, faceIDs: mesh.faceIDs, coordinates: mesh.coordinates,
  bounds, motionBounds, support: source.support, cells, frame: source.frame };
}

function compileSources(d: AircraftDefinition, pool: Solids, sources: Source[], previous?: CompiledAircraft,
 rebuilt?: ReadonlySet<number>, originals = sources.map(source => sourceMesh(d, source)),
 inspect?: (piece: Piece, partition: CompiledPartition) => void, ranges?: ReadonlyMap<number, ReadonlySet<number>>): CompiledAircraft {
  const cellChanged = (sourceIndex: number, span: number) => !ranges?.has(sourceIndex) || ranges.get(sourceIndex)!.has(Math.floor((span + 1e-8) / 0.8));
  const wings = sources.filter(source => source.kind === 'wing');
  const obstacles = sources.filter(source => source.kind !== 'wing'), pieces: Piece[] = [], moving: Moving[] = [];
  const clear = (candidate: Moving): boolean => {
   const source = candidate.source;
   if (wingInstance(d, source.wingInstance).key !== 'verticalTail' && candidate.spanStart < 0.02 - 1e-9) return false;
   return sources.every(other => other === source || continuousClear(pool, candidate, other.solid, undefined, other));
  };
  for (const source of obstacles) if (!rebuilt || rebuilt.has(source.sourceIndex)) pieces.push({ source, solid: source.solid, originalID: source.originalID, spanStart: 0, spanEnd: 0, movable: false });
  for (const source of wings) {
   const w = wingInstance(d, source.wingInstance).wing, half = Math.abs(w.points[1].y), hinge = 1 - w.controlSurface;
   const make = (start: number, end: number, from: number, to: number, movable: boolean): Piece => {
    const originalID = api.Manifold.reserveIDs(1), { input, solid } = wingSolid(d, pool, source, start, end, from, to, originalID);
    return { source, originalID, input, solid,
     spanStart: start, spanEnd: end, uStart: from, uEnd: to, movable };
   };
   for (let structural = 0; structural * 0.8 < half - 1e-9; structural++) {
    if (!cellChanged(source.sourceIndex, structural * 0.8)) continue;
    const start = structural * 0.8, end = Math.min(start + 0.8, half);
    if (!(w.controlSurface > 0)) { pieces.push(make(start, end, 0, 1, false)); continue; }
    if (hinge > 1e-9) pieces.push(make(start, end, 0, hinge, false));
    // Recheck the previous active intervals as complete solids. Most 0.5-degree
    // edits leave these intervals unchanged, so only the short fixed gaps need cells.
    const priorActive = previous?.partitions.filter(part => part.sourceIndex === source.sourceIndex && part.movable
     && Math.floor((part.spanStart + 1e-8) / 0.8) === structural).sort((a, b) => a.spanStart - b.spanStart) ?? [];
    if (priorActive.length) {
     const active: Moving[] = []; let stable = true;
     for (const part of priorActive) {
      const candidate = movingPiece(d, make(part.spanStart, part.spanEnd, hinge, 1, true));
      if (!clear(candidate)) { pool.release(candidate.solid); stable = false; break; }
      active.push(candidate);
     }
     if (stable) {
      let cursor = start;
      for (const interval of [...priorActive, { spanStart: end, spanEnd: end }]) {
       for (let cell = 0; cursor + cell * 0.02 < interval.spanStart - 1e-9; cell++) {
        const a = cursor + cell * 0.02, b = Math.min(a + 0.02, interval.spanStart), candidate = movingPiece(d, make(a, b, hinge, 1, true));
        if (clear(candidate)) active.push(candidate); else pieces.push({ ...candidate, movable: false });
       }
       cursor = interval.spanEnd;
      }
      moving.push(...active); continue;
     }
     for (const candidate of active) pool.release(candidate.solid);
    }
    for (let cell = 0; start + cell * 0.2 < end - 1e-9; cell++) {
     const a = start + cell * 0.2, b = Math.min(a + 0.2, end), candidate = movingPiece(d, make(a, b, hinge, 1, true));
     if (clear(candidate)) { moving.push(candidate); continue; }
     pool.release(candidate.solid);
     for (let fine = 0; a + fine * 0.02 < b - 1e-9; fine++) {
      const fineA = a + fine * 0.02, fineB = Math.min(fineA + 0.02, b), local = movingPiece(d, make(fineA, fineB, hinge, 1, true));
      if (clear(local)) moving.push(local); else pieces.push({ ...local, movable: false });
     }
    }
   }
  }
  // Only actually movable cells participate in two-actuator travel checks.
  const risks = new Set<Moving>();
  for (let i = 0; i < moving.length; i++) for (let j = i + 1; j < moving.length; j++) {
   const a = moving[i], b = moving[j];
   if (a.source !== b.source && !continuousClear(pool, a, b.solid, b)) { risks.add(a); risks.add(b); }
  }
  const refined: Moving[] = [];
  for (const candidate of moving) {
   if (!risks.has(candidate) || candidate.spanEnd - candidate.spanStart < 0.0200001) { refined.push(candidate); continue; }
   const source = candidate.source, w = wingInstance(d, source.wingInstance).wing;
   for (let cell = 0; candidate.spanStart + cell * 0.02 < candidate.spanEnd - 1e-9; cell++) {
    const start = candidate.spanStart + cell * 0.02, end = Math.min(start + 0.02, candidate.spanEnd);
    const originalID = api.Manifold.reserveIDs(1), { input, solid } = wingSolid(d, pool, source, start, end, 1 - w.controlSurface, 1, originalID);
    const local = movingPiece(d, { source, originalID, input, solid,
     spanStart: start, spanEnd: end, uStart: 1 - w.controlSurface, uEnd: 1, movable: true });
    if (clear(local)) refined.push(local); else pieces.push({ ...local, movable: false });
   }
   pool.release(candidate.solid);
  }
  risks.clear();
  for (let i = 0; i < refined.length; i++) for (let j = i + 1; j < refined.length; j++) {
   const a = refined[i], b = refined[j];
   if (a.source !== b.source && !continuousClear(pool, a, b.solid, b)) { risks.add(a); risks.add(b); }
  }
  moving.length = 0;
  for (const candidate of refined) {
   if (risks.has(candidate)) pieces.push({ ...candidate, movable: false }); else moving.push(candidate);
  }
  const fixedPieces = coalescePieces(d, pool, pieces), movingPieces = coalescePieces(d, pool, moving);
  pieces.length = 0; pieces.push(...fixedPieces);
  moving.length = 0; for (const piece of movingPieces) moving.push(movingPiece(d, piece));
  // Hinge relief does not join sources or alter spar installation topology.
  for (const source of wings) {
   const sweeps = moving.filter(piece => piece.source === source).map(piece => hingeSweep(pool, piece));
   if (ranges && previous) for (const far of previous.partitions) {
    if (far.sourceIndex !== source.sourceIndex || !far.movable || cellChanged(source.sourceIndex, far.spanStart)) continue;
    const cell = Math.floor((far.spanStart + 1e-8) / 0.8);
    if (![...(ranges.get(source.sourceIndex) ?? [])].some(changed => Math.abs(changed - cell) === 1)) continue;
    const originalID = api.Manifold.reserveIDs(1), w = wingInstance(d, source.wingInstance).wing;
    const { input, solid } = wingSolid(d, pool, source, far.spanStart, far.spanEnd, 1 - w.controlSurface, 1, originalID);
    const sweep = hingeSweep(pool, movingPiece(d, { source, solid, input, originalID, spanStart: far.spanStart, spanEnd: far.spanEnd, movable: true }));
    pool.release(solid);
    sweeps.push(sweep);
   }
   for (const piece of pieces) if (piece.source === source) piece.solid = trim(pool, piece.solid, sweeps);
   for (const sweep of sweeps) pool.release(sweep);
  }
  pieces.push(...moving);
  const origins = new Map<number, GeometryOrigin>();
  for (const source of sources) if (source.kind !== 'wing') {
   const origin = { ...source, movable: false };
   for (const id of source.solid.getMesh().runOriginalID) origins.set(id, origin);
  }
  for (const piece of pieces) for (const input of piece.inputs ?? [{ originalID: piece.originalID, input: piece.input }])
   origins.set(input.originalID, { ...piece.source, movable: piece.movable, input: input.input });
  const rootRanges = new Map<string, { spanStart: number; spanEnd: number } | undefined>(), sourcesByIndex = new Map(sources.map(source => [source.sourceIndex, source]));
  const rootRange: Parameters<typeof attachmentSpans>[6] = (child, parent, onFin) => {
   const source = sourcesByIndex.get(child.sourceIndex)!, key = `${child.sourceIndex},${onFin ? parent.sourceIndex : 'body'}`;
   if (!rootRanges.has(key)) {
    const parents = onFin ? [sourcesByIndex.get(parent.sourceIndex)!] : sources.filter(item => item.kind === 'fuselage' || item.kind === 'cockpit'
     || item.kind === 'canopy' || item.kind === 'nose' || item.kind === 'wing-support' && item.supportWingInstance === source.wingInstance);
    rootRanges.set(key, rootAttachmentRange(d, pool, source, parents, onFin && source.wingInstance === 2));
   }
   return rootRanges.get(key);
  };
  const covered = (solid: Manifold, sourceIndex: number) => sources.some(source => source.sourceIndex < sourceIndex
   && (source.kind === 'fuselage' || source.kind === 'cockpit' || source.kind === 'canopy' || source.kind === 'nose')
   && coveredByConvexBody(solid, source.solid));
  const accepted: Manifold[] = [];
  // Replay fixed-owner cuts exactly; raw unions change coplanar seam ownership.
  for (const source of sources) if (rebuilt && !rebuilt.has(source.sourceIndex)) {
   if (covered(source.solid, source.sourceIndex)) continue;
   const solid = source.kind === 'wing' ? source.solid : trim(pool, source.solid, accepted);
   if (!solid.isEmpty()) accepted.push(solid);
  }
  const wingSources = new Map(wings.map(source => [`${source.wingInstance},${source.side}`, source]));
  const result: CompiledAircraft = { key: geometryKey(d),
   partitions: previous?.partitions.filter(part => !rebuilt?.has(part.sourceIndex) || part.kind === 'wing' && !cellChanged(part.sourceIndex, part.spanStart)) ?? [],
   controls: previous?.controls.filter(control => {
    const source = wingSources.get(`${control.wingInstance},${control.side}`);
    return !source || !cellChanged(source.sourceIndex, control.spanStart);
   }) ?? [], sourceMeshes: originals };
  const attached = new Map<string, CompiledAttachmentSpan>();
  const attachKey = (span: CompiledAttachmentSpan) => `${span.wingInstance},${span.side},${span.anchorWingInstance},${span.anchorSide},${span.anchorSpan}`;
  for (const span of previous?.attachmentSpans ?? []) {
   const source = wingSources.get(`${span.wingInstance},${span.side}`), cells = source && ranges?.get(source.sourceIndex);
   const first = Math.floor((span.spanStart + 1e-8) / 0.8), last = Math.max(first, Math.ceil(Math.fround(span.spanEnd / 0.8)) - 1);
   if (!source || cells && ![...cells].some(index => index >= first && index <= last)) attached.set(attachKey(span), span);
  }
  const controlMap = new Map<string, CompiledControl>();
  const spanStationSets = new Map<string, Set<number>>();
  for (const piece of pieces) {
   if (piece.source.kind !== 'wing') continue;
   const key = `${piece.source.sourceIndex},${Math.floor((piece.spanStart + 1e-8) / 0.8)}`;
   let stations = spanStationSets.get(key);
   if (!stations) { stations = new Set(); spanStationSets.set(key, stations); }
   for (const { input } of piece.inputs ?? [{ input: piece.input }]) {
    for (let i = 0; i < (input?.coordinates?.length ?? 0); i += 3) stations.add(input!.coordinates![i]);
   }
  }
  const spanStations = new Map([...spanStationSets].map(([key, values]) => [key, [...values].sort((a, b) => a - b)]));
  for (const piece of pieces) {
   if (covered(piece.solid, piece.source.sourceIndex)) continue;
   piece.solid = trim(pool, piece.solid, accepted);
   if (piece.solid.isEmpty()) continue;
   const stations = spanStations.get(`${piece.source.sourceIndex},${Math.floor((piece.spanStart + 1e-8) / 0.8)}`) ?? [];
   const { partition, moment, attachments } = exportPiece(d, piece, origins, rootRange, stations); result.partitions.push(partition); accepted.push(piece.solid);
   for (const span of attachments) {
    const key = attachKey(span), previous = attached.get(key);
    attached.set(key, previous ? { ...span, spanStart: Math.min(previous.spanStart, span.spanStart), spanEnd: Math.max(previous.spanEnd, span.spanEnd) } : span);
   }
   inspect?.(piece, partition);
   if (!piece.movable) continue;
   const start = Math.floor((piece.spanStart + 1e-8) / 0.8) * 0.8, key = `${piece.source.wingInstance},${piece.source.side},${start}`;
   let control = controlMap.get(key);
   if (!control) {
    const w = wingInstance(d, piece.source.wingInstance).wing, half = Math.abs(w.points[1].y), axis = wingControlAxis(d, piece.source.wingInstance, piece.source.side, new Vector3());
    const hinge = wingControlHinge(d, piece.source.wingInstance, piece.source.side, 0, new Vector3()), limit = (piece as Moving).limit;
    control = { wingInstance: piece.source.wingInstance, side: piece.source.side, spanStart: start, spanEnd: Math.min(start + 0.8, half),
     areaFraction: 0, area: 0, center: [0, 0, 0], hinge: hinge.toArray() as Vec3, axis: axis.toArray() as Vec3, minAngle: -limit, maxAngle: limit };
    controlMap.set(key, control);
   }
   control.area += partition.surfaceArea;
   for (let axis = 0; axis < 3; axis++) control.center[axis] += moment[axis];
  }
  for (const source of wings) {
   const w = wingInstance(d, source.wingInstance).wing; if (!(w.controlSurface > 0)) continue;
   const half = Math.abs(w.points[1].y), root = w.points[3].x - w.points[0].x, tip = w.points[2].x - w.points[1].x;
   for (let cell = 0; cell * 0.8 < half - 1e-9; cell++) {
    if (!cellChanged(source.sourceIndex, cell * 0.8)) continue;
    const start = cell * 0.8, end = Math.min(start + 0.8, half), key = `${source.wingInstance},${source.side},${start}`;
    let control = controlMap.get(key);
    if (!control) {
     const hinge = wingControlHinge(d, source.wingInstance, source.side, 0, new Vector3()), axis = wingControlAxis(d, source.wingInstance, source.side, new Vector3());
     control = { wingInstance: source.wingInstance, side: source.side, spanStart: start, spanEnd: end, areaFraction: 0, area: 0,
      center: wingControlHinge(d, source.wingInstance, source.side, (start + end) / 2, new Vector3()).toArray() as Vec3,
      hinge: hinge.toArray() as Vec3, axis: axis.toArray() as Vec3, minAngle: 0, maxAngle: 0 };
    }
    const originalArea = (end - start) * (2 * root + (tip - root) * (start + end) / half) / 2 * w.controlSurface;
    control.areaFraction = Math.max(0, Math.min(1, control.area / originalArea));
    if (control.area > 0) for (let axis = 0; axis < 3; axis++) control.center[axis] /= control.area;
    result.controls.push(control);
   }
  }
  result.attachmentSpans = [...attached.values()];
  return result;
}

/** Test-only measurements while original WASM solids are still owned by the compilation. */
export interface CompiledGeometryDiagnostics {
 maxIntersectionVolume: number; maxSurfaceDeviation: number; minVolume: number;
 maxIntersectionPair?: string;
 /** Opt-in native proof of the continuous hinge envelope and representative actual poses. */
 controlTravel?: { maxSweepIntersectionVolume: number; maxPoseIntersectionVolume: number; pairs: number; mainRootPairs: number };
}

/** Explicit, synchronous compilation. Callers install only fully successful results. */
export function compileAircraft(d: AircraftDefinition, diagnostics?: CompiledGeometryDiagnostics): CompiledAircraft {
 const cached = getCompiledAircraft(d); if (cached && !diagnostics) return cached;
 const pool = new Solids();
 try {
  const native: { solid: Manifold; piece: Piece; partition: CompiledPartition; bounds: Box }[] | undefined = diagnostics ? [] : undefined;
  const result = compileSources(d, pool, addSources(d, pool), undefined, undefined, undefined,
   native ? (piece, partition) => native.push({ solid: piece.solid, piece, partition, bounds: piece.solid.boundingBox() }) : undefined);
  if (diagnostics && native) {
   diagnostics.maxIntersectionVolume = 0; diagnostics.maxSurfaceDeviation = 0; diagnostics.minVolume = Infinity;
   for (let i = 0; i < native.length; i++) {
    const a = native[i]; diagnostics.minVolume = Math.min(diagnostics.minVolume, a.solid.volume());
    for (let j = i + 1; j < native.length; j++) {
     const b = native[j]; if (!overlap(a.bounds, b.bounds)) continue;
     const intersection = pool.own(a.solid.intersect(b.solid));
     const volume = intersection.volume();
     if (Math.abs(volume) > diagnostics.maxIntersectionVolume) {
      const label = (part: CompiledPartition) => `${part.kind}[${part.sourceIndex};${part.wingInstance},${part.side};${part.spanStart}..${part.spanEnd};${part.movable ? 'moving' : 'fixed'}]`;
      diagnostics.maxIntersectionVolume = Math.abs(volume); diagnostics.maxIntersectionPair = `${label(a.partition)} / ${label(b.partition)}: ${volume}`;
     }
     pool.release(intersection);
    }
    // Carry the double-precision low bits through extra properties. Their norm
    // bounds every exported vertex, hence every barycentric point of each triangle.
    const precise = pool.own(a.solid.setProperties(3, (properties, position) => {
     for (let axis = 0; axis < 3; axis++) properties[axis] = position[axis] - Math.fround(position[axis]);
    }));
    const mesh = precise.getMesh();
    for (let vertex = 0; vertex < mesh.vertProperties.length; vertex += mesh.numProp) {
     diagnostics.maxSurfaceDeviation = Math.max(diagnostics.maxSurfaceDeviation,
      Math.hypot(mesh.vertProperties[vertex + 3], mesh.vertProperties[vertex + 4], mesh.vertProperties[vertex + 5]));
    }
    pool.release(precise);
   }
   const travel = diagnostics.controlTravel;
   if (travel) {
    travel.maxSweepIntersectionVolume = 0; travel.maxPoseIntersectionVolume = 0; travel.pairs = 0; travel.mainRootPairs = 0;
    for (const a of native) {
     if (!a.partition.movable) continue;
     const moving = a.piece as Moving, sweep = hingeSweep(pool, moving), sweepBounds = sweep.boundingBox();
     const fixed = native.filter(b => b.partition.kind === 'wing' && !b.partition.movable
      && b.partition.wingInstance === a.partition.wingInstance && b.partition.side === a.partition.side);
     for (const b of fixed) {
      travel.pairs++;
      if (a.partition.wingInstance === 0 && a.partition.side === 1 && a.partition.spanStart < 0.8 && b.partition.spanStart < 0.8) travel.mainRootPairs++;
      if (!overlap(sweepBounds, b.bounds)) continue;
      const intersection = pool.own(sweep.intersect(b.solid));
      travel.maxSweepIntersectionVolume = Math.max(travel.maxSweepIntersectionVolume, Math.abs(intersection.volume())); pool.release(intersection);
     }
     for (const angle of [-moving.limit, -Math.min(moving.limit, 0.215511), Math.min(moving.limit, 0.215511), moving.limit]) {
      const posed = rotate(pool, moving, angle), bounds = posed.boundingBox();
      for (const b of fixed) {
       if (!overlap(bounds, b.bounds)) continue;
       const intersection = pool.own(posed.intersect(b.solid));
       travel.maxPoseIntersectionVolume = Math.max(travel.maxPoseIntersectionVolume, Math.abs(intersection.volume())); pool.release(intersection);
      }
      pool.release(posed);
     }
     pool.release(sweep);
    }
   }
  }
  installCompiledAircraft(d, result); return result;
 } finally { pool.close(); }
}

export interface IncrementalGeometryDiagnostics {
 cellsRebuilt: number; cellsReused: number;
}

/** Recompile installation edits without rebuilding unrelated solids or actuator relief. */
export function compileAffectedAircraft(d: AircraftDefinition, previous: CompiledAircraft, changedWingInstances: readonly number[], diagnostics?: Partial<IncrementalGeometryDiagnostics>): CompiledAircraft {
 const cached = getCompiledAircraft(d); if (cached) return cached;
 if (!previous.sourceMeshes) throw Error('Local compilation requires original source meshes');
 if (!changedWingInstances.length) throw Error('Local compilation requires changed wing instances');
 const pool = new Solids();
 const work = diagnostics && Object.assign(diagnostics, { cellsRebuilt: 0, cellsReused: 0 }) as IncrementalGeometryDiagnostics | undefined;
 try {
  const changed = new Set(changedWingInstances), old = previous.sourceMeshes;
  if (d.assembly.tailOnFin && changed.has(1)) changed.add(2);
  const belongs = (source: Pick<CompiledSourceMesh, 'wingInstance' | 'supportWingInstance'>) => changed.has(source.wingInstance) || changed.has(source.supportWingInstance);
  const identity = (source: Pick<CompiledSourceMesh, 'kind' | 'wingInstance' | 'side' | 'supportWingInstance' | 'enginePart' | 'engineIndex'>) => `${source.kind},${source.wingInstance},${source.side},${source.supportWingInstance},${source.engineIndex ?? -1},${source.enginePart ?? ''}`;
  const prior = new Map(old.map(source => [identity(source), source]));
  const oldByIndex = new Map(old.map(source => [source.sourceIndex, source]));
  const transforms = new Map<number, Matrix4>(), forced = new Map<number, Set<number>>(), movement = new Map<number, number>();
  const point = new Vector3();
  const generated = addSources(d, pool, changed), created = new Map<number, Source>(), originals = new Map(old.filter(source => !belongs(source)).map(source => [source.sourceIndex, source]));
  let nextIndex = Math.max(...old.map(source => source.sourceIndex)) + 1;
  for (const source of generated) {
   const priorMesh = prior.get(identity(source));
   source.sourceIndex = priorMesh?.sourceIndex ?? nextIndex++;
   if (priorMesh && !belongs(source)) { created.set(source.sourceIndex, source); continue; }
   const next = sourceMesh(d, source);
   if (source.kind === 'wing') {
    const dirty = new Set<number>(); forced.set(source.sourceIndex, dirty);
    if (priorMesh?.frame && next.frame && priorMesh.positions.length === next.positions.length) {
     const transform = new Matrix4().fromArray(next.frame.matrix).multiply(new Matrix4().fromArray(priorMesh.frame.matrix).invert());
     transforms.set(source.sourceIndex, transform); let distance = 0;
     for (let i = 0; i < next.positions.length; i += 3) {
      point.fromArray(priorMesh.positions, i).applyMatrix4(transform);
      if (Math.hypot(point.x - next.positions[i], point.y - next.positions[i + 1], point.z - next.positions[i + 2]) > 2e-6) {
       const span = next.coordinates![i];
       for (let cell = Math.max(0, Math.floor((span - 0.200001) / 0.8)); cell <= Math.floor((span + 0.200001) / 0.8); cell++) dirty.add(cell);
      }
      distance = Math.max(distance, Math.hypot(next.positions[i] - priorMesh.positions[i], next.positions[i + 1] - priorMesh.positions[i + 1], next.positions[i + 2] - priorMesh.positions[i + 2]));
     }
     movement.set(source.sourceIndex, distance);
    } else {
     for (const cell of next.cells ?? []) dirty.add(Math.floor((cell.spanStart + 1e-8) / 0.8));
    }
   }
   created.set(source.sourceIndex, source); originals.set(source.sourceIndex, next);
  }
  const rebuilt = new Set(old.filter(belongs).map(source => source.sourceIndex));
  for (const source of generated) if (belongs(source)) rebuilt.add(source.sourceIndex);
  const bounds = new Map<number, Box[]>();
  for (const source of old) bounds.set(source.sourceIndex, [source.motionBounds]);
  for (const source of originals.values()) {
   const boxes = bounds.get(source.sourceIndex) ?? []; boxes.push(source.motionBounds); bounds.set(source.sourceIndex, boxes);
  }
  // Earlier fixed body ownership cannot change when a later wing moves. Those
  // bodies are local cutters, not propagation bridges to every installed wing.
  let expanded = true;
  while (expanded) {
   expanded = false;
   for (const source of originals.values()) {
    if (rebuilt.has(source.sourceIndex)) continue;
    for (const affected of rebuilt) {
     if (source.kind !== 'wing' && source.sourceIndex < affected) continue;
     if (!bounds.get(affected)?.some(a => bounds.get(source.sourceIndex)!.some(b => overlap(a, b)))) continue;
     rebuilt.add(source.sourceIndex); expanded = true; break;
    }
   }
  }
  const localBoxes = new Map<number, Box[]>();
  for (const source of [...old, ...originals.values()]) {
   const boxes = localBoxes.get(source.sourceIndex) ?? [];
   boxes.push(...(source.cells?.map(cell => cell.motionBounds) ?? [source.motionBounds])); localBoxes.set(source.sourceIndex, boxes);
  }
  const ranges = new Map<number, Set<number>>();
  for (const source of originals.values()) {
   if (source.kind !== 'wing' || !rebuilt.has(source.sourceIndex) || !source.cells || !oldByIndex.get(source.sourceIndex)?.cells) continue;
   const dirty = new Set(forced.get(source.sourceIndex)), priorCells = oldByIndex.get(source.sourceIndex)!.cells!;
   for (const cell of source.cells) {
    const index = Math.floor((cell.spanStart + 1e-8) / 0.8);
    if (dirty.has(index)) continue;
    const priorCell = priorCells.find(oldCell => Math.abs(oldCell.spanStart - cell.spanStart) < 1e-8);
    if (!priorCell) { dirty.add(index); continue; }
    const envelope: Box = { min: [0, 0, 0], max: [0, 0, 0] }, margin = movement.get(source.sourceIndex) ?? 0;
    for (let axis = 0; axis < 3; axis++) {
     envelope.min[axis] = Math.min(cell.motionBounds.min[axis], priorCell.motionBounds.min[axis]) - margin;
     envelope.max[axis] = Math.max(cell.motionBounds.max[axis], priorCell.motionBounds.max[axis]) + margin;
    }
    for (const [otherIndex, boxes] of localBoxes) {
     if (otherIndex === source.sourceIndex) continue;
     const otherMargin = movement.get(otherIndex) ?? 0;
     if (boxes.some(box => box.min.every((value, axis) => value - otherMargin < envelope.max[axis] && box.max[axis] + otherMargin > envelope.min[axis]))) {
      dirty.add(index); break;
     }
    }
   }
   ranges.set(source.sourceIndex, dirty);
  }
  const baseline: CompiledAircraft = { ...previous, partitions: previous.partitions.map(part => {
   const next = originals.get(part.sourceIndex), priorMesh = oldByIndex.get(part.sourceIndex);
   if (part.kind !== 'wing' || !next?.frame || !priorMesh?.frame || !transforms.has(part.sourceIndex)
    || !ranges.has(part.sourceIndex) || ranges.get(part.sourceIndex)!.has(Math.floor((part.spanStart + 1e-8) / 0.8))) return part;
   if (next.frame.matrix.every((value, i) => value === priorMesh.frame!.matrix[i])) return part;
   const prototype = part.prototype ?? { positions: part.positions, frame: priorMesh.frame };
   const matrix = new Matrix4().fromArray(next.frame.matrix).multiply(new Matrix4().fromArray(prototype.frame.matrix).invert());
   const positions = new Float32Array(prototype.positions.length);
   for (let i = 0; i < positions.length; i += 3) {
    point.fromArray(prototype.positions, i).applyMatrix4(matrix); positions[i] = point.x; positions[i + 1] = point.y; positions[i + 2] = point.z;
   }
   return { ...part, positions, prototype, materialId: next.materialId, materialAmount: next.materialAmount };
  }), controls: previous.controls.map(control => {
   const source = [...originals.values()].find(mesh => mesh.kind === 'wing' && mesh.wingInstance === control.wingInstance && mesh.side === control.side);
   const priorMesh = source && oldByIndex.get(source.sourceIndex);
   if (!source?.frame || !priorMesh?.frame || !transforms.has(source.sourceIndex) || !ranges.has(source.sourceIndex)
    || ranges.get(source.sourceIndex)!.has(Math.floor((control.spanStart + 1e-8) / 0.8))) return control;
   if (source.frame.matrix.every((value, i) => value === priorMesh.frame!.matrix[i])) return control;
   const prototype = control.prototype ?? { center: control.center, hinge: control.hinge, axis: control.axis, frame: priorMesh.frame };
   const matrix = new Matrix4().fromArray(source.frame.matrix).multiply(new Matrix4().fromArray(prototype.frame.matrix).invert());
   return { ...control, prototype, center: new Vector3(...prototype.center).applyMatrix4(matrix).toArray() as Vec3,
    hinge: new Vector3(...prototype.hinge).applyMatrix4(matrix).toArray() as Vec3, axis: new Vector3(...prototype.axis).transformDirection(matrix).toArray() as Vec3 };
  }) };
  if (work) {
   for (const source of originals.values()) if (source.kind === 'wing' && rebuilt.has(source.sourceIndex)) {
    const dirty = ranges.get(source.sourceIndex), count = source.cells?.length ?? 0;
    work.cellsRebuilt += dirty?.size ?? count; work.cellsReused += dirty ? count - dirty.size : 0;
   }
  }
  const selected: Source[] = [];
  for (const mesh of originals.values()) {
   const touches = rebuilt.has(mesh.sourceIndex) || [...rebuilt].some(index => bounds.get(index)?.some(a => bounds.get(mesh.sourceIndex)!.some(b => overlap(a, b))));
   if (!touches) continue;
   let source = created.get(mesh.sourceIndex);
   if (!source) {
    const originalID = api.Manifold.reserveIDs(1);
    source = { kind: mesh.kind, sourceIndex: mesh.sourceIndex, wingInstance: mesh.wingInstance, side: mesh.side,
     supportWingInstance: mesh.supportWingInstance, materialId: mesh.materialId, materialAmount: mesh.materialAmount,
     enginePart: mesh.enginePart, engineIndex: mesh.engineIndex,
     originalID, solid: mesh.kind === 'wing' ? wingSolid(d, pool, mesh, 0, Math.abs(wingInstance(d, mesh.wingInstance).wing.points[1].y), 0, 1, originalID).solid : pool.mesh(mesh, originalID), mesh, support: mesh.support, frame: mesh.frame };
   }
   selected.push(source);
  }
  selected.sort((a, b) => a.sourceIndex - b.sourceIndex);
  const result = compileSources(d, pool, selected, baseline, rebuilt, [...originals.values()].sort((a, b) => a.sourceIndex - b.sourceIndex), undefined, ranges);
  installCompiledAircraft(d, result); return result;
 } finally { pool.close(); }
}
