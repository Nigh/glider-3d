import { Matrix4, Triangle, Vector2, Vector3 } from 'three';
import { airfoilY } from './airfoils';
import { finThickness, wingInstance, wingInstanceAirfoil, wingInstancePoint, type AircraftDefinition } from './model';

export interface ClosedMesh { positions: Float32Array; indices: Uint32Array; faceIDs: Uint32Array; coordinates?: Float32Array }
type Point = { x: number; y: number; z: number };

/** Condition Float32 imports near their local origin so Manifold's absolute-coordinate
 * tolerance does not collapse small Boolean edges after a worker transfer. */
export function centeredMeshPositions(positions: Float32Array): { positions: Float32Array; offset: [number, number, number] } {
 const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
 for (let i = 0; i < positions.length; i++) {
  const axis = i % 3; min[axis] = Math.min(min[axis], positions[i]); max[axis] = Math.max(max[axis], positions[i]);
 }
 const offset = min.map((value, axis) => Math.fround((value + max[axis]) / 2)) as [number, number, number];
 if (offset.every(value => value === 0)) return { positions, offset };
 const local = new Float32Array(positions.length);
 for (let i = 0; i < positions.length; i++) local[i] = positions[i] - offset[i % 3];
 return { positions: local, offset };
}

/** Weld shared LE/TE positions before removing zero-area triangles. */
export function closeMesh(points: readonly Point[], triangles: readonly number[], faces?: readonly number[], inputCoordinates?: readonly number[]): ClosedMesh {
 const positions: number[] = [], coordinates: number[] = [], remap: number[] = [], vertices = new Map<string, number>();
 for (const p of points) {
  if (![p.x, p.y, p.z].every(Number.isFinite)) throw Error('Non-finite compiled geometry vertex');
  const xyz = [p.x, p.y, p.z].map(v => Math.fround(Math.round(v * 1e8) / 1e8));
  const key = xyz.join(','); let index = vertices.get(key);
  if (index === undefined) {
   index = positions.length / 3; positions.push(...xyz); vertices.set(key, index);
   if (inputCoordinates) coordinates.push(...inputCoordinates.slice(remap.length * 3, remap.length * 3 + 3));
  }
  remap.push(index);
 }
 const indices: number[] = [], faceIDs: number[] = [], edges = new Map<string, number>(), directions = new Map<string, number>();
 let volume = 0;
 for (let t = 0; t < triangles.length; t += 3) {
  const a = remap[triangles[t]], b = remap[triangles[t + 1]], c = remap[triangles[t + 2]];
  if (a === b || b === c || c === a) continue;
  const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
  const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
  const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
  const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (nx * nx + ny * ny + nz * nz < 1e-26) continue;
  indices.push(a, b, c); faceIDs.push(faces?.[t / 3] ?? 0);
  volume += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  for (const [from, to] of [[a, b], [b, c], [c, a]]) {
   const key = `${Math.min(from, to)},${Math.max(from, to)}`;
   edges.set(key, (edges.get(key) ?? 0) + 1);
   directions.set(key, (directions.get(key) ?? 0) + (from < to ? 1 : -1));
  }
 }
 if (!indices.length || !Number.isFinite(volume) || Math.abs(volume) < 1e-15) throw Error('Compiled input has zero volume');
 if ([...edges.values()].some(count => count !== 2) || [...directions.values()].some(sum => sum !== 0)) throw Error('Compiled input is not a closed oriented two-manifold');
 if (volume < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
 return { positions: new Float32Array(positions), indices: new Uint32Array(indices), faceIDs: new Uint32Array(faceIDs),
  coordinates: inputCoordinates ? new Float32Array(coordinates) : undefined };
}

/** Restore shared source stations after CSG removes collinear loft vertices.
 * Splitting existing planar faces retains the cut material and hinge relief. */
export function restoreSpanStations(mesh: ClosedMesh, stations: readonly number[], selectedFaces: Uint8Array): ClosedMesh {
 if (!mesh.coordinates) throw Error('Wing station refinement requires source coordinates');
 const positions = Array.from(mesh.positions), coordinates = Array.from(mesh.coordinates);
 let indices = Array.from(mesh.indices), faces = Array.from(mesh.faceIDs), selected = Array.from(selectedFaces);
 for (const station of stations) {
  const span = Math.fround(station), edges = new Map<string, number>(), next: number[] = [], nextFaces: number[] = [], nextSelected: number[] = [];
  const intersection = (a: number, b: number): number => {
   if (a > b) [a, b] = [b, a];
   const key = `${a},${b}`, previous = edges.get(key);
   if (previous !== undefined) return previous;
   const t = (span - coordinates[a * 3]) / (coordinates[b * 3] - coordinates[a * 3]), vertex = positions.length / 3;
   for (let axis = 0; axis < 3; axis++) {
    positions.push(Math.fround(positions[a * 3 + axis] + (positions[b * 3 + axis] - positions[a * 3 + axis]) * t));
    coordinates.push(axis === 0 ? span : Math.fround(coordinates[a * 3 + axis] + (coordinates[b * 3 + axis] - coordinates[a * 3 + axis]) * t));
   }
   edges.set(key, vertex); return vertex;
  };
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
   if (!selected[triangle / 3]) continue;
   for (let corner = 0; corner < 3; corner++) {
    const a = indices[triangle + corner], b = indices[triangle + (corner + 1) % 3], from = coordinates[a * 3], to = coordinates[b * 3];
    if (from < span && to > span || from > span && to < span) intersection(a, b);
   }
  }
  const emit = (a: number, b: number, c: number, triangle: number) => {
   next.push(a, b, c); nextFaces.push(faces[triangle / 3]); nextSelected.push(selected[triangle / 3]);
  };
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
   const vertices = indices.slice(triangle, triangle + 3);
   const cuts = vertices.map((a, corner) => {
    const b = vertices[(corner + 1) % 3]; return edges.get(a < b ? `${a},${b}` : `${b},${a}`);
   });
   const count = cuts.filter(cut => cut !== undefined).length;
   if (!count) { emit(vertices[0], vertices[1], vertices[2], triangle); continue; }
   // A neighbouring skin face inherits only the shared edge split, not another
   // span cut across its interior. This keeps the mesh closed without refining all skin.
   if (!selected[triangle / 3] && count === 1) {
    const corner = cuts.findIndex(cut => cut !== undefined), a = vertices[corner], b = vertices[(corner + 1) % 3], c = vertices[(corner + 2) % 3];
    emit(a, cuts[corner]!, c, triangle); emit(cuts[corner]!, b, c, triangle); continue;
   }
   for (const above of [false, true]) {
    const polygon: number[] = [];
    for (let corner = 0; corner < 3; corner++) {
     const a = vertices[corner], b = vertices[(corner + 1) % 3], from = coordinates[a * 3], to = coordinates[b * 3];
     if (above ? from >= span : from <= span) polygon.push(a);
     if (from < span && to > span || from > span && to < span) polygon.push(intersection(a, b));
    }
    for (let corner = 1; corner + 1 < polygon.length; corner++) {
     emit(polygon[0], polygon[corner], polygon[corner + 1], triangle);
    }
   }
  }
  indices = next; faces = nextFaces; selected = nextSelected;
 }
 return { positions: new Float32Array(positions), indices: new Uint32Array(indices),
  faceIDs: new Uint32Array(faces), coordinates: new Float32Array(coordinates) };
}

