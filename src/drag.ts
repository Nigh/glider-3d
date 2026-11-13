import type { BodyEllipsoid } from './model';
import type { Vector3 } from 'three';

export const DRAG_TERMS = ['wingProfile', 'wingSeparated', 'wingSpanwise', 'bodyPressure', 'bodySkin', 'fuselage', 'engineNacelle', 'engineSupport', 'water', 'induced'] as const;
export type DragTerm = typeof DRAG_TERMS[number];

/** Signed resistance along the undisturbed relative flow. All terms share this
 * axis, so their displayed values add even with rotation or local reverse flow. */
export function dragResistance(force: Vector3, axis: Vector3): number { return -force.dot(axis); }

// Positive nodes/weights of 16-point Gauss-Legendre quadrature on [-1,1].
const nodes = [0.09501250983763744, 0.2816035507792589, 0.4580167776572274, 0.6178762444026438, 0.755404408355003, 0.8656312023878318, 0.9445750230732326, 0.9894009349916499];
const weights = [0.1894506104550685, 0.1826034150449236, 0.16915651939500254, 0.14959598881657673, 0.12462897125553387, 0.09515851168249279, 0.06225352393864789, 0.027152459411754095];

/** Ellipsoid surface integral abc ∫sqrt(nx²/a²+ny²/b²+nz²/c²)dΩ.
 * Geometry only; the friction coefficient and exposed-canopy fraction are
 * separate model assumptions. Evaluated at construction, never per time step. */
export function ellipsoidSurfaceArea(shape: Pick<BodyEllipsoid, 'xRadius' | 'yRadius' | 'zRadius'>): number {
  const { xRadius: a, yRadius: b, zRadius: c } = shape;
  let integral = 0;
  for (let i = 0; i < nodes.length; i++) for (let j = 0; j < 32; j++) {
    const z = nodes[i], phi = (j + 0.5) * Math.PI / 16, radial = 1 - z * z;
    integral += 2 * weights[i] * Math.sqrt(radial * ((Math.cos(phi) / a) ** 2 + (Math.sin(phi) / b) ** 2) + (z / c) ** 2);
  }
  return a * b * c * Math.PI / 16 * integral;
}
