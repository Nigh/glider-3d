import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, clone, DEG, defaultAircraft, fuselageEnds, mainWingMountLimits, mainWingSupport, resizeFuselage, wingOrigin, PILOT_MASS, type AircraftDefinition, type Wing, type WingKey } from './model';
import { LAUNCH, launchHeight, derive, type FlightSimulation } from './physics';

type Quality = 'Auto' | 'High' | 'Medium' | 'Low';
const UP = new THREE.Vector3(0, 1, 0);
const WING_TRAIL_CAPACITY = 192;
const TRAIL_CAPACITY = 8192;
const PARTICLES = 64;
type EditorTarget = 'mainWing' | 'horizontalTail' | 'verticalTail' | 'assembly' | null;
const DOWN = new THREE.Vector3(0, -1, 0);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 湖区只构建一次；设计变更只替换飞机，所有动态缓冲区重复使用。 */
export class SceneView {
  readonly metrics = { fps: 60, mean: 16.7, p95: 16.7, p99: 16.7, renderMs: 0, geometryMs: 0, drawCalls: 0, triangles: 0, memory: 0, quality: 'Medium', geometries: 0, textures: 0, programs: 0 };
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly perspective = new THREE.PerspectiveCamera(43, 1, 0.1, 3000);
  private readonly orthographic = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 3000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private readonly controls: OrbitControls;
  private readonly aircraft = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly pilot = new THREE.Group();
  private readonly driver = new THREE.Group();
  private readonly aircraftMaterials = {
    ivory: new THREE.MeshStandardMaterial({ color: 0xf4f0dc, roughness: 0.65, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
    main: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.02, flatShading: true, side: THREE.DoubleSide, vertexColors: true }),
    orange: new THREE.MeshStandardMaterial({ color: 0xd97343, roughness: 0.7, flatShading: true, side: THREE.DoubleSide }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x344740, roughness: 0.67, metalness: 0.2, flatShading: true }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd2a07e, roughness: 1, flatShading: true }),
    suit: new THREE.MeshStandardMaterial({ color: 0x53675e, roughness: 1, flatShading: true }),
  };
  private readonly strutGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  private readonly wingMeshes: THREE.Mesh[] = [];
  private readonly wingParameters = new Float64Array(36).fill(NaN);
  private readonly wingBaseColor = new THREE.Color(0xf4f0dc);
  private readonly wingTipColor = new THREE.Color(0xd97343);
  private beam!: THREE.Mesh;
  private support!: THREE.Mesh;
  private nose!: THREE.Mesh;
  private aircraftPending = false;
  private readonly detail = new THREE.Group();
  private readonly debugGroup = new THREE.Group();
  private readonly environment = new THREE.Group();
  private readonly environmentFog = new THREE.FogExp2(0xd4e3e4, 0.00165);
  private readonly light = new THREE.DirectionalLight(0xffedcf, 3.3);
  private readonly cg = this.centerMarker('cg');
  private readonly liftCenter = this.centerMarker('lift');
  private readonly designLiftCenter = new THREE.Vector3();
  private readonly dragCenter = this.centerMarker('drag');
  private readonly centerMarkers = [this.cg, this.liftCenter, this.dragCenter];
  private readonly designDragCenter = new THREE.Vector3();
  private readonly designLiftDirection = new THREE.Vector3();
  private readonly designDragDirection = new THREE.Vector3();
  private designLiftVisible = true;
  private designDragVisible = true;
  private readonly terrain: THREE.Object3D[] = [];
  private readonly groundRay = new THREE.Raycaster();
  private readonly groundHits: THREE.Intersection[] = [];
  private readonly editRay = new THREE.Raycaster();
  private readonly editPlane = new THREE.Plane();
  private readonly editPointer = new THREE.Vector2();
  private readonly editPoint = new THREE.Vector3();
  private readonly editOrigin = new THREE.Vector3();
  private readonly editStart = new THREE.Vector3();
  private readonly editProjection = new THREE.Vector3();
  private readonly editorOverlay = document.createElementNS(SVG_NS, 'svg');
  private readonly editorPolygons: SVGPolygonElement[] = [];
  private readonly editorHandles: { group: SVGGElement; index: number; side: number; x: number; y: number }[] = [];
  private readonly editorSegments: { group: SVGGElement; index: number; side: number; x1: number; y1: number; x2: number; y2: number }[] = [];
  private editorSegmentDrag = -1;
  private readonly editorSnap: { active: boolean; kind: 'grid' | 'vertex' | 'mount' | null; value: number | null; disabled: boolean } = { active: false, kind: null, value: null, disabled: false };
  private editorTarget: EditorTarget = null;
  private editorChange: ((definition: AircraftDefinition) => void) | null = null;
  private editorCommit: (() => void) | null = null;
  private readonly cancelEditorDrag = () => this.endEditorDrag(true);
  private editorDrag = -1;
  private editorPointerId = -1;
  private editorChanged = false;
  private editDefinition: AircraftDefinition | null = null;
  private editorDirty = true;
  private readonly trailArray = new Float32Array(TRAIL_CAPACITY * 6);
  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly trail: THREE.LineSegments;
  private readonly lastTrail = new THREE.Vector3();
  private trailClock = 0;
  private trailIndex = 0;
  private trailCount = 0;
  private readonly wingTrailArray = new Float32Array(WING_TRAIL_CAPACITY * 36);
  private readonly wingTrailColors = new Float32Array(WING_TRAIL_CAPACITY * 36);
  private readonly wingTrailGeometry = new THREE.BufferGeometry();
  private readonly wingTrail: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly wingTrailHistory = new Float32Array((WING_TRAIL_CAPACITY + 1) * 6);
  private readonly wingTrailTimes = new Float64Array(WING_TRAIL_CAPACITY + 1);
  private readonly wingTrailPoint = new THREE.Vector3();
  private readonly wingTrailOlder = new THREE.Vector3();
  private readonly wingTrailWidth = new THREE.Vector3();
  private wingTrailActive = false;
  private readonly arrows: THREE.ArrowHelper[] = [];
  private readonly applicationMarkers: THREE.Mesh[] = [];
  private readonly splashPositions = new Float32Array(PARTICLES * 3);
  private readonly splashVelocities = new Float32Array(PARTICLES * 3);
  private readonly splashGeometry = new THREE.BufferGeometry();
  private readonly splash: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly waterTime = { value: 0 };
  private readonly frameTimes = new Float32Array(180);
  private readonly sortedTimes = new Float32Array(180);
  private readonly target = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly vector = new THREE.Vector3();
  private readonly vector2 = new THREE.Vector3();
  private wingTrailTime = -1;
  private readonly designCG = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly layoutObserver: MutationObserver;
  private simulation: FlightSimulation | null = null;
  private definition: AircraftDefinition = defaultAircraft;
  private view = 'orbit';
  private quality: Quality = 'Auto';
  private level = 1;
  private width = 1;
  private height = 1;
  private debug = false;
  private elapsed = 0;
  private sampleCount = 0;
  private sampleIndex = 0;
  private statisticsClock = 0;
  private qualityClock = 0;
  private slowTime = 0;
  private fastTime = 0;
  private wingTrailIndex = 0;
  private wingTrailCount = 0;
  private splashAge = -1;
  private wasInWater = false;
  private disposed = false;
  private readonly coarsePointer = matchMedia('(pointer: coarse)').matches;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0xd4e3e4);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:-4px';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', '滑空机三维视图。拖动旋转，滚轮缩放，右键或双指平移。');
    this.host.appendChild(this.renderer.domElement);
    this.buildEditorOverlay();
    this.scene.background = new THREE.Color(0xd4e3e4);
    this.scene.fog = this.environmentFog;
    this.scene.add(new THREE.HemisphereLight(0xe6f1ff, 0x6c7860, 2.6));
    this.light.position.set(-55, 110, 65);
    this.light.castShadow = true;
    this.light.shadow.camera.left = -35;
    this.light.shadow.camera.right = 35;
    this.light.shadow.camera.top = 35;
    this.light.shadow.camera.bottom = -35;
    this.light.shadow.camera.near = 1;
    this.light.shadow.camera.far = 230;
    this.light.shadow.bias = -0.00035;
    this.light.shadow.normalBias = 0.06;
    this.scene.add(this.light, this.light.target, this.aircraft, this.environment, this.debugGroup);
    this.environment.add(this.detail);
    this.cg.renderOrder = this.liftCenter.renderOrder = this.dragCenter.renderOrder = 20;
    this.buildEnvironment();
    this.wingTrailGeometry.setAttribute('position', new THREE.BufferAttribute(this.wingTrailArray, 3).setUsage(THREE.DynamicDrawUsage));
    this.wingTrailGeometry.setAttribute('color', new THREE.BufferAttribute(this.wingTrailColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.wingTrailGeometry.setDrawRange(0, 0);
    this.wingTrail = new THREE.Mesh(this.wingTrailGeometry, new THREE.MeshBasicMaterial({ color: 0xf5fcff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.wingTrail.frustumCulled = false;
    this.wingTrail.visible = false;
    this.scene.add(this.wingTrail);
    this.trailGeometry.setAttribute('position', new THREE.BufferAttribute(this.trailArray, 3).setUsage(THREE.DynamicDrawUsage));
    this.trailGeometry.setDrawRange(0, 0);
    this.trail = new THREE.LineSegments(this.trailGeometry, new THREE.LineBasicMaterial({ color: 0xf0b553, transparent: true, opacity: 0.85, depthWrite: false }));
    this.trail.frustumCulled = false;
    this.debugGroup.add(this.trail);
    const arrowColors = [0x3bada1, 0xf08b5b, 0xa493c3, 0x3686bd, 0x3bada1, 0x3bada1, 0x3bada1, 0x3bada1, 0xf08b5b];
    for (const color of arrowColors) {
      const arrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, color, 0.35, 0.18);
      (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
      (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
      arrow.visible = false;
      this.arrows.push(arrow);
      this.debugGroup.add(arrow);
    }
    const markerGeometry = new THREE.SphereGeometry(0.1, 8, 6);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffd777, depthTest: false });
    for (let i = 0; i < 12; i++) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.visible = false;
      this.applicationMarkers.push(marker);
      this.debugGroup.add(marker);
    }
    this.splashGeometry.setAttribute('position', new THREE.BufferAttribute(this.splashPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.splash = new THREE.Points(this.splashGeometry, new THREE.PointsMaterial({ color: 0xeafafa, size: 0.2, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true }));
    this.splash.frustumCulled = false;
    this.splash.visible = false;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 40), new THREE.MeshBasicMaterial({ color: 0xe0f4eb, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.splash, this.ring);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 700;
    this.controls.maxPolarAngle = Math.PI * 0.94;
    this.controls.minZoom = 0.1;
    this.controls.maxZoom = 10;
    this.controls.addEventListener('change', () => { this.editorDirty = true; });
    this.level = 0;
    this.applyQuality();
    this.buildAircraft();
    this.updateAircraft(defaultAircraft);
    this.applyAircraft();
    this.cameraView('orbit');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.layoutObserver = new MutationObserver(() => this.resize());
    if (host.parentElement) this.layoutObserver.observe(host.parentElement, { childList: true });
    this.resize();
    this.metrics.memory = this.geometryMemory();
    this.debugGroup.visible = false;
    window.addEventListener('blur', this.cancelEditorDrag);
  }

  setEditor(target: EditorTarget, onchange: (definition: AircraftDefinition) => void, oncommit: () => void): void {
    this.editorChange = onchange;
    this.editorCommit = oncommit;
    if (this.editorTarget === target) return;
    this.endEditorDrag();
    this.editorTarget = target;
    this.editorDirty = true;
    this.updateEnvironment();
    if (!this.simulation) this.cameraView(target ? target === 'mainWing' || target === 'horizontalTail' ? 'top' : 'side' : 'orbit');
    this.updateEditorOverlay();
  }

  getDiagnostics() {
    const position = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
    const support = mainWingSupport(this.definition);
    const supportPoints = this.support.geometry.getAttribute('position');
    const supportBounds = new THREE.Box3().setFromBufferAttribute(supportPoints as THREE.BufferAttribute).applyMatrix4(this.support.matrix);
    const supportCorner = (front: boolean, mounted: boolean) => position(new THREE.Vector3(
      front ? 0.5 : -0.5, (mounted ? 1 : -1) * Math.sign(support.height) / 2, 0,
    ).applyMatrix4(this.support.matrix));
    return {
      view: this.view, orthographic: this.camera === this.orthographic,
      camera: position(this.camera.position), target: position(this.controls.enabled ? this.controls.target : this.target),
      groundHeight: this.surfaceHeight(this.camera.position.x, this.camera.position.z),
      editing: this.editorTarget, shadowVisible: this.renderer.shadowMap.enabled,
      editor: {
        target: this.editorTarget, dragging: this.editorDrag, segment: this.editorSegmentDrag < 0 ? null : this.editorSegments[this.editorSegmentDrag].index === 0 ? '14' : '23',
        snap: { ...this.editorSnap },
        fuselageEnds: fuselageEnds(this.definition),
        mainWingMountLimits: mainWingMountLimits(this.definition), mountSnapTolerance: this.mountSnapTolerance(),
        handles: this.editorTarget && !this.simulation ? this.editorHandles.filter(h => h.group.style.display !== 'none').map(h => ({ handle: Number(h.group.getAttribute('data-handle')), index: h.index, side: h.side, x: h.x, y: h.y })) : [],
        segments: this.editorTarget && !this.simulation ? this.editorSegments.filter(s => s.group.style.display !== 'none').map(s => ({ id: s.index === 0 ? '14' : '23', side: s.side, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })) : [],
      },
      aircraft: position(this.aircraft.position),
      centers: { cg: position(this.cg.position), lift: position(this.liftCenter.position), drag: position(this.dragCenter.position) },
      centerVisibility: { cg: this.cg.visible, lift: this.liftCenter.visible, drag: this.dragCenter.visible },
      wingGeometry: this.wingMeshes.map((mesh, index) => {
        const points = mesh.geometry.getAttribute('position');
        return { incidence: this.wingParameters[index * 12 + 11], leading: { x: points.getX(0), y: points.getY(0), z: points.getZ(0) }, trailing: { x: points.getX(16), y: points.getY(16), z: points.getZ(16) } };
      }),
      wingRoots: Object.fromEntries(this.wingMeshes.map((mesh, index) => {
        const key: WingKey = index === 0 ? 'mainWing' : index === 1 ? 'horizontalTail' : 'verticalTail';
        const points = mesh.geometry.getAttribute('position');
        const leading = new THREE.Vector3().fromBufferAttribute(points, 0);
        const trailing = new THREE.Vector3().fromBufferAttribute(points, 16);
        return [key, { origin: wingOrigin(this.definition, key), leading: position(leading), trailing: position(trailing), midpoint: position(leading.add(trailing).multiplyScalar(0.5)) }];
      })),
      support: {
        ...support, visible: this.support.visible, thickness: 0.06,
        geometry: this.support.visible ? {
          vertices: supportPoints.count, triangles: (this.support.geometry.index?.count ?? supportPoints.count) / 3,
          bounds: { min: position(supportBounds.min), max: position(supportBounds.max) },
          top: { front: supportCorner(true, true), back: supportCorner(false, true) },
          bottom: { front: supportCorner(true, false), back: supportCorner(false, false) },
        } : null,
      },
      environmentVisible: this.environment.visible,
      wingTrail: { active: this.wingTrailActive, segments: this.wingTrailGeometry.drawRange.count / 6, opacity: this.wingTrail.material.opacity, style: 'ribbon' },
    };
  }

  private positionAtLaunch(): void {
    this.aircraft.position.set(LAUNCH.startX, launchHeight(this.definition, this.designCG), 0);
  }

  private centerMarker(kind: 'cg' | 'lift' | 'drag'): THREE.Group {
    const marker = new THREE.Group();
    const surface = new THREE.MeshBasicMaterial({ color: kind === 'cg' ? 0xffd52a : kind === 'lift' ? 0x19b9ef : 0xe43c3c, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const black = new THREE.MeshBasicMaterial({ color: 0x17201d, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const add = (geometry: THREE.BufferGeometry, material: THREE.MeshBasicMaterial) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 21;
      marker.add(mesh);
      return mesh;
    };
    for (let hemisphere = 0; hemisphere < 2; hemisphere++) {
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        add(new THREE.SphereGeometry(0.43, 8, 6, quadrant * Math.PI / 2, Math.PI / 2, hemisphere * Math.PI / 2, Math.PI / 2),
          (quadrant + hemisphere) % 2 ? black : surface);
      }
    }
    if (kind === 'cg') {
      const crossGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1.65, 8);
      const vertical = add(crossGeometry, black);
      const horizontal = add(crossGeometry, black);
      vertical.renderOrder = horizontal.renderOrder = 20;
      horizontal.rotation.z = Math.PI / 2;
    } else {
      const ring = add(new THREE.TorusGeometry(0.53, 0.045, 6, 24), surface);
      ring.rotation.x = Math.PI / 2;
      const shaft = add(new THREE.CylinderGeometry(0.055, 0.055, 0.85, 8), surface);
      shaft.position.y = 0.65;
      const head = add(new THREE.ConeGeometry(0.2, 0.4, 10), surface);
      head.position.y = 1.23;
    }
    return marker;
  }

  private updateCenters(): void {
    const sim = this.simulation, visible = !sim || this.debug;
    const lift = sim ? sim.telemetry.aerodynamics.liftCenter : this.designLiftVisible ? this.designLiftCenter : null;
    const drag = sim ? sim.telemetry.aerodynamics.dragCenter : this.designDragVisible ? this.designDragCenter : null;
    this.cg.visible = visible;
    this.liftCenter.visible = visible && !!lift;
    this.dragCenter.visible = visible && !!drag;
    this.cg.position.copy(this.aircraft.position);
    if (lift) this.liftCenter.position.copy(lift).sub(sim?.telemetry.cg ?? this.designCG)
      .applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    if (drag) this.dragCenter.position.copy(drag).sub(sim?.telemetry.cg ?? this.designCG)
      .applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    this.cg.quaternion.copy(this.camera.quaternion);
    const aero = sim?.telemetry.aerodynamics;
    this.vector.copy(aero?.lift ?? this.designLiftDirection).applyQuaternion(this.aircraft.quaternion);
    if (this.vector.lengthSq() > 1e-12) this.liftCenter.quaternion.setFromUnitVectors(UP, this.vector.normalize());
    this.vector.copy(aero?.drag ?? this.designDragDirection).applyQuaternion(this.aircraft.quaternion);
    if (this.vector.lengthSq() > 1e-12) this.dragCenter.quaternion.setFromUnitVectors(UP, this.vector.normalize());
    this.camera.getWorldDirection(this.vector2);
    for (const marker of this.centerMarkers) {
      const depth = this.vector.copy(marker.position).sub(this.camera.position).dot(this.vector2);
      const metresPerPixel = this.camera === this.orthographic
        ? (this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom / this.height
        : 2 * Math.max(0.1, depth) * Math.tan(this.perspective.fov * DEG / 2) / this.height;
      marker.scale.setScalar(metresPerPixel * 16);
    }
  }

  private updateEnvironment(): void {
    const editing = !!this.editorTarget && !this.simulation;
    this.environment.visible = !editing;
    this.scene.fog = editing ? null : this.environmentFog;
    this.debugGroup.visible = this.debug && !editing;
  }

  private surfaceHeight(x: number, z: number): number {
    this.groundRay.set(this.vector.set(x, 1000, z), DOWN);
    this.groundHits.length = 0;
    this.groundRay.intersectObjects(this.terrain, false, this.groundHits);
    return Math.max(0, this.groundHits[0]?.point.y ?? 0);
  }

  private constrainCamera(): void {
    if (this.editorTarget && !this.simulation) return;
    const minimum = this.surfaceHeight(this.camera.position.x, this.camera.position.z) + 0.55;
    if (this.camera.position.y >= minimum) return;
    const correction = minimum - this.camera.position.y;
    this.camera.position.y = minimum;
    if (this.controls.enabled) this.controls.target.y += correction;
    this.camera.lookAt(this.controls.enabled ? this.controls.target : this.target);
  }

  private buildEditorOverlay(): void {
    const overlay = this.editorOverlay;
    overlay.classList.add('scene-editor');
    overlay.setAttribute('aria-label', '真实翼面与部件位置编辑');
    overlay.style.cssText = 'display:none;position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;touch-action:none';
    for (let i = 0; i < 2; i++) {
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.setAttribute('fill', '#b84a2b');
      polygon.setAttribute('fill-opacity', '0.12');
      polygon.setAttribute('stroke', '#a33f24');
      polygon.setAttribute('stroke-width', '1.5');
      overlay.appendChild(polygon);
      this.editorPolygons.push(polygon);
    }
    for (let i = 0; i < 3; i++) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.style.cssText = 'pointer-events:all;cursor:grab;outline:none';
      for (const hit of [true, false]) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('stroke', hit ? 'transparent' : '#a33f24');
        line.setAttribute('stroke-width', hit ? '18' : '3');
        if (!hit) line.style.pointerEvents = 'none';
        group.appendChild(line);
      }
      this.editorSegments.push({ group, index: i === 0 ? 0 : 1, side: i === 2 ? -1 : 1, x1: 0, y1: 0, x2: 0, y2: 0 });
      group.addEventListener('pointerdown', e => this.beginEditorDrag(e, i, true));
      group.addEventListener('keydown', e => this.keyEditor(e, i, true));
      group.addEventListener('focus', () => group.lastElementChild!.setAttribute('stroke-width', '6'));
      group.addEventListener('blur', () => group.lastElementChild!.setAttribute('stroke-width', '3'));
      overlay.appendChild(group);
    }
    for (let i = 0; i < 6; i++) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.style.cssText = 'pointer-events:all;cursor:grab;outline:none';
      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('r', '22');
      hit.setAttribute('fill', 'transparent');
      const point = document.createElementNS(SVG_NS, 'circle');
      point.setAttribute('r', '6');
      point.setAttribute('fill', '#fafbf6');
      point.setAttribute('stroke', '#a33f24');
      point.setAttribute('stroke-width', '2');
      point.style.pointerEvents = 'none';
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', '11'); text.setAttribute('y', '-10');
      text.setAttribute('fill', '#173e43'); text.setAttribute('font-size', '12');
      text.setAttribute('paint-order', 'stroke'); text.setAttribute('stroke', '#fafbf6');
      text.setAttribute('stroke-width', '3');
      text.style.pointerEvents = 'none';
      group.append(hit, point, text);
      const handle = { group, index: i < 4 ? i : i - 3, side: i < 4 ? 1 : -1, x: 0, y: 0 };
      this.editorHandles.push(handle);
      group.addEventListener('pointerdown', e => this.beginEditorDrag(e, i));
      group.addEventListener('focus', () => { point.setAttribute('r', '9'); });
      group.addEventListener('blur', () => { point.setAttribute('r', '6'); });
      group.addEventListener('keydown', e => this.keyEditor(e, i));
      overlay.appendChild(group);
    }
    overlay.addEventListener('pointermove', e => this.moveEditorDrag(e));
    overlay.addEventListener('pointerup', e => { if (e.pointerId === this.editorPointerId) this.endEditorDrag(); });
    overlay.addEventListener('pointercancel', e => { if (e.pointerId === this.editorPointerId) this.endEditorDrag(true); });
    overlay.addEventListener('lostpointercapture', e => { if (e.pointerId === this.editorPointerId) this.endEditorDrag(true); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape' && (this.editorDrag >= 0 || this.editorSegmentDrag >= 0)) {
        e.preventDefault(); e.stopPropagation(); this.endEditorDrag(true);
      }
    });
    this.host.appendChild(overlay);
  }

  private wingEditorPoint(index: number, side: number, out: THREE.Vector3): THREE.Vector3 {
    const key = this.editorTarget;
    if (!key || key === 'assembly') return out.set(0, 0, 0);
    const wing = this.definition[key], point = wing.points[index], origin = wingOrigin(this.definition, key);
    const vertical = key === 'verticalTail';
    const incidence = (key === 'mainWing' ? this.definition.assembly.mainIncidence : key === 'horizontalTail' ? this.definition.assembly.tailIncidence : 0) * DEG;
    if (vertical) out.set(origin.x - point.x, origin.y + point.y, 0);
    else out.set(origin.x - point.x * Math.cos(incidence),
      origin.y - point.x * Math.sin(incidence) + point.y * Math.tan(wing.dihedral * DEG), point.y * side);
    return out;
  }

  private assemblyEditorPoint(index: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.definition;
    if (index === 0 || index === 1) {
      const key = index === 0 ? 'mainWing' : 'horizontalTail';
      const wing = d[key], origin = wingOrigin(d, key);
      const incidence = (index === 0 ? d.assembly.mainIncidence : d.assembly.tailIncidence) * DEG;
      const chord = (wing.points[0].x + wing.points[3].x) / 2;
      return out.set(origin.x - chord * Math.cos(incidence), origin.y - chord * Math.sin(incidence), 0);
    }
    if (index === 2) {
      const origin = wingOrigin(d, 'verticalTail');
      return out.set(origin.x - (d.verticalTail.points[0].x + d.verticalTail.points[3].x) / 2, origin.y, 0);
    }
    if (index === 4 || index === 5) return out.set(fuselageEnds(d)[index === 4 ? 'nose' : 'tail'], 0, 0);
    return out.set(d.cockpit.position, 0.55, 0);
  }

  private updateEditorOverlay(): void {
    const key = this.editorTarget, visible = !!key && !this.simulation;
    this.editorOverlay.style.display = visible ? 'block' : 'none';
    if (!visible || !key || !this.editorDirty) return;
    this.editorDirty = false;
    this.editorOverlay.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.aircraft.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const label = key === 'mainWing' ? '主翼' : key === 'horizontalTail' ? '水平尾翼' : '垂直尾翼';
    for (let i = 0; i < this.editorHandles.length; i++) {
      const handle = this.editorHandles[i];
      const show = key === 'assembly' || i < 4 || key !== 'verticalTail';
      handle.group.style.display = show ? '' : 'none';
      if (!show) continue;
      if (key === 'assembly') this.assemblyEditorPoint(i, this.editProjection);
      else this.wingEditorPoint(handle.index, handle.side, this.editProjection);
      this.body.localToWorld(this.editProjection).project(this.camera);
      handle.x = (this.editProjection.x + 1) * this.width / 2;
      handle.y = (1 - this.editProjection.y) * this.height / 2;
      handle.group.setAttribute('transform', `translate(${handle.x} ${handle.y})`);
      const name = key === 'assembly' ? ['主翼位置', '水平尾翼位置', '垂直尾翼位置', '驾驶舱位置', '机头端点', '机尾端点'][i] : `${label}${handle.side < 0 ? '左翼' : ''}顶点${handle.index + 1}`;
      handle.group.setAttribute('aria-label', name);
      handle.group.setAttribute('data-handle', String(i));
      handle.group.querySelector('text')!.textContent = key === 'assembly' ? ['主翼', '平尾', '垂尾', '驾驶舱', '机头', '机尾'][i] : String(handle.index + 1);
    }
    for (let i = 0; i < this.editorSegments.length; i++) {
      const segment = this.editorSegments[i];
      const show = key !== 'assembly' && (key !== 'verticalTail' || segment.side > 0);
      segment.group.style.display = show ? '' : 'none';
      if (!show) continue;
      const first = this.editorHandles[segment.side < 0 ? 4 : segment.index];
      const last = this.editorHandles[segment.side < 0 ? 5 : segment.index === 0 ? 3 : 2];
      segment.x1 = first.x; segment.y1 = first.y;
      segment.x2 = last.x; segment.y2 = last.y;
      const id = segment.index === 0 ? '14' : '23';
      segment.group.setAttribute('data-segment', id);
      segment.group.setAttribute('data-side', String(segment.side));
      const side = key === 'verticalTail' ? '' : segment.side > 0 ? '右翼' : '左翼';
      segment.group.setAttribute('aria-label', `${label}${segment.index === 0 ? '根弦线段1–4' : `${side}梢弦线段2–3`}`);
      for (const line of segment.group.children) {
        line.setAttribute('x1', String(segment.x1)); line.setAttribute('y1', String(segment.y1));
        line.setAttribute('x2', String(segment.x2)); line.setAttribute('y2', String(segment.y2));
      }
    }
    for (let side = 0; side < 2; side++) {
      const polygon = this.editorPolygons[side];
      polygon.style.display = key === 'assembly' || side === 1 && key === 'verticalTail' ? 'none' : '';
      if (polygon.style.display === 'none') continue;
      let points = '';
      for (let i = 0; i < 4; i++) {
        this.wingEditorPoint(i, side === 0 ? 1 : -1, this.editProjection);
        this.body.localToWorld(this.editProjection).project(this.camera);
        points += `${(this.editProjection.x + 1) * this.width / 2},${(1 - this.editProjection.y) * this.height / 2} `;
      }
      polygon.setAttribute('points', points);
    }
  }

  private intersectEditor(event: PointerEvent): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.editPointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.editRay.setFromCamera(this.editPointer, this.camera);
    return this.editRay.ray.intersectPlane(this.editPlane, this.editPoint) !== null;
  }

  private beginEditorDrag(event: PointerEvent, index: number, segment = false): void {
    if (event.button !== 0 || !this.editorTarget || this.simulation || this.editorPointerId >= 0) return;
    event.preventDefault(); event.stopPropagation();
    if (this.editorTarget !== 'assembly') {
      // Resolve overlapping 44px touch targets by visible geometry, not SVG paint order.
      const rect = this.renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      let nearest = Infinity, vertex = -1, edge = -1, edgeDistance = 81;
      for (let i = 0; i < this.editorHandles.length; i++) {
        const handle = this.editorHandles[i];
        if (handle.group.style.display === 'none') continue;
        const distance = (handle.x - x) ** 2 + (handle.y - y) ** 2;
        if (distance < nearest) { nearest = distance; vertex = i; }
      }
      for (let i = 0; i < this.editorSegments.length; i++) {
        const line = this.editorSegments[i];
        if (line.group.style.display === 'none') continue;
        const dx = line.x2 - line.x1, dy = line.y2 - line.y1, squared = dx * dx + dy * dy;
        if (squared < 1e-6) continue;
        const t = ((x - line.x1) * dx + (y - line.y1) * dy) / squared;
        if (t <= 0 || t >= 1) continue;
        const distance = (x - line.x1 - t * dx) ** 2 + (y - line.y1 - t * dy) ** 2;
        if (distance < edgeDistance) { edgeDistance = distance; edge = i; }
      }
      if (nearest > 36 && edge >= 0) { segment = true; index = edge; }
      else if (vertex >= 0) { segment = false; index = vertex; }
    }
    this.editDefinition = clone(this.definition);
    this.body.getWorldPosition(this.editOrigin);
    const sideView = this.editorTarget === 'assembly' || this.editorTarget === 'verticalTail';
    this.editPlane.setFromNormalAndCoplanarPoint(sideView ? this.vector.set(0, 0, 1) : UP, this.editOrigin);
    if (!this.intersectEditor(event)) { this.editDefinition = null; return; }
    this.editStart.copy(this.editPoint);
    this.editorDrag = segment ? -1 : index;
    this.editorSegmentDrag = segment ? index : -1;
    this.editorPointerId = event.pointerId;
    this.editorChanged = false;
    this.resetSnap(event.ctrlKey);
    this.controls.enabled = false;
    this.editorOverlay.setPointerCapture(event.pointerId);
    const group = (segment ? this.editorSegments[index] : this.editorHandles[index]).group;
    group.style.cursor = 'grabbing';
    group.focus();
  }

  private moveEditorDrag(event: PointerEvent): void {
    if (this.editorPointerId < 0 || !this.editorTarget || event.pointerId !== this.editorPointerId || !this.intersectEditor(event)) return;
    event.preventDefault();
    this.resetSnap(event.ctrlKey);
    const key = this.editorTarget;
    const handle = this.editorSegmentDrag >= 0 ? this.editorSegments[this.editorSegmentDrag] : this.editorHandles[this.editorDrag];
    if (key === 'assembly') this.changeAssembly(this.editorDrag, this.editPoint.x - this.editStart.x, this.editPoint.y - this.editStart.y);
    else {
      const base = this.editDefinition!;
      const incidence = (key === 'mainWing' ? base.assembly.mainIncidence : key === 'horizontalTail' ? base.assembly.tailIncidence : 0) * DEG;
      const point = base[key].points[handle.index];
      // Tail root midpoints stay mounted, so changing one root end moves that end by half its chord change.
      const rootScale = key !== 'mainWing' && this.editorSegmentDrag < 0 && (handle.index === 0 || handle.index === 3) ? 2 : 1;
      let x = point.x - (this.editPoint.x - this.editStart.x) / Math.cos(incidence) * rootScale;
      let span = point.y + (key === 'verticalTail' ? this.editPoint.y - this.editStart.y : (this.editPoint.z - this.editStart.z) * handle.side);
      if (key === 'verticalTail') {
        if (handle.index === 1 || handle.index === 2) span = this.snapEditor(span, handle.index, true);
      } else x = this.snapEditor(x, handle.index, false, this.editorSegmentDrag >= 0);
      if (this.editorSegmentDrag >= 0) this.changeSegment(handle.index, x, span);
      else this.changeWing(handle.index, x, span);
    }
    this.editorChanged = true;
  }

  private keyEditor(event: KeyboardEvent, index: number, segment = false): void {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || !this.editorTarget || this.simulation || this.editorPointerId >= 0) return;
    event.preventDefault(); event.stopPropagation();
    this.editDefinition = clone(this.definition);
    this.resetSnap(event.ctrlKey);
    const amount = event.shiftKey ? 0.1 : 0.025;
    const horizontal = event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0;
    const vertical = event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0;
    const key = this.editorTarget;
    if (key === 'assembly') this.changeAssembly(index, horizontal, vertical);
    else {
      const handle = segment ? this.editorSegments[index] : this.editorHandles[index];
      const p = this.definition[key].points[handle.index];
      const rootScale = key !== 'mainWing' && !segment && (handle.index === 0 || handle.index === 3) ? 2 : 1;
      let x = p.x - (key === 'verticalTail' ? horizontal : vertical) * rootScale;
      let span = p.y + (key === 'verticalTail' ? vertical : horizontal * handle.side);
      if (key === 'verticalTail') {
        if (handle.index === 1 || handle.index === 2) span = this.snapEditor(span, handle.index, true);
      } else x = this.snapEditor(x, handle.index, false, segment);
      if (segment) this.changeSegment(handle.index, x, span);
      else this.changeWing(handle.index, x, span);
    }
    this.editorCommit?.();
    this.editDefinition = null;
  }

  private resetSnap(disabled: boolean): void {
    this.editorSnap.active = false;
    this.editorSnap.kind = null;
    this.editorSnap.value = null;
    this.editorSnap.disabled = disabled;
  }

  private snapEditor(value: number, index: number, span: boolean, segment = false): number {
    if (this.editorSnap.disabled) return value;
    const tolerance = Math.min(0.02, (this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom / this.height * 5);
    let best = Math.round(value * 10) / 10, distance = Math.abs(best - value);
    let kind: 'grid' | 'vertex' = 'grid';
    const key = this.editorTarget;
    if (key && key !== 'assembly') {
      const points = (this.editDefinition ?? this.definition)[key].points;
      for (let i = 0; i < points.length; i++) {
        if (i === index || segment && i === (index === 0 ? 3 : 2)) continue;
        const candidate = span ? points[i].y : points[i].x;
        if (Math.abs(candidate - value) < distance) { best = candidate; distance = Math.abs(candidate - value); kind = 'vertex'; }
      }
    }
    if (distance > tolerance) return value;
    this.editorSnap.active = true; this.editorSnap.kind = kind; this.editorSnap.value = best;
    return best;
  }

  private mountSnapTolerance(): number {
    return clamp((this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom / this.height * 8, 0.015, 0.06);
  }

  private snapMountHeight(value: number): number {
    if (this.editorPointerId >= 0 && !this.editorSnap.disabled && Math.abs(value) <= this.mountSnapTolerance()) {
      this.editorSnap.active = true; this.editorSnap.kind = 'mount'; this.editorSnap.value = 0;
      return 0;
    }
    return this.snapEditor(value, 0, true);
  }

  private changeSegment(index: number, x: number, span: number): void {
    const key = this.editorTarget;
    if (!key || key === 'assembly') return;
    const next = clone(this.editDefinition ?? this.definition), p = next[key].points;
    const last = index === 0 ? 3 : 2;
    let delta = clamp(x - p[index].x, -3 - Math.min(p[index].x, p[last].x), 6 - Math.max(p[index].x, p[last].x));
    if (key !== 'mainWing' && index === 0) {
      const ends = fuselageEnds(next), c = Math.cos((key === 'horizontalTail' ? next.assembly.tailIncidence : 0) * DEG);
      delta = clamp(delta, (next.assembly[key] - Math.min(5, ends.nose)) / c, (next.assembly[key] - Math.max(-6, ends.tail)) / c);
      next.assembly[key] -= delta * c;
    }
    p[index].x += delta; p[last].x += delta;
    p[0].y = p[3].y = 0;
    if (index === 1) p[1].y = p[2].y = clamp(span, 0.25, 12);
    this.editorChange?.(next);
  }

  private changeWing(index: number, x: number, span: number): void {
    const key = this.editorTarget;
    if (!key || key === 'assembly') return;
    const next = clone(this.editDefinition ?? this.definition), wing = next[key], p = wing.points;
    p[index].x = clamp(x, -3, 6);
    if (index === 0 || index === 1) p[index].x = Math.min(p[index].x, p[index === 0 ? 3 : 2].x - 0.15);
    else p[index].x = Math.max(p[index].x, p[index === 3 ? 0 : 1].x + 0.15);
    if (index === 1 || index === 2) p[1].y = p[2].y = clamp(span, 0.25, 12);
    p[0].y = p[3].y = 0;
    this.editorChange?.(next);
  }

  private changeAssembly(index: number, x: number, y: number): void {
    const next = clone(this.editDefinition ?? this.definition);
    const ends = fuselageEnds(next);
    if (index === 0) {
      const limits = mainWingMountLimits(next);
      next.assembly.mainWing = clamp(next.assembly.mainWing + x, limits.min, limits.max);
      next.assembly.mainWingHeight = clamp(this.snapMountHeight(next.assembly.mainWingHeight + y), -0.5, 1);
    } else if (index === 1) next.assembly.horizontalTail = clamp(next.assembly.horizontalTail + x, Math.max(-6, ends.tail), Math.min(5, ends.nose));
    else if (index === 2) next.assembly.verticalTail = clamp(next.assembly.verticalTail + x, Math.max(-6, ends.tail), Math.min(5, ends.nose));
    else if (index === 3) next.cockpit.position = clamp(next.cockpit.position + x, Math.max(-3, ends.tail), Math.min(4, ends.nose - 0.95));
    else resizeFuselage(next, index === 4 ? 'nose' : 'tail', (index === 4 ? ends.nose : ends.tail) + x);
    this.editorChange?.(next);
  }

  private endEditorDrag(cancel = false): void {
    if (this.editorPointerId < 0) return;
    const pointer = this.editorPointerId, original = this.editDefinition;
    const handle = this.editorSegmentDrag >= 0 ? this.editorSegments[this.editorSegmentDrag] : this.editorHandles[this.editorDrag];
    handle.group.style.cursor = 'grab';
    this.editorDrag = this.editorSegmentDrag = this.editorPointerId = -1;
    this.editDefinition = null;
    this.controls.enabled = !this.simulation || this.view === 'free' || this.view === 'orbit';
    if (this.editorOverlay.hasPointerCapture(pointer)) this.editorOverlay.releasePointerCapture(pointer);
    if (this.editorChanged) {
      if (cancel && original) this.editorChange?.(original);
      else this.editorCommit?.();
    }
    this.editorChanged = false;
    if (cancel) this.resetSnap(false);
    if (this.editorTarget === 'assembly' && !this.simulation) {
      this.centerAssemblyCamera();
      this.resize();
    }
  }

  private orthographicSpan(): number {
    const aspect = this.width / this.height;
    const key = this.editorTarget;
    if (!key) return Math.max(6, this.definition.fuselage.length) / Math.min(1, aspect);
    if (key === 'assembly') return Math.max(2.3, this.definition.fuselage.length / (2 * aspect * 0.8), this.definition.verticalTail.points[1].y + 0.7);
    const wing = this.definition[key], p = wing.points;
    const chord = Math.max(p[2].x, p[3].x) - Math.min(p[0].x, p[1].x);
    const horizontal = key === 'verticalTail' ? chord / 2 : p[1].y;
    const vertical = key === 'verticalTail' ? p[1].y / 2 : chord / 2;
    return Math.max(2.3, horizontal / (aspect * (this.width <= 700 ? 0.72 : 0.62)), vertical / (this.width <= 700 ? 0.32 : 0.62));
  }

  private centerAssemblyCamera(): void {
    const center = this.aircraft.position.x + this.definition.fuselage.center - this.designCG.x;
    const delta = center - this.controls.target.x;
    this.controls.target.x = center;
    this.target.x += delta;
    this.camera.position.x += delta;
    this.editorDirty = true;
  }

  updateAircraft(d: AircraftDefinition): void {
    this.definition = d;
    this.aircraftPending = true;
  }

  private applyAircraft(): void {
    if (!this.aircraftPending) return;
    const start = performance.now();
    const d = this.definition;
    this.aircraftPending = false;
    this.editorDirty = true;
    const properties = derive(d);
    this.designCG.copy(properties.cg);
    this.designLiftVisible = !!properties.aerodynamics.liftCenter;
    this.designDragVisible = !!properties.aerodynamics.dragCenter;
    if (properties.aerodynamics.liftCenter) this.designLiftCenter.copy(properties.aerodynamics.liftCenter);
    if (properties.aerodynamics.dragCenter) this.designDragCenter.copy(properties.aerodynamics.dragCenter);
    this.designLiftDirection.copy(properties.aerodynamics.lift);
    this.designDragDirection.copy(properties.aerodynamics.drag);
    this.body.position.copy(this.simulation?.telemetry.cg ?? this.designCG).negate();
    for (let i = 0; i < 3; i++) {
      const key: WingKey = i === 0 ? 'mainWing' : i === 1 ? 'horizontalTail' : 'verticalTail';
      const wing = d[key], origin = wingOrigin(d, key);
      const incidence = i === 0 ? d.assembly.mainIncidence : i === 1 ? d.assembly.tailIncidence : 0;
      if (!this.wingChanged(i, wing, origin.x, origin.y, incidence)) continue;
      const geometry = this.wingGeometry(wing, origin.x, origin.y, incidence, i === 2);
      if (i === 0) {
        const position = geometry.getAttribute('position');
        const colors = new Float32Array(position.count * 3);
        const span = Math.max(wing.points[1].y, 0.1);
        for (let vertex = 0; vertex < position.count; vertex++) {
          const color = Math.abs(position.getZ(vertex)) > span * 0.82 ? this.wingTipColor : this.wingBaseColor;
          color.toArray(colors, vertex * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      this.metrics.memory += (this.geometryBytes(geometry) - this.geometryBytes(this.wingMeshes[i].geometry)) / 1048576;
      this.wingMeshes[i].geometry.dispose();
      this.wingMeshes[i].geometry = geometry;
    }
    const support = mainWingSupport(d);
    this.support.visible = support.area > 0;
    this.support.matrix.set(
      support.width, 0, 0, support.x,
      support.frontY - support.backY, Math.abs(support.height), 0, support.y,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    this.support.matrixWorldNeedsUpdate = true;
    this.beam.scale.y = d.fuselage.length;
    this.beam.position.x = d.fuselage.center;
    this.nose.position.x = fuselageEnds(d).nose - 0.1;
    this.pilot.position.x = d.cockpit.position;
    this.cg.visible = !this.simulation || this.debug;
    if (!this.simulation) {
      this.positionAtLaunch();
      this.aircraft.quaternion.identity();
      this.driver.position.x = 0;
    }
    if (!this.simulation && this.editorTarget === 'assembly' && this.editorPointerId < 0) this.centerAssemblyCamera();
    this.updateCenters();
    const cameraSpan = this.orthographicSpan();
    if (this.editorPointerId < 0 && this.orthographic.top !== cameraSpan) {
      const halfWidth = cameraSpan * this.width / this.height;
      this.orthographic.left = -halfWidth;
      this.orthographic.right = halfWidth;
      this.orthographic.top = cameraSpan;
      this.orthographic.bottom = -cameraSpan;
      this.orthographic.updateProjectionMatrix();
    }
    this.metrics.geometryMs = performance.now() - start;
  }

  private wingChanged(index: number, wing: Wing, root: number, height: number, incidence: number): boolean {
    const offset = index * 12;
    let changed = false;
    for (let i = 0; i < 12; i++) {
      const value = i < 8 ? (i % 2 === 0 ? wing.points[i >> 1].x : wing.points[i >> 1].y)
        : i === 8 ? wing.dihedral : i === 9 ? root : i === 10 ? height : incidence;
      if (this.wingParameters[offset + i] !== value) changed = true;
      this.wingParameters[offset + i] = value;
    }
    return changed;
  }

  private buildAircraft(): void {
    const { ivory, main, orange, graphite, skin, suit } = this.aircraftMaterials;
    this.aircraft.add(this.body);
    this.body.add(this.pilot);
    this.pilot.add(this.driver);
    this.wingMeshes.push(this.mesh(new THREE.BufferGeometry(), main, this.body),
      this.mesh(new THREE.BufferGeometry(), ivory, this.body),
      this.mesh(new THREE.BufferGeometry(), orange, this.body));
    this.beam = this.mesh(new THREE.CylinderGeometry(0.085, 0.12, 1, 8), graphite, this.body);
    this.beam.rotation.z = Math.PI / 2;
    this.support = this.mesh(new THREE.BoxGeometry(1, 1, 0.06), graphite, this.body);
    this.support.name = 'main-wing-support';
    this.support.matrixAutoUpdate = false;
    this.support.visible = false;
    this.nose = this.mesh(new THREE.SphereGeometry(0.22, 10, 7), ivory, this.body);
    this.nose.position.set(0, 0.02, 0);
    this.nose.scale.set(1.6, 0.8, 0.75);
    const seat = this.mesh(new THREE.BoxGeometry(1.65, 0.11, 0.46), graphite, this.pilot);
    seat.position.set(-0.25, -0.15, 0);
    const torso = this.mesh(new THREE.CapsuleGeometry(0.18, 0.45, 3, 7), suit, this.driver);
    torso.position.set(0, 0.12, 0);
    torso.rotation.z = -Math.PI / 2;
    const head = this.mesh(new THREE.SphereGeometry(0.17, 9, 7), skin, this.driver);
    head.position.set(0.62, 0.23, 0);
    const helmet = this.mesh(new THREE.SphereGeometry(0.18, 9, 7, 0, Math.PI * 2, 0, Math.PI / 2), orange, this.driver);
    helmet.position.copy(head.position);
    const grip = this.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.56, 7), graphite, this.driver);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0.9, 0.08, 0);
    for (const side of [-1, 1]) {
      this.placeStrut(this.mesh(this.strutGeometry, suit, this.driver), new THREE.Vector3(0.27, 0.16, side * 0.18), new THREE.Vector3(0.85, 0.08, side * 0.23), 0.06);
      const hand = this.mesh(new THREE.SphereGeometry(0.065, 7, 5), skin, this.driver);
      hand.position.set(0.9, 0.08, side * 0.23);
      this.placeStrut(this.mesh(this.strutGeometry, suit, this.driver), new THREE.Vector3(-0.34, 0.1, side * 0.12), new THREE.Vector3(-1.19, 0.07, side * 0.14), 0.085);
    }
    const skid = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 7), graphite, this.pilot);
    skid.rotation.z = Math.PI / 2;
    skid.position.set(0, -0.45, 0);
  }

  setFlight(sim: FlightSimulation | null): void {
    this.endEditorDrag();
    this.editorDirty = true;
    this.applyAircraft();
    this.simulation = sim;
    this.trailCount = this.trailIndex = 0;
    this.trailClock = 0;
    this.trailGeometry.setDrawRange(0, 0);
    this.clearWingTrail();
    this.updateEnvironment();
    this.splashAge = -1;
    this.wasInWater = false;
    this.splash.visible = this.ring.visible = false;
    this.cg.visible = !sim || this.debug;
    if (sim) {
      this.aircraft.position.copy(sim.position);
      this.aircraft.quaternion.copy(sim.quaternion);
      this.body.position.copy(sim.telemetry.cg).negate();
      this.lastTrail.copy(sim.position);
      this.cameraView('chase');
    } else {
      this.positionAtLaunch();
      this.aircraft.quaternion.identity();
      this.driver.position.x = 0;
      this.body.position.copy(this.designCG).negate();
      for (const arrow of this.arrows) arrow.visible = false;
      for (const marker of this.applicationMarkers) marker.visible = false;
      this.cameraView('orbit');
    }
    this.updateCenters();
  }

  cameraView(name: string): void {
    const names: Record<string, string> = { '俯视': 'top', '侧视': 'side', '正视': 'front', '后视': 'rear', '追尾': 'chase', '侧面': 'flight-side', '驾驶员': 'pilot', '自由': 'free', '自由镜头': 'free', '轨道': 'orbit', '三维': 'orbit', 'perspective': 'orbit', 'cockpit': 'pilot', 'follow': 'chase', 'back': 'rear' };
    this.view = names[name] ?? name;
    if (!this.simulation && this.editorTarget) this.view = this.editorTarget === 'verticalTail' || this.editorTarget === 'assembly' ? 'side' : 'top';
    const orthographic = ['top', 'side', 'front', 'rear'].includes(this.view);
    this.camera = orthographic ? this.orthographic : this.perspective;
    this.controls.object = this.camera;
    this.controls.enabled = !this.simulation || this.view === 'free' || this.view === 'orbit' || orthographic;
    this.controls.enableRotate = !orthographic;
    this.target.copy(this.aircraft.position);
    if (this.editorTarget && this.editorTarget !== 'assembly' && !this.simulation) {
      const key = this.editorTarget, wing = this.definition[key], origin = wingOrigin(this.definition, key);
      const incidence = (key === 'mainWing' ? this.definition.assembly.mainIncidence : key === 'horizontalTail' ? this.definition.assembly.tailIncidence : 0) * DEG;
      const chord = (wing.points[0].x + wing.points[1].x + wing.points[2].x + wing.points[3].x) / 4;
      this.target.x += origin.x - chord * Math.cos(incidence) - this.designCG.x;
      this.target.y += origin.y - chord * Math.sin(incidence) + (key === 'verticalTail' ? wing.points[1].y / 2 : wing.points[1].y / 2 * Math.tan(wing.dihedral * DEG)) - this.designCG.y;
    } else if (this.editorTarget === 'assembly' && !this.simulation) {
      this.target.x += this.definition.fuselage.center - this.designCG.x;
      this.target.y -= this.designCG.y;
    }
    this.controls.target.copy(this.target);
    const distance = Math.max(17, this.definition.mainWing.points[1].y * 2.4);
    if (this.view === 'top') this.vector.set(0, distance, 0.001);
    else if (this.view === 'side') this.vector.set(0, 0, distance);
    else if (this.view === 'front') this.vector.set(distance, 0, 0);
    else if (this.view === 'rear') this.vector.set(-distance, 0, 0);
    else this.vector.set(19, 12, 22).multiplyScalar(this.width <= 700 ? 1.28 : 1);
    this.camera.up.set(this.view === 'top' ? 1 : 0, this.view === 'top' ? 0 : 1, 0);
    this.camera.position.copy(this.target).add(this.vector);
    this.camera.lookAt(this.target);
    this.orthographic.zoom = 1;
    this.resize();
    this.editorDirty = true;
    this.controls.update();
    this.constrainCamera();
    if (this.simulation && !this.controls.enabled) this.followCamera(1, true);
  }

  setQuality(name: Quality): void {
    this.quality = name;
    if (name !== 'Auto') this.level = name === 'High' ? 2 : name === 'Medium' ? 1 : 0;
    this.slowTime = this.fastTime = this.qualityClock = 0;
    this.applyQuality();
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
    this.debugGroup.visible = enabled;
    this.cg.visible = !this.simulation || enabled;
    this.liftCenter.visible = !this.simulation || enabled;
    this.updateEnvironment();
    this.updateCenters();
  }

  render(dt: number): void {
    if (this.disposed) return;
    const start = performance.now();
    this.applyAircraft();
    const seconds = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.elapsed += seconds;
    this.waterTime.value = this.reducedMotion ? 0 : this.elapsed;
    const sim = this.simulation;
    if (sim) {
      this.aircraft.position.copy(sim.position);
      this.aircraft.quaternion.copy(sim.quaternion);
      this.body.position.copy(sim.telemetry.cg).negate();
      this.driver.position.x = (sim.telemetry.cg.x - this.designCG.x) * sim.telemetry.mass / PILOT_MASS;
      this.followCamera(seconds, false);
      this.recordTrail(seconds);
      this.recordWingTrail();
      this.updateDebug();
      const inWater = sim.result?.landing === 'water';
      if (inWater && !this.wasInWater) this.beginSplash(sim.position);
      this.wasInWater = inWater;
    }
    if (this.splashAge >= 0) this.updateSplash(seconds);
    if (this.controls.enabled) this.controls.update();
    this.constrainCamera();
    this.updateCenters();
    this.updateEditorOverlay();
    this.light.target.position.copy(this.aircraft.position);
    this.light.position.copy(this.aircraft.position).add(this.vector.set(-55, 110, 65));
    this.renderer.render(this.scene, this.camera);
    this.metrics.renderMs = performance.now() - start;
    this.metrics.drawCalls = this.renderer.info.render.calls;
    this.metrics.triangles = this.renderer.info.render.triangles;
    this.metrics.geometries = this.renderer.info.memory.geometries;
    this.metrics.textures = this.renderer.info.memory.textures;
    this.metrics.programs = this.renderer.info.programs?.length ?? 0;
    if (dt > 0 && dt < 0.5) {
      this.frameTimes[this.sampleIndex] = dt * 1000;
      this.sampleIndex = (this.sampleIndex + 1) % this.frameTimes.length;
      this.sampleCount = Math.min(this.sampleCount + 1, this.frameTimes.length);
      this.statisticsClock += seconds;
      this.qualityClock += seconds;
      if (this.statisticsClock >= 0.5) this.updateStatistics();
      if (this.quality === 'Auto' && this.qualityClock > 3) this.autoQuality(seconds);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.layoutObserver.disconnect();
    window.removeEventListener('blur', this.cancelEditorDrag);
    this.controls.dispose();
    this.editorOverlay.remove();
    this.release(this.scene);
    this.light.shadow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.scene.clear();
  }

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private placeStrut(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
    const length = a.distanceTo(b);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, length, radius);
    mesh.quaternion.setFromUnitVectors(UP, this.desiredPosition.copy(b).sub(a).normalize());
  }

  /** 四点平面形沿展向插值；NACA 厚度封口，正安装角使前缘相对后缘抬高。 */
  private wingGeometry(wing: Wing, rootX: number, height: number, incidence: number, vertical: boolean): THREE.BufferGeometry {
    const vertices: number[] = [], indices: number[] = [];
    const chordSteps = 16, spanSteps = 5;
    const profileCount = chordSteps * 2;
    const c = Math.cos(incidence * DEG), s = Math.sin(incidence * DEG);
    const dihedral = Math.tan(wing.dihedral * DEG);
    const sides = vertical ? [1] : [-1, 1];
    for (const side of sides) {
      const offset = vertices.length / 3;
      for (let row = 0; row <= spanSteps; row++) {
        const t = row / spanSteps;
        const leading = THREE.MathUtils.lerp(wing.points[0].x, wing.points[1].x, t);
        const trailing = THREE.MathUtils.lerp(wing.points[3].x, wing.points[2].x, t);
        const span = THREE.MathUtils.lerp(wing.points[0].y, wing.points[1].y, t);
        const chord = trailing - leading;
        for (let k = 0; k < profileCount; k++) {
          const upper = k <= chordSteps;
          const j = upper ? k : profileCount - k;
          const u = (1 - Math.cos(j / chordSteps * Math.PI)) / 2;
          const thickness = 5 * 0.105 * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
          const camber = vertical ? 0 : 0.018 * chord * Math.sin(Math.PI * u);
          const x = -leading - u * chord;
          const y = camber + (upper ? thickness : -thickness);
          if (vertical) vertices.push(rootX + x, height + span, y);
          else vertices.push(rootX + x * c - y * s, height + x * s + y * c + span * dihedral, span * side);
        }
      }
      for (let row = 0; row < spanSteps; row++) {
        for (let k = 0; k < profileCount; k++) {
          const a = offset + row * profileCount + k, b = offset + row * profileCount + (k + 1) % profileCount;
          if (vertical || side < 0) indices.push(a, b + profileCount, b, a, a + profileCount, b + profileCount);
          else indices.push(a, b, b + profileCount, a, b + profileCount, a + profileCount);
        }
      }
      for (const row of [0, spanSteps]) {
        const base = offset + row * profileCount;
        for (let k = 1; k < profileCount - 1; k++) {
          const reverse = (row === 0) !== (vertical || side < 0);
          if (reverse) indices.push(base, base + k, base + k + 1);
          else indices.push(base, base + k + 1, base + k);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private buildEnvironment(): void {
    const water = new THREE.MeshStandardMaterial({ color: 0x7bada6, roughness: 0.35, metalness: 0.24, flatShading: true });
    water.onBeforeCompile = shader => {
      shader.uniforms.lakeTime = this.waterTime;
      shader.vertexShader = 'uniform float lakeTime;\nvarying vec3 lakePosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nlakePosition = position;');
      shader.fragmentShader = 'uniform float lakeTime;\nvarying vec3 lakePosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat wave = sin(lakePosition.x * 0.2 + lakePosition.y * 0.48 + lakeTime * 0.42) * sin(lakePosition.y * 0.17 - lakeTime * 0.3);\ndiffuseColor.rgb *= 1.0 + wave * 0.045;');
    };
    const lake = this.mesh(new THREE.PlaneGeometry(2400, 2000), water, this.environment);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(700, -0.035, 0);
    lake.castShadow = false;
    this.terrain.push(lake);
    const ground = new THREE.MeshStandardMaterial({ color: 0x9caa81, roughness: 1, flatShading: true });
    const bank = this.mesh(new THREE.BoxGeometry(115, 10, 180), ground, this.environment);
    bank.position.set(-75, 3, 0);
    this.terrain.push(bank);
    const cliff = new THREE.MeshStandardMaterial({ color: 0xb7b59b, roughness: 1, flatShading: true });
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i <= 30; i++) {
      const z = -100 + i * 6.7;
      const edge = -18 + Math.sin(i * 1.8) * 3;
      vertices.push(edge, 8, z, edge + 9 + Math.sin(i * 2.1) * 2, 0, z);
      if (i < 30) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const cliffGeometry = new THREE.BufferGeometry();
    cliffGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    cliffGeometry.setIndex(indices);
    cliffGeometry.computeVertexNormals();
    const cliffMaterial = cliff.clone(); cliffMaterial.side = THREE.DoubleSide;
    this.terrain.push(this.mesh(cliffGeometry, cliffMaterial, this.environment));
    const concrete = new THREE.MeshStandardMaterial({ color: 0xd8cbb0, roughness: 0.95, flatShading: true });
    const platform = this.mesh(new THREE.BoxGeometry(20, 0.6, 13), concrete, this.environment);
    platform.position.set(-10, 9.7, 0);
    this.terrain.push(platform);
    const supportGeometry = new THREE.BoxGeometry(0.5, 9.2, 0.5);
    for (const x of [-2, -9, -16]) for (const z of [-5.4, 5.4]) {
      const support = this.mesh(supportGeometry, cliff, this.environment);
      support.position.set(x, 4.6, z);
    }
    const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xf8edce });
    const stripeGeometry = new THREE.PlaneGeometry(0.6, 0.12);
    for (let x = -19; x < 0; x += 1.6) {
      const stripe = this.mesh(stripeGeometry, stripeMaterial, this.environment);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(x, 10.015, 0);
    }
    const edgeGeometry = new THREE.BoxGeometry(20, 0.08, 0.09);
    for (const z of [-6.2, 6.2]) {
      const edge = this.mesh(edgeGeometry, stripeMaterial, this.environment);
      edge.position.set(-10, 10.05, z);
    }
    const sign = this.label('起飞平台 · 10 m', '#37483e', '#f5eedb', 384, 80);
    sign.position.set(-7, 8.7, 6.65);
    sign.scale.set(7.2, 1.5, 1);
    this.environment.add(sign);
    const mountainMaterials = [0xa4b7a7, 0x8ba89c, 0xb2bfae, 0x7f9e92].map(color => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
    const mountainGeometry = new THREE.ConeGeometry(1, 1, 5, 1);
    for (let i = 0; i < 38; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = -220 + Math.floor(i / 2) * 87;
      const height = 45 + (Math.sin(i * 9.31) * 0.5 + 0.5) * 115;
      const mountain = this.mesh(mountainGeometry, mountainMaterials[i % 4], this.environment);
      mountain.position.set(x, height / 2 - 5, side * (370 + Math.sin(i * 2.7) * 65));
      mountain.scale.set(95 + (i % 4) * 18, height, 90 + (i % 3) * 24);
      mountain.rotation.y = i * 1.7;
      mountain.castShadow = false;
      this.terrain.push(mountain);
    }
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6d7960, roughness: 1 });
    const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x617c62, roughness: 1, flatShading: true });
    const treeGeometry = new THREE.ConeGeometry(1, 3.4, 5);
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 2, 5);
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, 48);
    const trees = new THREE.InstancedMesh(treeGeometry, leavesMaterial, 48);
    trunks.castShadow = trees.castShadow = true;
    trunks.receiveShadow = trees.receiveShadow = true;
    this.detail.add(trunks, trees);
    const instance = new THREE.Object3D();
    for (let i = 0; i < 48; i++) {
      const x = -27 - (i % 8) * 11 + Math.sin(i * 7.2) * 3;
      const z = (i < 24 ? -1 : 1) * (15 + Math.floor((i % 24) / 8) * 22 + Math.sin(i * 2.2) * 8);
      const scale = 0.8 + (Math.sin(i * 8.2) + 1) * 0.8;
      instance.position.set(x, 8.8, z);
      instance.scale.setScalar(1);
      instance.updateMatrix();
      trunks.setMatrixAt(i, instance.matrix);
      instance.position.set(x, 10 + scale * 1.1, z);
      instance.scale.setScalar(scale);
      instance.updateMatrix();
      trees.setMatrixAt(i, instance.matrix);
    }
    const buoyMaterial = new THREE.MeshStandardMaterial({ color: 0xe6aa65, roughness: 0.7, flatShading: true });
    const buoyGeometry = new THREE.ConeGeometry(0.48, 1.3, 6);
    for (let distance = 50; distance <= 700; distance += 50) {
      const buoy = this.mesh(buoyGeometry, buoyMaterial, this.environment);
      buoy.position.set(distance, 0.45, -15);
      buoy.castShadow = false;
      const label = this.label(`${distance} m`, '#f7f1dc', '#49665c', 192, 80);
      label.position.set(distance, 3, -15);
      label.scale.set(5.2, 2.15, 1);
      this.environment.add(label);
    }
    this.scene.add(this.cg, this.liftCenter, this.dragCenter);
    this.scene.updateMatrixWorld(true);
  }

  private label(text: string, color: string, background: string, width: number, height: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.fillStyle = color;
    context.font = '500 36px system-ui, sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2, width - 20);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: false, depthWrite: false }));
  }

  private resize(): void {
    const previousWidth = this.width, previousHeight = this.height;
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    const aspect = this.width / this.height;
    this.editorDirty = true;
    this.perspective.aspect = aspect;
    const span = this.orthographicSpan();
    this.orthographic.left = -span * aspect;
    this.orthographic.right = span * aspect;
    this.orthographic.top = span;
    this.orthographic.bottom = -span;
    this.perspective.clearViewOffset();
    this.orthographic.clearViewOffset();
    if (!this.simulation) {
      const parent = this.host.parentElement;
      const editor = parent?.querySelector('.editor');
      const welcome = parent?.querySelector('.welcome');
      // 非对称视锥让飞机避开面板，不改变轨道中心或物理坐标。
      const designing = parent?.classList.contains('designing');
      const offsetX = !designing && this.width > 700 && (editor || welcome) ? -Math.min(welcome ? 225 : 190, this.width * 0.19) : 0;
      const offsetY = !designing && this.width <= 700 ? editor ? this.height * 0.23 : welcome ? -this.height * 0.17 : 0 : 0;
      this.perspective.setViewOffset(this.width, this.height, offsetX, offsetY, this.width, this.height);
      this.orthographic.setViewOffset(this.width, this.height, offsetX, offsetY, this.width, this.height);
    }
    this.perspective.updateProjectionMatrix();
    this.orthographic.updateProjectionMatrix();
    if (this.width !== previousWidth || this.height !== previousHeight) this.renderer.setSize(this.width, this.height, false);
  }

  private followCamera(dt: number, immediate: boolean): void {
    if (this.controls.enabled) return;
    const sim = this.simulation;
    if (!sim) return;
    const pilot = this.view === 'pilot';
    if (pilot) {
      this.desiredPosition.set(this.definition.cockpit.position + this.driver.position.x + 0.79, 0.32, 0);
      this.desiredTarget.set(35, 0.6, 0);
    } else if (this.view === 'flight-side' || this.view === 'side-flight') {
      this.desiredPosition.set(-3, 4, 23);
      this.desiredTarget.set(3, 0.3, 0);
    } else {
      this.desiredPosition.set(-19, 7, 5);
      this.desiredTarget.set(7, 0.8, 0);
    }
    this.desiredPosition.sub(sim.telemetry.cg);
    this.desiredTarget.sub(sim.telemetry.cg);
    this.desiredPosition.applyQuaternion(sim.quaternion).add(sim.position);
    this.desiredTarget.applyQuaternion(sim.quaternion).add(sim.position);
    this.desiredPosition.y = Math.max(0.45, this.desiredPosition.y);
    const blend = immediate || pilot || this.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
    this.camera.position.lerp(this.desiredPosition, blend);
    this.target.lerp(this.desiredTarget, blend);
    this.camera.up.copy(pilot ? this.vector.copy(UP).applyQuaternion(sim.quaternion) : UP);
    this.camera.lookAt(this.target);
  }

  private clearWingTrail(): void {
    this.wingTrailActive = false;
    this.wingTrailCount = this.wingTrailIndex = 0;
    this.wingTrailTime = -1;
    this.wingTrailGeometry.setDrawRange(0, 0);
    this.wingTrail.visible = false;
    this.wingTrail.material.opacity = 0;
  }

  private recordWingTrail(): void {
    const sim = this.simulation;
    if (!sim || sim.launching || sim.result || sim.telemetry.stall || sim.telemetry.speed < 9) {
      this.clearWingTrail();
      return;
    }
    const strength = clamp((sim.telemetry.speed - 9) / 12, 0, 1);
    if (sim.time < this.wingTrailTime || sim.time - this.wingTrailTime > 0.15) this.clearWingTrail();
    this.wingTrail.material.opacity = 0.65 + strength * 0.3;
    const sample = this.wingTrailTime !== sim.time;
    this.wingTrailTime = sim.time;
    this.wingTrailActive = true;
    const capacity = WING_TRAIL_CAPACITY + 1;
    const wing = this.definition.mainWing;
    const span = wing.points[1].y;
    const chordX = wing.points[1].x + (wing.points[2].x - wing.points[1].x) * 0.75;
    const incidence = this.definition.assembly.mainIncidence * DEG;
    const origin = wingOrigin(this.definition, 'mainWing');
    if (sample) {
      this.wingTrailIndex = (this.wingTrailIndex + 1) % capacity;
      this.wingTrailCount = Math.min(capacity, this.wingTrailCount + 1);
      this.wingTrailTimes[this.wingTrailIndex] = sim.time;
      for (let side = 0; side < 2; side++) {
        this.wingTrailPoint.set(origin.x - chordX * Math.cos(incidence),
          origin.y - chordX * Math.sin(incidence) + span * Math.tan(wing.dihedral * DEG),
          (side === 0 ? -1 : 1) * span).sub(sim.telemetry.cg).applyQuaternion(sim.quaternion).add(sim.position);
        this.wingTrailPoint.toArray(this.wingTrailHistory, this.wingTrailIndex * 6 + side * 3);
      }
    }
    const lifetime = 0.9 + strength * 1.8;
    let offset = 0;
    for (let age = 1; age < this.wingTrailCount; age++) {
      const recent = (this.wingTrailIndex - age + 1 + capacity) % capacity;
      const older = (this.wingTrailIndex - age + capacity) % capacity;
      if (sim.time - this.wingTrailTimes[recent] > lifetime) break;
      const duration = this.wingTrailTimes[recent] - this.wingTrailTimes[older];
      const fraction = duration > 0 ? clamp((lifetime - (sim.time - this.wingTrailTimes[recent])) / duration, 0, 1) : 1;
      for (let side = 0; side < 2; side++) {
        this.wingTrailPoint.fromArray(this.wingTrailHistory, recent * 6 + side * 3);
        this.wingTrailOlder.fromArray(this.wingTrailHistory, older * 6 + side * 3).lerp(this.wingTrailPoint, 1 - fraction);
        this.vector.copy(this.wingTrailOlder).sub(this.wingTrailPoint);
        if (this.vector.lengthSq() < 1e-12) continue;
        this.vector2.copy(this.camera.position).sub(this.wingTrailPoint);
        this.wingTrailWidth.crossVectors(this.vector, this.vector2);
        if (this.wingTrailWidth.lengthSq() < 1e-12) this.wingTrailWidth.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        const pixelWidth = this.camera === this.orthographic
          ? (this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom / this.height
          : 2 * this.vector2.length() * Math.tan(this.perspective.fov * DEG / 2) / this.height;
        const fade = clamp(1 - (sim.time - this.wingTrailTimes[recent]) / lifetime, 0, 1);
        this.wingTrailWidth.normalize().multiplyScalar(Math.max(0.055 + strength * 0.12, pixelWidth * 1.8) * (0.3 + fade * 0.7));
        // Two camera-facing triangles per segment; width never depends on WebGL lineWidth.
        for (let vertex = 0; vertex < 6; vertex++) {
          const start = vertex === 0 || vertex === 1 || vertex === 3;
          const sign = vertex === 0 || vertex === 3 || vertex === 5 ? -1 : 1;
          const point = start ? this.wingTrailPoint : this.wingTrailOlder;
          for (let axis = 0; axis < 3; axis++) {
            this.wingTrailArray[offset] = point.getComponent(axis) + this.wingTrailWidth.getComponent(axis) * sign;
            this.wingTrailColors[offset++] = fade * (start ? 1 : 0.96);
          }
        }
      }
    }
    this.wingTrailGeometry.setDrawRange(0, offset / 3);
    this.wingTrail.visible = offset > 0;
    const attribute = this.wingTrailGeometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.clearUpdateRanges(); attribute.addUpdateRange(0, offset); attribute.needsUpdate = true;
    const colors = this.wingTrailGeometry.getAttribute('color') as THREE.BufferAttribute;
    colors.clearUpdateRanges(); colors.addUpdateRange(0, offset); colors.needsUpdate = true;
  }

  private recordTrail(dt: number): void {
    const sim = this.simulation;
    if (!sim) return;
    this.trailClock += dt;
    if (this.trailClock < 0.1 || this.lastTrail.distanceToSquared(sim.position) < 0.025) return;
    this.trailClock = 0;
    const i = this.trailIndex * 6;
    this.lastTrail.toArray(this.trailArray, i);
    sim.position.toArray(this.trailArray, i + 3);
    this.lastTrail.copy(sim.position);
    this.trailIndex = (this.trailIndex + 1) % TRAIL_CAPACITY;
    this.trailCount = Math.min(TRAIL_CAPACITY, this.trailCount + 1);
    this.trailGeometry.setDrawRange(0, this.trailCount * 2);
    const attribute = this.trailGeometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.clearUpdateRanges(); attribute.addUpdateRange(i, 6); attribute.needsUpdate = true;
  }

  private updateDebug(): void {
    this.cg.visible = this.debug;
    if (!this.debug || !this.simulation) return;
    const sim = this.simulation;
    this.cg.position.copy(sim.position);
    this.vector.copy(sim.telemetry.force).sub(sim.telemetry.drag);
    this.setArrow(this.arrows[0], sim.position, this.vector, 0.005);
    this.setArrow(this.arrows[1], sim.position, sim.telemetry.drag, 0.008);
    this.vector.set(0, -9.81 * sim.telemetry.mass, 0);
    this.setArrow(this.arrows[2], sim.position, this.vector, 0.005);
    this.setArrow(this.arrows[3], sim.position, sim.velocity, 0.3);
    for (let i = 0; i < this.applicationMarkers.length; i++) {
      const surface = sim.surfaces[i];
      const marker = this.applicationMarkers[i];
      marker.visible = !!surface;
      if (surface) {
        marker.position.copy(surface.point).sub(sim.telemetry.cg).applyQuaternion(sim.quaternion).add(sim.position);
        if (i + 4 < this.arrows.length) this.setArrow(this.arrows[i + 4], marker.position, surface.force, 0.007);
      }
    }
  }

  private setArrow(arrow: THREE.ArrowHelper, origin: THREE.Vector3, force: THREE.Vector3, scale: number): void {
    const length = force.length() * scale;
    arrow.visible = length > 0.001;
    if (!arrow.visible) return;
    arrow.position.copy(origin);
    arrow.setDirection(this.vector2.copy(force).normalize());
    const visibleLength = Math.min(18, length);
    arrow.setLength(visibleLength, Math.min(0.5, visibleLength * 0.22), Math.min(0.25, visibleLength * 0.1));
  }

  private beginSplash(position: THREE.Vector3): void {
    this.splashAge = 0;
    this.splash.visible = this.ring.visible = true;
    this.ring.position.set(position.x, 0.035, position.z);
    for (let i = 0; i < PARTICLES; i++) {
      const index = i * 3, angle = i * 2.399963;
      const speed = 1.4 + (i % 7) * 0.4;
      this.splashPositions[index] = position.x;
      this.splashPositions[index + 1] = 0.08;
      this.splashPositions[index + 2] = position.z;
      this.splashVelocities[index] = Math.cos(angle) * speed;
      this.splashVelocities[index + 1] = 2 + (i % 9) * 0.5;
      this.splashVelocities[index + 2] = Math.sin(angle) * speed;
    }
    this.splashGeometry.getAttribute('position').needsUpdate = true;
  }

  private updateSplash(dt: number): void {
    this.splashAge += dt;
    if (this.splashAge > 2.5) {
      this.splashAge = -1;
      this.splash.visible = this.ring.visible = false;
      return;
    }
    const fade = Math.max(0, 1 - this.splashAge / 2.5);
    this.splash.material.opacity = fade * 0.85;
    this.ring.material.opacity = fade * 0.55;
    this.ring.scale.setScalar(1 + this.splashAge * 3.7);
    for (let i = 0; i < PARTICLES; i++) {
      const index = i * 3;
      this.splashVelocities[index + 1] -= 9.81 * dt;
      this.splashPositions[index] += this.splashVelocities[index] * dt;
      this.splashPositions[index + 1] = Math.max(0.015, this.splashPositions[index + 1] + this.splashVelocities[index + 1] * dt);
      this.splashPositions[index + 2] += this.splashVelocities[index + 2] * dt;
    }
    this.splashGeometry.getAttribute('position').needsUpdate = true;
  }

  private updateStatistics(): void {
    this.statisticsClock = 0;
    let sum = 0;
    for (let i = 0; i < this.sampleCount; i++) {
      const value = this.frameTimes[i];
      sum += value; this.sortedTimes[i] = value;
    }
    // 原地插入排序，固定 180 帧窗口，不创建临时数组或每帧排序。
    for (let i = 1; i < this.sampleCount; i++) {
      const value = this.sortedTimes[i]; let j = i - 1;
      while (j >= 0 && this.sortedTimes[j] > value) { this.sortedTimes[j + 1] = this.sortedTimes[j]; j--; }
      this.sortedTimes[j + 1] = value;
    }
    this.metrics.mean = sum / this.sampleCount;
    this.metrics.fps = 1000 / this.metrics.mean;
    this.metrics.p95 = this.sortedTimes[Math.max(0, Math.ceil(this.sampleCount * 0.95) - 1)];
    this.metrics.p99 = this.sortedTimes[Math.max(0, Math.ceil(this.sampleCount * 0.99) - 1)];
  }

  private autoQuality(dt: number): void {
    const slow = this.metrics.p95 > 27 || this.metrics.mean > 23;
    const fast = this.metrics.p95 < 18.7 && this.metrics.mean < 17.6;
    this.slowTime = slow ? this.slowTime + dt : 0;
    this.fastTime = fast ? this.fastTime + dt : 0;
    const maximum = this.coarsePointer ? 1 : 2;
    if ((this.slowTime > 2.5 && this.level > 0) || (this.fastTime > 10 && this.level < maximum)) {
      this.level += this.slowTime > 2.5 ? -1 : 1;
      this.slowTime = this.fastTime = this.qualityClock = 0;
      this.applyQuality();
    }
  }

  private applyQuality(): void {
    const ratios = [1, 1.5, 2];
    const pixelRatio = Math.min(window.devicePixelRatio || 1, ratios[this.level]);
    if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    // 所有画质都保留飞机投影；自动档不切换阴影着色器。
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.shadowMap.enabled = true;
    const shadowSize = this.quality === 'Auto' ? 1024 : this.level === 2 ? 2048 : this.level === 1 ? 1024 : 512;
    if (this.light.shadow.mapSize.x !== shadowSize) {
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
      this.light.shadow.mapSize.set(shadowSize, shadowSize);
    }
    this.detail.visible = this.level > 0;
    this.metrics.quality = ['Low', 'Medium', 'High'][this.level];
  }

  private geometryBytes(geometry: THREE.BufferGeometry): number {
    let bytes = geometry.index?.array.byteLength ?? 0;
    for (const name in geometry.attributes) bytes += geometry.attributes[name].array.byteLength;
    return bytes;
  }

  private geometryMemory(): number {
    let bytes = 0;
    // 顶点、索引、实例矩阵和纹理的 MiB 估算；不冒充浏览器进程或驱动总内存。
    const geometries = new Set<THREE.BufferGeometry>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (object instanceof THREE.InstancedMesh) bytes += object.instanceMatrix.array.byteLength;
      if (mesh.geometry && !geometries.has(mesh.geometry)) {
        geometries.add(mesh.geometry);
        for (const attribute of Object.values(mesh.geometry.attributes)) bytes += attribute.array.byteLength;
        bytes += mesh.geometry.index?.array.byteLength ?? 0;
      }
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const texture = (material as THREE.MeshBasicMaterial).map;
          if (texture && !textures.has(texture)) { textures.add(texture); bytes += (texture.image?.width ?? 0) * (texture.image?.height ?? 0) * 4; }
        }
      }
    });
    return bytes / 1048576;
  }

  private release(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    root.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(material);
          const map = (material as THREE.MeshBasicMaterial).map;
          if (map) textures.add(map);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
  }
}