/** Same section and world transform as the design mesh; no box approximations. */
export function wingMesh(d: AircraftDefinition, id: number, side: number, start: number, end: number, uStart = 0, uEnd = 1, toLocal?: Matrix4): ClosedMesh {
 const { key, wing: w } = wingInstance(d, id), vertical = key === 'verticalTail', half = Math.abs(w.points[1].y);
 const profile: Vector2[] = [];
 const stations = [uStart, uEnd];
 const hinge = 1 - w.controlSurface;
 if (hinge > uStart && hinge < uEnd) stations.push(hinge);
 for (let j = 1; j < 32; j++) { const u = (1 - Math.cos(j * Math.PI / 32)) / 2; if (u > uStart && u < uEnd) stations.push(u); }
 stations.sort((a, b) => a - b);
 for (let i = stations.length - 1; i > 0; i--) if (Math.abs(stations[i] - stations[i - 1]) < 1e-12) stations.splice(i, 1);
 const ordinate = (u: number, face: number) => vertical ? face * finThickness(u) : airfoilY(wingInstanceAirfoil(d, id), u, face);
 for (const u of stations) profile.push(new Vector2(u, ordinate(u, 1)));
 for (const u of stations.slice().reverse()) profile.push(new Vector2(u, ordinate(u, -1)));
 const points: Point[] = [], coordinates: number[] = [], triangles: number[] = [], faces: number[] = [], rows = Math.max(1, Math.ceil((end - start) / 0.2));
 const n = profile.length;
 for (let row = 0; row <= rows; row++) {
  const span = start + (end - start) * row / rows, f = span / half;
  const chord = w.points[3].x - w.points[0].x + (w.points[2].x - w.points[1].x - w.points[3].x + w.points[0].x) * f;
  for (const p of profile) {
   const point = wingInstancePoint(d, id, side, span, p.x, p.y * chord, new Vector3());
   if (toLocal) point.applyMatrix4(toLocal);
   points.push(point);
   coordinates.push(span, p.x, p.y * chord);
  }
 }
 for (let row = 0; row < rows; row++) for (let j = 0; j < n; j++) {
  const a = row * n + j, b = row * n + (j + 1) % n;
  triangles.push(a, b, a + n, b, b + n, a + n);
  // Constant-u hinge/edge walls are caps, not aerodynamic skin.
  const skin = Math.abs(profile[j].x - profile[(j + 1) % n].x) > 1e-10 ? 1 : 0;
  faces.push(skin, skin);
 }
 // Chord-monotone strips retain every boundary vertex. Generic ear clipping may
 // drop collinear DAE-11 stations and leave T-junctions against the loft walls.
 for (let i = 0; i < stations.length - 1; i++) {
  const a = i, b = i + 1, c = n - 2 - i, e = n - 1 - i, tip = rows * n;
  triangles.push(a, c, b, a, e, c, tip + a, tip + b, tip + c, tip + a, tip + c, tip + e); faces.push(0, 0, 0, 0);
 }
 return closeMesh(points, triangles, faces, coordinates);
}

