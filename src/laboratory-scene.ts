import * as THREE from 'three';
import type { AircraftDefinition } from './model';
import type { FlightSimulation } from './physics';
import { TEST_SPACE, testSpaceTerrainHeight, windTunnelRoom, type LaboratoryMode } from './laboratory';

/** Environment objects share SceneView's normal disposal and rendering lifecycle. */
export class LaboratoryScene {
  readonly platform = new THREE.Group();
  private carriage: THREE.Mesh | null = null;
  private flow: THREE.LineSegments | null = null;
  private readonly flowPositions = new Float32Array(512 * 6);
  private flowDistance = 0;
  private lastTime = 0;
  readonly room;
  constructor(readonly mode: LaboratoryMode, definition: AircraftDefinition, private readonly root: THREE.Group) {
    this.room = windTunnelRoom(definition);
    if (mode === 'test-space') this.buildTestSpace(); else this.buildWindTunnel();
  }

  private box(parent: THREE.Group, name: string, size: number[], position: number[], color: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size as [number, number, number]), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    mesh.name = name; mesh.position.fromArray(position); parent.add(mesh); return mesh;
  }

  private buildTestSpace() {
    const { halfSize, step } = TEST_SPACE, count = halfSize * 2 / step + 1;
    const positions = new Float32Array(count * count * 3), colors = new Float32Array(positions.length);
    const indices = new Uint32Array((count - 1) ** 2 * 6), color = new THREE.Color();
    let index = 0;
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
      const x = -halfSize + col * step, z = -halfSize + row * step, y = testSpaceTerrainHeight(x, z), offset = (row * count + col) * 3;
      positions.set([x, y, z], offset);
      color.setHex(Math.abs(z) <= 25 ? 0xdac7a0 : z > 25 ? 0x92a8a1 : y > 3800 ? 0xe1e7e5 : y > 1800 ? 0x92958a : 0x78916d);
      colors.set([color.r, color.g, color.b], offset);
      if (col < count - 1 && row < count - 1) {
        const a = row * count + col, b = a + count;
        indices.set([a, b, a + 1, a + 1, b, b + 1], index); index += 6;
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeVertexNormals();
    const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    terrain.name = 'test-space-terrain'; this.root.add(terrain);
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(halfSize * 2, halfSize - 25), new THREE.MeshStandardMaterial({ color: 0x6a9fae, roughness: 0.25, metalness: 0.15, transparent: true, opacity: 0.94 }));
    ocean.name = 'test-space-ocean'; ocean.rotation.x = -Math.PI / 2; ocean.position.set(0, 0, (halfSize + 25) / 2); this.root.add(ocean);
    const bounds = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(10000, 10000, 10000)), new THREE.LineBasicMaterial({ color: 0xa3b5ae, transparent: true, opacity: 0.18 }));
    bounds.name = 'test-space-boundary'; bounds.position.y = 5000; this.root.add(bounds);
    this.platform.name = 'balloon-launch-platform'; this.platform.position.x = TEST_SPACE.platformX; this.root.add(this.platform);
    this.box(this.platform, 'test-platform-deck', [50, 0.8, 40], [0, -0.4, 0], 0x677975);
    for (const side of [-1, 1]) {
      this.box(this.platform, 'platform-edge', [50, 0.06, 0.25], [0, 0.03, side * 19], 0xe8d4a0);
      this.box(this.platform, 'test-space-rail', [50, 0.2, 0.12], [0, 1.9, side * 0.65], 0x9baaa8);
      for (let x = -25; x <= 25; x += 10) this.box(this.platform, 'rail-post', [0.16, 1.8, 0.16], [x, 0.9, side * 0.65], 0x879896);
      for (const x of [-24, 24]) {
        const balloon = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ color: side < 0 ? 0xe2b083 : 0xd8ded0, roughness: 0.85 }));
        balloon.name = 'platform-balloon'; balloon.position.set(x, 36, side * 19); balloon.scale.set(5, 8, 5); this.platform.add(balloon);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 28, 5), new THREE.MeshStandardMaterial({ color: 0xb9b19a }));
        rope.name = 'balloon-tether'; rope.position.set(x, 14, side * 19); this.platform.add(rope);
      }
    }
    this.carriage = this.box(this.platform, 'test-space-carriage', [1.3, 0.3, 1.7], [-25, 1.9, 0], 0xd5a45c);
  }

  private gridTexture(width: number, height: number) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d')!;
    // Deterministic fine aggregate gives concrete variation without competing
    // with the aircraft or the metre grid.
    const pixels = context.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const shade = 65 + ((Math.imul(i + 1, 16807) >>> 4) % 13);
      pixels.data.set([shade, shade + 2, shade + 3, 255], i * 4);
    }
    context.putImageData(pixels, 0, 0);
    context.strokeStyle = '#62686a'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(0, 256); context.lineTo(0, 0); context.lineTo(256, 0); context.stroke();
    context.strokeStyle = '#7c8385'; context.lineWidth = 1;
    context.beginPath();
    for (let tick = 1; tick < 10; tick++) {
      const p = tick * 25.6;
      context.moveTo(p, 0); context.lineTo(p, tick === 5 ? 12 : 7);
      context.moveTo(0, p); context.lineTo(tick === 5 ? 12 : 7, p);
    }
    context.stroke();
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(width, height); texture.anisotropy = 4;
    return texture;
  }

  private buildWindTunnel() {
    const { halfX: x, halfY: y, halfZ: z, centerY } = this.room;
    const walls = [
      { name: 'front', width: 2 * x, height: 2 * y, position: [0, centerY, z], rotation: [0, Math.PI, 0] },
      { name: 'back', width: 2 * x, height: 2 * y, position: [0, centerY, -z], rotation: [0, 0, 0] },
      { name: 'right', width: 2 * z, height: 2 * y, position: [x, centerY, 0], rotation: [0, -Math.PI / 2, 0] },
      { name: 'left', width: 2 * z, height: 2 * y, position: [-x, centerY, 0], rotation: [0, Math.PI / 2, 0] },
      { name: 'ceiling', width: 2 * x, height: 2 * z, position: [0, centerY + y, 0], rotation: [Math.PI / 2, 0, 0] },
      { name: 'floor', width: 2 * x, height: 2 * z, position: [0, centerY - y, 0], rotation: [-Math.PI / 2, 0, 0] },
    ];
    for (const wall of walls) {
      // Inward faces provide a cutaway automatically when the camera is outside.
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wall.width, wall.height), new THREE.MeshBasicMaterial({ map: this.gridTexture(wall.width, wall.height) }));
      mesh.name = `wind-tunnel-${wall.name}`; mesh.position.fromArray(wall.position); mesh.rotation.set(...wall.rotation as [number, number, number]);
      mesh.userData.gridMeters = 1; mesh.userData.tickMeters = 0.1; mesh.userData.finish = 'dark-concrete'; this.root.add(mesh);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(this.flowPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.flow = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xb6dedc, transparent: true, opacity: 0.45, depthWrite: false }));
    this.flow.name = 'wind-tunnel-airflow'; this.flow.frustumCulled = false; this.root.add(this.flow);
  }

  update(sim: FlightSimulation) {
    if (this.mode === 'test-space') {
      this.platform.position.y = sim.testSpace.height;
      if (this.carriage) this.carriage.position.x = sim.launching ? Math.max(-25, Math.min(25, (sim.railAttached ? sim.railPositionX : sim.position.x) - TEST_SPACE.platformX)) : 25;
      return;
    }
    if (!this.flow) return;
    const dt = Math.max(0, sim.elapsedTime - this.lastTime); this.lastTime = sim.elapsedTime;
    this.flowDistance += sim.windTunnel.speed * dt;
    const { halfX, halfY, halfZ, centerY } = this.room, count = sim.windTunnel.speed > 0 ? Math.min(512, Math.round(80 + sim.windTunnel.speed * 2)) : 0;
    for (let i = 0; i < count; i++) {
      const phase = (i * 0.61803398875 % 1) * halfX * 2;
      const x = halfX - ((phase + this.flowDistance) % (halfX * 2));
      const y = centerY + (Math.sin(i * 127.1) * 43758.5453 % 1) * halfY * 0.85;
      const z = (Math.sin(i * 311.7) * 15431.31 % 1) * halfZ * 0.9;
      const length = 0.15 + sim.windTunnel.speed * 0.025;
      this.flowPositions.set([x, y, z, Math.min(halfX, x + length), y, z], i * 6);
    }
    this.flow.geometry.setDrawRange(0, count * 2); this.flow.geometry.getAttribute('position').needsUpdate = true;
    this.flow.userData.speed = sim.windTunnel.speed; this.flow.userData.direction = '-X';
  }
}