const coordinateScratch = {
 p: new Vector3(), a: new Vector3(), b: new Vector3(), c: new Vector3(), delta: new Vector3(), cross: new Vector3(),
 triangle: new Triangle(), nearest: new Vector3(), barycentric: new Vector3(),
};

/** Invert the shared point mapping, including fin-crown warping and root miters. */
export function wingCoordinates(d: AircraftDefinition, id: number, side: number, point: Point, out: Float32Array, offset: number, source?: ClosedMesh): void {
 const w = wingInstance(d, id).wing, half = Math.abs(w.points[1].y), root = w.points[3].x - w.points[0].x;
 let span = half / 2, u = 0.5, normal = 0;
 const { p, a, b, c, delta, cross } = coordinateScratch;
 for (let step = 0; step < 8; step++) {
  wingInstancePoint(d, id, side, span, u, normal, p); delta.set(point.x - p.x, point.y - p.y, point.z - p.z);
  if (delta.lengthSq() < 1e-18) break;
  const h = 1e-5;
  wingInstancePoint(d, id, side, span + h, u, normal, a).sub(p).multiplyScalar(1 / h);
  wingInstancePoint(d, id, side, span, u + h, normal, b).sub(p).multiplyScalar(1 / h);
  wingInstancePoint(d, id, side, span, u, normal + h, c).sub(p).multiplyScalar(1 / h);
  const determinant = a.dot(cross.crossVectors(b, c));
  if (Math.abs(determinant) < 1e-12) break;
  span += delta.dot(cross) / determinant;
  u += a.dot(cross.crossVectors(delta, c)) / determinant;
  normal += a.dot(cross.crossVectors(b, delta)) / determinant;
  span = Math.max(-half, Math.min(2 * half, span)); u = Math.max(-1, Math.min(2, u)); normal = Math.max(-root, Math.min(root, normal));
 }
 wingInstancePoint(d, id, side, span, u, normal, p);
 if ((p.x - point.x) ** 2 + (p.y - point.y) ** 2 + (p.z - point.z) ** 2 > 1e-7) {
  // The mirrored-fin root miter intentionally collapses one coordinate onto the
  // symmetry plane. Its original cap provides the remaining barycentric mapping.
  if (!source?.coordinates) throw Error('Cannot map compiled wing vertex to its source');
  const { triangle, nearest, barycentric } = coordinateScratch;
  p.set(point.x, point.y, point.z); let distance = Infinity;
  for (let i = 0; i < source.indices.length; i += 3) {
   const ai = source.indices[i] * 3, bi = source.indices[i + 1] * 3, ci = source.indices[i + 2] * 3;
   triangle.a.fromArray(source.positions, ai); triangle.b.fromArray(source.positions, bi); triangle.c.fromArray(source.positions, ci);
   triangle.closestPointToPoint(p, nearest); const squared = nearest.distanceToSquared(p);
   if (squared >= distance || triangle.getArea() < 1e-15) continue;
   distance = squared; triangle.getBarycoord(nearest, barycentric);
   span = barycentric.x * source.coordinates[ai] + barycentric.y * source.coordinates[bi] + barycentric.z * source.coordinates[ci];
   u = barycentric.x * source.coordinates[ai + 1] + barycentric.y * source.coordinates[bi + 1] + barycentric.z * source.coordinates[ci + 1];
   normal = barycentric.x * source.coordinates[ai + 2] + barycentric.y * source.coordinates[bi + 2] + barycentric.z * source.coordinates[ci + 2];
  }
  if (distance > 1e-7) throw Error('Cannot map compiled wing vertex to its source');
 }
 out[offset] = span; out[offset + 1] = u; out[offset + 2] = normal;
}
