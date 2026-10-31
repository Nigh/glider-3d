import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BODY_GEOMETRY, clamp, clone, DEG, defaultAircraft, engineMounts, fuelTankDimensions, fuelTankPosition, fuselageEnds, mainWingMountLimits, mainWingSupport, resizeFuselage, wingOrigin, type AircraftDefinition, type Wing, type WingKey } from './model';
import { LAUNCH, PLATFORM, launchHeight, derive, fuelCgRange, type FlightSimulation } from './physics';
import { challengeCenter, challengeCheckpoints, challengeDefinitions, challengeTerrainGrid, challengeTerrainHeight, LOW_ALTITUDE, type ChallengeMode } from './challenges';
import { engineCatalog } from './engines';

type Quality = 'Auto' | 'High' | 'Medium' | 'Low';
const UP = new THREE.Vector3(0, 1, 0);
const WING_TRAIL_CAPACITY = 192;
const TRAIL_CAPACITY = 8192;
const PARTICLES = 64;
type EditorTarget = 'mainWing' | 'horizontalTail' | 'verticalTail' | 'assembly' | 'propulsion' | null;
const DOWN = new THREE.Vector3(0, -1, 0);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** 湖区常驻；山谷按挑战切换释放，动态飞机与轨迹缓冲区重复使用。 */
export class SceneView {
  readonly metrics = { fps: 60, mean: 16.7, p95: 16.7, p99: 16.7, renderMs: 0, geometryMs: 0, drawCalls: 0, triangles: 0, memory: 0, quality: 'Medium', geometries: 0, textures: 0, programs: 0 };
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly perspective = new THREE.PerspectiveCamera(43, 1, 0.1, 3000);
  private readonly orthographic = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 3000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private readonly controls: OrbitControls;
  private readonly aircraft = new THREE.Group();
  private readonly previousPosition = new THREE.Vector3();
  private readonly previousQuaternion = new THREE.Quaternion();
  private readonly previousCG = new THREE.Vector3();
  private readonly renderCG = new THREE.Vector3();
  private readonly body = new THREE.Group();
  private readonly pilot = new THREE.Group();
  private readonly driver = new THREE.Group();
  private readonly cockpit = new THREE.Group();
  private readonly engines: THREE.Group[] = [];
  private readonly engineSupports: THREE.Mesh[] = [];
  private readonly exhausts: THREE.Group[] = [];
  private readonly fuelTank = new THREE.Group();
  private exhaustStrength = 0;
  private exhaustPulse = 1;
  private readonly propulsionBounds = new THREE.Box3();
  private readonly aircraftMaterials = {
    ivory: new THREE.MeshStandardMaterial({ color: 0xf4f0dc, roughness: 0.65, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
    main: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.02, flatShading: true, side: THREE.DoubleSide, vertexColors: true }),
    orange: new THREE.MeshStandardMaterial({ color: 0xd97343, roughness: 0.7, flatShading: true, side: THREE.DoubleSide }),
    graphite: new THREE.MeshStandardMaterial({ color: 0x344740, roughness: 0.67, metalness: 0.2, flatShading: true }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd2a07e, roughness: 1, flatShading: true }),
    suit: new THREE.MeshStandardMaterial({ color: 0x53675e, roughness: 1, flatShading: true }),
    canopy: new THREE.MeshStandardMaterial({ color: 0x6dabb9, roughness: 0.16, metalness: 0.35 }),
    engine: new THREE.MeshStandardMaterial({ color: 0x9ba9ad, roughness: 0.3, metalness: 0.8 }),
    intake: new THREE.MeshStandardMaterial({ color: 0x172127, roughness: 0.7, metalness: 0.25 }),
    exhaust: new THREE.MeshBasicMaterial({ color: 0x247aff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    exhaustInner: new THREE.MeshBasicMaterial({ color: 0x64dfff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    exhaustCore: new THREE.MeshBasicMaterial({ color: 0xe5faff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
  };
  private readonly strutGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  private readonly wingMeshes: THREE.Mesh[] = [];
  private readonly wingParameters = new Float64Array(36).fill(NaN);
  private readonly wingNeutral: Float32Array[] = [];
  private readonly wingNormals: Float32Array[] = [];
  private readonly wingHinges: Float32Array[] = [];
  private readonly wingMovable: Uint8Array[] = [];
  private readonly wingAxes: THREE.Vector3[][] = [];
  private readonly wingAngles = new Float64Array(3).fill(NaN);
  private readonly hingeLines: THREE.LineSegments[] = [];
  private readonly surfaceParameters = new Float64Array(3).fill(NaN);
  private readonly surfaceRotation = new THREE.Matrix4();
  private readonly wingBaseColor = new THREE.Color(0xf4f0dc);
  private readonly wingTipColor = new THREE.Color(0xd97343);
  private beam!: THREE.Mesh;
  private support!: THREE.Mesh;
  private nose!: THREE.Mesh;
  private aircraftPending = false;
  private readonly detail = new THREE.Group();
  private readonly debugGroup = new THREE.Group();
  private readonly environment = new THREE.Group();
  private readonly mountainEnvironment = new THREE.Group();
  private environmentChallenge: ChallengeMode = 'birdman';
  private readonly catapult = new THREE.Group();
  private readonly shuttle = new THREE.Group();
  private towArm!: THREE.Mesh;
  private readonly towJaws: THREE.Mesh[] = [];
  private readonly steam = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 7, 5),
    new THREE.MeshBasicMaterial({ color: 0xf2f6f4, transparent: true, opacity: 0.22, depthWrite: false }),
    24,
  );
  private readonly steamParticle = new THREE.Object3D();
  private readonly environmentFog = new THREE.FogExp2(0xd4e3e4, 0.00165);
  private readonly light = new THREE.DirectionalLight(0xffedcf, 3.3);
  private readonly cg = this.centerMarker('cg');
  private readonly liftCenter = this.centerMarker('lift');
  private readonly designLiftCenter = new THREE.Vector3();
  private readonly dragCenter = this.centerMarker('drag');
  private readonly centerMarkers = [this.cg, this.liftCenter, this.dragCenter];
  private readonly fuelCgFull = new THREE.Group();
  private readonly fuelCgEmpty = new THREE.Group();
  private readonly fuelCgFullPosition = new THREE.Vector3();
  private readonly fuelCgEmptyPosition = new THREE.Vector3();
  private readonly fuelCgLineArray = new Float32Array(6);
  private readonly fuelCgLine = new THREE.Line(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0xffd52a, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
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
  private readonly editorHandles: { group: SVGGElement; leader: SVGLineElement; index: number; side: number; x: number; y: number; ax: number; ay: number }[] = [];
  private readonly editorSegments: { group: SVGGElement; index: number; side: number; x: number; y: number; x1: number; y1: number; x2: number; y2: number }[] = [];
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
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
    this.scene.add(this.light, this.light.target, this.aircraft, this.environment, this.mountainEnvironment, this.debugGroup);
    this.mountainEnvironment.visible = false;
    this.environment.add(this.detail);
    this.cg.renderOrder = this.liftCenter.renderOrder = this.dragCenter.renderOrder = 20;
    this.buildEnvironment();
    this.buildFuelCgRange();
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
    const arrowColors = [0x3bada1, 0xf08b5b, 0xa493c3, 0x3686bd];
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
    const marker = new THREE.Mesh(markerGeometry, markerMaterial);
    marker.visible = false;
    this.applicationMarkers.push(marker);
    this.debugGroup.add(marker);
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
    if (!this.simulation) {
      this.aircraft.rotation.set(0, 0, target ? 0 : -LAUNCH.slope);
      this.cameraView(!target || target === 'propulsion' ? 'orbit' : target === 'mainWing' || target === 'horizontalTail' ? 'top' : 'side');
    }
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
        handles: this.editorTarget && this.editorTarget !== 'propulsion' && !this.simulation ? this.editorHandles.filter(h => h.group.style.display !== 'none').map(h => ({ handle: Number(h.group.getAttribute('data-handle')), index: h.index, side: h.side, x: h.x, y: h.y })) : [],
        segments: this.editorTarget && this.editorTarget !== 'propulsion' && !this.simulation ? this.editorSegments.filter(s => s.group.style.display !== 'none').map(s => ({ id: s.index === 0 ? '14' : '23', side: s.side, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })) : [],
      },
      aircraft: position(this.aircraft.position),
      pilot: { visible: this.pilot.visible, movement: position(this.driver.position) },
      cockpitVisible: this.cockpit.visible,
      engines: this.engines.map((engine, index) => ({ visible: engine.visible, position: position(engine.position), supportVisible: this.engineSupports[index].visible, supportLength: this.engineSupports[index].scale.y })),
      fuelTank: { visible: this.fuelTank.visible, position: position(this.fuelTank.position) },
      exhaustStrength: this.exhaustStrength,
      exhaust: { pulse: this.exhaustPulse, time: this.simulation?.time ?? 0, layers: this.exhausts.map((group, index) => ({
        visible: group.visible, length: group.children[0].scale.y * this.engines[index].scale.x,
        radius: group.children[0].scale.x * this.engines[index].scale.y, layers: 3, flameCells: 4,
      })) },
      fuelCgRange: {
        visible: this.fuelCgLine.visible,
        full: position(this.fuelCgFullPosition), empty: position(this.fuelCgEmptyPosition),
        fullWorld: position(this.fuelCgFull.position), emptyWorld: position(this.fuelCgEmpty.position),
        labels: ['满油圆点', '空油菱形'],
      },
      controlSurfaces: this.wingMeshes.map((_mesh, index) => ({ fraction: this.surfaceParameters[index], angle: this.wingAngles[index], hingeVisible: this.hingeLines[index].visible })),
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
      environmentVisible: this.environment.visible || this.mountainEnvironment.visible,
      challenge: this.environmentChallenge,
      terrainGrid: this.environmentChallenge === 'birdman' ? null : challengeTerrainGrid,
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
    if (lift) this.liftCenter.position.copy(lift).sub(sim ? this.renderCG : this.designCG)
      .applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    if (drag) this.dragCenter.position.copy(drag).sub(sim ? this.renderCG : this.designCG)
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

  private buildFuelCgRange(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xffd52a, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.fuelCgFull.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 8), material));
    this.fuelCgEmpty.add(new THREE.Mesh(new THREE.RingGeometry(0.28, 0.48, 4), material));
    for (let index = 0; index < 2; index++) {
      const marker = index === 0 ? this.fuelCgFull : this.fuelCgEmpty;
      marker.name = index === 0 ? 'fuel-cg-full' : 'fuel-cg-empty';
      for (const child of marker.children) child.renderOrder = 24;
    }
    this.fuelCgLine.geometry.setAttribute('position', new THREE.BufferAttribute(this.fuelCgLineArray, 3).setUsage(THREE.DynamicDrawUsage));
    this.fuelCgLine.frustumCulled = false;
    this.fuelCgLine.renderOrder = 22;
    this.scene.add(this.fuelCgFull, this.fuelCgEmpty, this.fuelCgLine);
  }

  private updateFuelCgRange(): void {
    const visible = !this.simulation && this.definition.engine.count > 0 && this.definition.fuelTank.capacity > 0;
    this.fuelCgFull.visible = this.fuelCgEmpty.visible = this.fuelCgLine.visible = visible;
    if (!visible) return;
    this.fuelCgFull.position.copy(this.fuelCgFullPosition).sub(this.designCG).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    this.fuelCgEmpty.position.copy(this.fuelCgEmptyPosition).sub(this.designCG).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    this.fuelCgFull.position.toArray(this.fuelCgLineArray, 0);
    this.fuelCgEmpty.position.toArray(this.fuelCgLineArray, 3);
    this.fuelCgLine.geometry.getAttribute('position').needsUpdate = true;
    this.camera.getWorldDirection(this.vector2);
    for (let index = 0; index < 2; index++) {
      const marker = index === 0 ? this.fuelCgFull : this.fuelCgEmpty;
      marker.quaternion.copy(this.camera.quaternion);
      const depth = this.vector.copy(marker.position).sub(this.camera.position).dot(this.vector2);
      const metresPerPixel = this.camera === this.orthographic
        ? (this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom / this.height
        : 2 * Math.max(0.1, depth) * Math.tan(this.perspective.fov * DEG / 2) / this.height;
      marker.scale.setScalar(metresPerPixel * 14);
    }
  }

  private updateEnvironment(): void {
    const editing = !!this.editorTarget && !this.simulation;
    this.environment.visible = !editing && this.environmentChallenge === 'birdman';
    this.mountainEnvironment.visible = !editing && this.environmentChallenge !== 'birdman';
    this.scene.fog = editing ? null : this.environmentFog;
    this.debugGroup.visible = this.debug && !editing;
  }

  private surfaceHeight(x: number, z: number): number {
    if (this.environmentChallenge !== 'birdman') return challengeTerrainHeight(this.environmentChallenge, x, z);
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
      const leader = document.createElementNS(SVG_NS, 'line');
      leader.setAttribute('stroke', '#a33f24');
      leader.setAttribute('stroke-dasharray', '3 3');
      leader.style.pointerEvents = 'none';
      group.appendChild(leader);
      const knob = document.createElementNS(SVG_NS, 'circle');
      knob.setAttribute('r', '9');
      knob.setAttribute('fill', '#fafbf6');
      knob.setAttribute('stroke', '#a33f24');
      knob.setAttribute('stroke-width', '3');
      knob.setAttribute('data-segment-knob', '');
      const hit = knob.cloneNode() as SVGCircleElement;
      hit.removeAttribute('data-segment-knob');
      hit.setAttribute('r', '22');
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('stroke', 'none');
      group.append(hit, knob);
      this.editorSegments.push({ group, index: i === 0 ? 0 : 1, side: i === 2 ? -1 : 1, x: 0, y: 0, x1: 0, y1: 0, x2: 0, y2: 0 });
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
      const leader = document.createElementNS(SVG_NS, 'line');
      leader.setAttribute('stroke', '#a33f24');
      leader.setAttribute('stroke-dasharray', '3 3');
      leader.style.pointerEvents = 'none';
      overlay.appendChild(leader);
      group.append(hit, point, text);
      const handle = { group, leader, index: i < 4 ? i : i - 3, side: i < 4 ? 1 : -1, x: 0, y: 0, ax: 0, ay: 0 };
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
    if (!key || key === 'assembly' || key === 'propulsion') return out.set(0, 0, 0);
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
    const key = this.editorTarget, visible = !!key && key !== 'propulsion' && !this.simulation;
    this.editorOverlay.style.display = visible ? 'block' : 'none';
    if (!key || key === 'propulsion' || !visible || !this.editorDirty) return;
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
      handle.ax = handle.x; handle.ay = handle.y;
      handle.leader.style.display = 'none';
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
      segment.x1 = first.ax; segment.y1 = first.ay;
      segment.x2 = last.ax; segment.y2 = last.ay;
      const id = segment.index === 0 ? '14' : '23';
      segment.group.setAttribute('data-segment', id);
      segment.group.setAttribute('data-side', String(segment.side));
      const side = key === 'verticalTail' ? '' : segment.side > 0 ? '右翼' : '左翼';
      segment.group.setAttribute('aria-label', `${label}${segment.index === 0 ? '根弦线段1–4' : `${side}梢弦线段2–3`}`);
      for (const line of Array.from(segment.group.children).slice(0, 2)) {
        line.setAttribute('x1', String(segment.x1)); line.setAttribute('y1', String(segment.y1));
        line.setAttribute('x2', String(segment.x2)); line.setAttribute('y2', String(segment.y2));
      }
      // Root and tip controls extend along opposite chord normals, in CSS pixels.
      const dx = segment.x2 - segment.x1, dy = segment.y2 - segment.y1;
      const length = Math.hypot(dx, dy) || 1;
      const direction = segment.index === 0 ? -1 : segment.side;
      segment.x = (segment.x1 + segment.x2) / 2 + dy / length * 52 * direction;
      segment.y = (segment.y1 + segment.y2) / 2 - dx / length * 52 * direction;
      const desiredX = segment.x, desiredY = segment.y;
      let placed = false;
      for (let radius = 0; radius <= Math.max(this.width, this.height) && !placed; radius += 26) {
        for (let step = 0; step < 16; step++) {
          const x = desiredX + Math.cos(step * Math.PI / 8) * radius;
          const y = desiredY + Math.sin(step * Math.PI / 8) * radius;
          if (x < 24 || x > this.width - 24 || y < 64 || y > this.height - 24) continue;
          if (this.editorSegments.some((other, index) => index < i && other.group.style.display !== 'none' && Math.hypot(other.x - x, other.y - y) < 52)) continue;
          segment.x = x; segment.y = y; placed = true; break;
        }
      }
      const leader = segment.group.children[2];
      leader.setAttribute('x1', String((segment.x1 + segment.x2) / 2));
      leader.setAttribute('y1', String((segment.y1 + segment.y2) / 2));
      leader.setAttribute('x2', String(segment.x)); leader.setAttribute('y2', String(segment.y));
      for (const circle of Array.from(segment.group.children).slice(3)) {
        circle.setAttribute('cx', String(segment.x)); circle.setAttribute('cy', String(segment.y));
      }
    }
    if (key !== 'assembly') {
      const handles = this.editorHandles.filter(h => h.group.style.display !== 'none');
      const occupied = this.editorSegments.filter(s => s.group.style.display !== 'none').map(s => ({ x: s.x, y: s.y }));
      for (const handle of handles) {
        // Only crowded points move; leaders retain the actual geometry position.
        const crowded = handles.some(other => other !== handle && Math.hypot(other.ax - handle.ax, other.ay - handle.ay) < 52);
        if (crowded || handle.y < 64 || occupied.some(other => Math.hypot(other.x - handle.x, other.y - handle.y) < 52)) {
          let found = false;
          for (let radius = 52; radius <= Math.max(this.width, this.height) && !found; radius += 26) {
            for (let step = 0; step < 16; step++) {
              const angle = (handle.index < 2 ? -Math.PI / 2 : Math.PI / 2) + step * Math.PI / 8;
              const x = handle.ax + Math.cos(angle) * radius, y = handle.ay + Math.sin(angle) * radius;
              if (x < 24 || x > this.width - 24 || y < 64 || y > this.height - 24) continue;
              if (occupied.some(other => Math.hypot(other.x - x, other.y - y) < 52)) continue;
              if (handles.some(other => other !== handle && Math.hypot(other.ax - x, other.ay - y) < 52)) continue;
              handle.x = x; handle.y = y; found = true; break;
            }
          }
        }
        occupied.push(handle);
        handle.group.setAttribute('transform', `translate(${handle.x} ${handle.y})`);
        handle.leader.style.display = handle.x === handle.ax && handle.y === handle.ay ? 'none' : '';
        handle.leader.setAttribute('x1', String(handle.ax)); handle.leader.setAttribute('y1', String(handle.ay));
        handle.leader.setAttribute('x2', String(handle.x)); handle.leader.setAttribute('y2', String(handle.y));
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
    if (event.button !== 0 || !this.editorTarget || this.editorTarget === 'propulsion' || this.simulation || this.editorPointerId >= 0) return;
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
        const knobDistance = (line.x - x) ** 2 + (line.y - y) ** 2;
        if (knobDistance < nearest && knobDistance <= 22 ** 2) {
          nearest = knobDistance; vertex = -1; edge = i; edgeDistance = -1;
        }
        const dx = line.x2 - line.x1, dy = line.y2 - line.y1, squared = dx * dx + dy * dy;
        if (squared < 1e-6) continue;
        const t = ((x - line.x1) * dx + (y - line.y1) * dy) / squared;
        if (t <= 0 || t >= 1) continue;
        const distance = (x - line.x1 - t * dx) ** 2 + (y - line.y1 - t * dy) ** 2;
        if (distance < edgeDistance) { edgeDistance = distance; edge = i; }
      }
      if (edgeDistance < 0 || nearest > 36 && edge >= 0) { segment = true; index = edge; }
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
    if (this.editorPointerId < 0 || !this.editorTarget || this.editorTarget === 'propulsion' || event.pointerId !== this.editorPointerId || !this.intersectEditor(event)) return;
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
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || !this.editorTarget || this.editorTarget === 'propulsion' || this.simulation || this.editorPointerId >= 0) return;
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
    if (key && key !== 'assembly' && key !== 'propulsion') {
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
    if (!key || key === 'assembly' || key === 'propulsion') return;
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
    if (!key || key === 'assembly' || key === 'propulsion') return;
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
    if (key === 'propulsion') {
      const size = this.propulsionBounds.getSize(this.vector);
      const top = this.view === 'top', end = this.view === 'front' || this.view === 'rear';
      const horizontal = top || end ? size.z : size.x, vertical = top ? size.x : size.y;
      return Math.max(1.5, horizontal / (2 * aspect * 0.78), vertical / (2 * 0.78));
    }
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
    const cgRange = fuelCgRange(d);
    this.fuelCgFullPosition.copy(cgRange.full);
    this.fuelCgEmptyPosition.copy(cgRange.empty);
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
      const changed = this.wingChanged(i, wing, origin.x, origin.y, incidence);
      if (!changed && this.surfaceParameters[i] === wing.controlSurface) continue;
      this.surfaceParameters[i] = wing.controlSurface;
      const geometry = this.wingGeometry(wing, origin.x, origin.y, incidence, i);
      const position = geometry.getAttribute('position');
      const colors = new Float32Array(position.count * 3);
      const span = Math.max(wing.points[1].y, 0.1);
      for (let vertex = 0; vertex < position.count; vertex++) {
        const moving = this.wingMovable[i][vertex] !== 0;
        const orange = i === 2 ? !moving : moving || i === 0 && Math.abs(position.getZ(vertex)) > span * 0.82;
        (orange ? this.wingTipColor : this.wingBaseColor).toArray(colors, vertex * 3);
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      this.metrics.memory += (this.geometryBytes(geometry) - this.geometryBytes(this.wingMeshes[i].geometry)) / 1048576;
      this.wingMeshes[i].geometry.dispose();
      this.wingMeshes[i].geometry = geometry;
      this.wingAngles[i] = NaN;
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
    this.nose.position.x = fuselageEnds(d).nose + BODY_GEOMETRY.nose.x;
    this.pilot.position.x = d.cockpit.position;
    this.cockpit.position.x = d.cockpit.position;
    this.pilot.visible = d.birdman;
    this.cockpit.visible = !d.birdman;
    this.updatePropulsionGeometry();
    this.cg.visible = !this.simulation || this.debug;
    if (!this.simulation) {
      this.positionAtLaunch();
      this.aircraft.rotation.set(0, 0, this.editorTarget ? 0 : -LAUNCH.slope);
      this.driver.position.set(0, 0, 0);
    }
    this.updateControlSurfaces();
    if (!this.simulation && this.editorTarget === 'assembly' && this.editorPointerId < 0) this.centerAssemblyCamera();
    if (!this.simulation && this.editorTarget === 'propulsion') {
      this.propulsionBounds.getCenter(this.vector).sub(this.designCG).add(this.aircraft.position);
      this.vector2.copy(this.vector).sub(this.controls.target);
      this.controls.target.copy(this.vector);
      this.target.copy(this.vector);
      this.camera.position.add(this.vector2);
    }
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
    const { ivory, main, orange, graphite, skin, suit, canopy } = this.aircraftMaterials;
    this.aircraft.add(this.body);
    this.body.add(this.pilot, this.cockpit);
    this.pilot.add(this.driver);
    this.wingMeshes.push(this.mesh(new THREE.BufferGeometry(), main, this.body),
      this.mesh(new THREE.BufferGeometry(), main, this.body),
      this.mesh(new THREE.BufferGeometry(), main, this.body));
    for (let i = 0; i < 3; i++) {
      const line = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x344740 }));
      line.name = `${i === 0 ? 'aileron' : i === 1 ? 'elevator' : 'rudder'}-hinge`;
      this.hingeLines.push(line);
      this.body.add(line);
    }
    const shell = this.mesh(new THREE.SphereGeometry(1, 24, 12), ivory, this.cockpit);
    shell.name = 'streamlined-cockpit-shell';
    shell.scale.set(BODY_GEOMETRY.shell.xRadius, BODY_GEOMETRY.shell.yRadius, BODY_GEOMETRY.shell.zRadius);
    shell.position.set(BODY_GEOMETRY.shell.x, BODY_GEOMETRY.shell.y, 0);
    const glass = this.mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), canopy, this.cockpit);
    glass.name = 'cockpit-canopy';
    glass.scale.set(BODY_GEOMETRY.canopy.xRadius, BODY_GEOMETRY.canopy.yRadius, BODY_GEOMETRY.canopy.zRadius);
    glass.position.set(BODY_GEOMETRY.canopy.x, BODY_GEOMETRY.canopy.y, 0);
    this.beam = this.mesh(new THREE.CylinderGeometry(0.085, BODY_GEOMETRY.beamRadius, 1, 8), graphite, this.body);
    this.beam.rotation.z = Math.PI / 2;
    this.support = this.mesh(new THREE.BoxGeometry(1, 1, 0.06), graphite, this.body);
    this.support.name = 'main-wing-support';
    this.support.matrixAutoUpdate = false;
    this.support.visible = false;
    this.nose = this.mesh(new THREE.SphereGeometry(0.22, 10, 7), ivory, this.body);
    this.nose.position.set(0, BODY_GEOMETRY.nose.y, 0);
    this.nose.scale.set(BODY_GEOMETRY.nose.xRadius / 0.22, BODY_GEOMETRY.nose.yRadius / 0.22, BODY_GEOMETRY.nose.zRadius / 0.22);
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
    this.buildPropulsion();
  }

  private buildPropulsion(): void {
    const { engine: metal, intake: dark, graphite, orange, exhaust, exhaustInner, exhaustCore } = this.aircraftMaterials;
    const housingGeometry = new THREE.CylinderGeometry(1, 0.82, 0.8, 20, 1, true);
    const nozzleGeometry = new THREE.CylinderGeometry(0.75, 0.55, 0.2, 20, 1, true);
    const intakeGeometry = new THREE.CircleGeometry(0.92, 20);
    const rimGeometry = new THREE.TorusGeometry(0.96, 0.035, 6, 20);
    const hubGeometry = new THREE.ConeGeometry(0.24, 0.12, 12);
    const flameGeometry = new THREE.ConeGeometry(1, 1, 12, 1, true);
    const flameCellGeometry = new THREE.OctahedronGeometry(1, 0);
    const supportGeometry = new THREE.BoxGeometry(1, 1, 0.06);
    for (let index = 0; index < 2; index++) {
      const group = new THREE.Group();
      group.name = `jet-engine-${index + 1}`;
      this.engines.push(group);
      this.body.add(group);
      const housing = this.mesh(housingGeometry, metal, group);
      housing.rotation.z = -Math.PI / 2;
      housing.position.x = 0.1;
      const nozzle = this.mesh(nozzleGeometry, graphite, group);
      nozzle.rotation.z = -Math.PI / 2;
      nozzle.position.x = -0.4;
      const intake = this.mesh(intakeGeometry, dark, group);
      intake.rotation.y = Math.PI / 2;
      intake.position.x = 0.401;
      const rim = this.mesh(rimGeometry, metal, group);
      rim.rotation.y = Math.PI / 2;
      rim.position.x = 0.465;
      const hub = this.mesh(hubGeometry, graphite, group);
      hub.rotation.z = -Math.PI / 2;
      hub.position.x = 0.44;
      const plume = new THREE.Group();
      plume.name = 'actual-thrust-exhaust';
      for (const material of [exhaust, exhaustInner, exhaustCore]) {
        const layer = this.mesh(flameGeometry, material, plume);
        layer.rotation.z = Math.PI / 2;
        layer.castShadow = layer.receiveShadow = false;
      }
      for (let cell = 0; cell < 4; cell++) {
        const diamond = this.mesh(flameCellGeometry, exhaustCore, plume);
        diamond.castShadow = diamond.receiveShadow = false;
      }
      plume.visible = false;
      group.add(plume);
      this.exhausts.push(plume);
      const support = this.mesh(supportGeometry, graphite, this.body);
      support.name = `engine-support-${index + 1}`;
      this.engineSupports.push(support);
    }
    this.fuelTank.name = 'fuel-tank';
    this.body.add(this.fuelTank);
    const tank = this.mesh(new THREE.SphereGeometry(1, 20, 12), orange, this.fuelTank);
    tank.scale.x = 3;
    const strapGeometry = new THREE.TorusGeometry(0.88, 0.055, 6, 16);
    for (const x of [-1.4, 1.4]) {
      const strap = this.mesh(strapGeometry, graphite, this.fuelTank);
      strap.rotation.y = Math.PI / 2;
      strap.position.x = x;
    }
  }

  private updatePropulsionGeometry(): void {
    const d = this.definition, specification = engineCatalog[d.engine.type], mounts = engineMounts(d);
    const ends = fuselageEnds(d);
    this.propulsionBounds.min.set(ends.tail, -0.5, -0.5);
    this.propulsionBounds.max.set(ends.nose, 0.85, 0.5);
    for (let index = 0; index < this.engines.length; index++) {
      const group = this.engines[index], support = this.engineSupports[index], mount = mounts[index];
      group.visible = !!mount;
      support.visible = !!mount && mount.supportLength > 0;
      if (!mount) continue;
      group.position.set(mount.x, mount.y, mount.z);
      group.scale.set(specification.length, specification.radius, specification.radius);
      this.propulsionBounds.expandByPoint(this.vector.set(mount.x - specification.length / 2, mount.y - specification.radius, mount.z - specification.radius));
      this.propulsionBounds.expandByPoint(this.vector.set(mount.x + specification.length / 2, mount.y + specification.radius, mount.z + specification.radius));
      if (!support.visible) continue;
      this.vector.set(0, mount.y, mount.z).normalize();
      support.position.copy(this.vector).multiplyScalar(mount.supportLength / 2);
      support.position.x = mount.x;
      support.scale.set(mount.supportWidth, mount.supportLength, 1);
      support.quaternion.setFromUnitVectors(UP, this.vector);
    }
    this.fuelTank.visible = d.engine.count > 0 && d.fuelTank.capacity > 0;
    const tankPosition = fuelTankPosition(d);
    this.fuelTank.position.set(tankPosition.x, tankPosition.y, tankPosition.z);
    // A 3:1 ellipsoid holds exactly the configured litres; fuel burn does not resize its shell.
    const tank = fuelTankDimensions(d.fuelTank.capacity);
    this.fuelTank.scale.setScalar(tank.radius);
    if (this.fuelTank.visible) {
      this.propulsionBounds.expandByPoint(this.vector.set(tankPosition.x - tank.length / 2, tankPosition.y - tank.radius, -tank.radius));
      this.propulsionBounds.expandByPoint(this.vector.set(tankPosition.x + tank.length / 2, tankPosition.y + tank.radius, tank.radius));
    }
    this.updateExhaust();
  }

  private updateExhaust(): void {
    const sim = this.simulation, d = this.definition;
    const maximum = engineCatalog[d.engine.type].maxThrust * d.engine.count;
    const strength = sim && !sim.ended && maximum > 0 ? clamp(sim.telemetry.thrust / maximum, 0, 1) : 0;
    const time = this.reducedMotion ? 0 : sim?.time ?? 0;
    // Simulation time freezes pulsation while paused; no geometry or material allocation in flight.
    const pulse = 1 + 0.065 * Math.sin(time * 29) + 0.035 * Math.sin(time * 47);
    this.exhaustStrength = strength;
    this.exhaustPulse = pulse;
    this.aircraftMaterials.exhaust.opacity = strength * 0.38;
    this.aircraftMaterials.exhaustInner.opacity = strength * 0.58;
    this.aircraftMaterials.exhaustCore.opacity = strength * 0.82;
    for (let index = 0; index < this.exhausts.length; index++) {
      const plume = this.exhausts[index];
      plume.visible = this.engines[index].visible && strength > 0.001;
      if (!plume.visible) continue;
      const length = (0.45 + 6.5 * strength) * pulse;
      const radius = Math.sqrt(strength) * 1.45 / pulse;
      for (let layer = 0; layer < 3; layer++) {
        const mesh = plume.children[layer];
        const layerLength = length * (layer === 0 ? 1 : layer === 1 ? 0.78 : 0.48);
        const layerRadius = radius * (layer === 0 ? 1 : layer === 1 ? 0.65 : 0.3);
        mesh.position.x = -0.5 - layerLength / 2;
        mesh.scale.set(layerRadius, layerLength, layerRadius);
      }
      for (let cell = 0; cell < 4; cell++) {
        const mesh = plume.children[cell + 3];
        const fraction = (cell + 1) / 5;
        const size = radius * (0.24 - cell * 0.035);
        mesh.position.x = -0.5 - length * fraction * 0.83;
        mesh.scale.set(length * 0.065, size, size);
      }
    }
  }

  setFlight(sim: FlightSimulation | null): void {
    this.endEditorDrag();
    this.editorDirty = true;
    this.applyAircraft();
    this.simulation = sim;
    this.setEnvironmentChallenge(sim?.challenge ?? 'birdman');
    this.captureFlightState();
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
      // 随构型扩展条带可视化池；只在开始飞行时分配，帧内复用并隐藏多余对象。
      while (this.applicationMarkers.length < sim.surfaces.length) {
        const template = this.applicationMarkers[0];
        const marker = new THREE.Mesh(template.geometry, template.material);
        marker.visible = false;
        this.applicationMarkers.push(marker);
        this.debugGroup.add(marker);
      }
      while (this.arrows.length < sim.surfaces.length + 4) {
        const arrow = new THREE.ArrowHelper(UP, new THREE.Vector3(), 1, 0x3bada1, 0.35, 0.18);
        (arrow.line.material as THREE.LineBasicMaterial).depthTest = false;
        (arrow.cone.material as THREE.MeshBasicMaterial).depthTest = false;
        arrow.visible = false;
        this.arrows.push(arrow);
        this.debugGroup.add(arrow);
      }
      for (let i = 4; i < this.arrows.length; i++) {
        const surface = sim.surfaces[i - 4], arrow = this.arrows[i];
        arrow.visible = false;
        if (surface) {
          const color = surface.kind === 'main' ? 0x3bada1 : surface.kind === 'tail' ? 0xf08b5b : 0xa493c3;
          (arrow.line.material as THREE.LineBasicMaterial).color.setHex(color);
          (arrow.cone.material as THREE.MeshBasicMaterial).color.setHex(color);
        }
      }
      this.metrics.memory = this.geometryMemory();
      this.aircraft.position.copy(sim.position);
      this.aircraft.quaternion.copy(sim.quaternion);
      this.body.position.copy(sim.telemetry.cg).negate();
      this.lastTrail.copy(sim.position);
      this.cameraView('chase');
    } else {
      this.positionAtLaunch();
      this.aircraft.rotation.set(0, 0, this.editorTarget ? 0 : -LAUNCH.slope);
      this.driver.position.set(0, 0, 0);
      this.body.position.copy(this.designCG).negate();
      for (const arrow of this.arrows) arrow.visible = false;
      for (const marker of this.applicationMarkers) marker.visible = false;
      this.cameraView('orbit');
    }
    this.updateControlSurfaces();
    this.updateCenters();
  }

  cameraView(name: string): void {
    const names: Record<string, string> = { '俯视': 'top', '侧视': 'side', '正视': 'front', '后视': 'rear', '追尾': 'chase', '侧面': 'flight-side', '驾驶员': 'pilot', '自由': 'free', '自由镜头': 'free', '轨道': 'orbit', '三维': 'orbit', 'perspective': 'orbit', 'cockpit': 'pilot', 'follow': 'chase', 'back': 'rear' };
    this.view = names[name] ?? name;
    if (!this.simulation && this.editorTarget && this.editorTarget !== 'propulsion') this.view = this.editorTarget === 'verticalTail' || this.editorTarget === 'assembly' ? 'side' : 'top';
    const orthographic = ['top', 'side', 'front', 'rear'].includes(this.view);
    this.camera = orthographic ? this.orthographic : this.perspective;
    this.controls.object = this.camera;
    this.controls.enabled = !this.simulation || this.view === 'free' || this.view === 'orbit' || orthographic;
    this.controls.enableRotate = !orthographic;
    this.target.copy(this.aircraft.position);
    if (this.editorTarget && this.editorTarget !== 'assembly' && this.editorTarget !== 'propulsion' && !this.simulation) {
      const key = this.editorTarget, wing = this.definition[key], origin = wingOrigin(this.definition, key);
      const incidence = (key === 'mainWing' ? this.definition.assembly.mainIncidence : key === 'horizontalTail' ? this.definition.assembly.tailIncidence : 0) * DEG;
      const chord = (wing.points[0].x + wing.points[1].x + wing.points[2].x + wing.points[3].x) / 4;
      this.target.x += origin.x - chord * Math.cos(incidence) - this.designCG.x;
      this.target.y += origin.y - chord * Math.sin(incidence) + (key === 'verticalTail' ? wing.points[1].y / 2 : wing.points[1].y / 2 * Math.tan(wing.dihedral * DEG)) - this.designCG.y;
    } else if (this.editorTarget === 'assembly' && !this.simulation) {
      this.target.x += this.definition.fuselage.center - this.designCG.x;
      this.target.y -= this.designCG.y;
    } else if (this.editorTarget === 'propulsion' && !this.simulation) {
      this.propulsionBounds.getCenter(this.target).sub(this.designCG).add(this.aircraft.position);
    }
    this.controls.target.copy(this.target);
    const propulsion = this.editorTarget === 'propulsion' && !this.simulation;
    const distance = propulsion ? Math.max(7, this.propulsionBounds.getSize(this.vector).length() * 1.2) : Math.max(17, this.definition.mainWing.points[1].y * 2.4);
    if (this.view === 'top') this.vector.set(0, distance, 0.001);
    else if (this.view === 'side') this.vector.set(0, 0, distance);
    else if (this.view === 'front') this.vector.set(distance, 0, 0);
    else if (this.view === 'rear') this.vector.set(-distance, 0, 0);
    else if (propulsion) this.vector.set(0.8, 0.55, 0.9).normalize().multiplyScalar(distance * (this.width <= 700 ? 1.28 : 1));
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

  /** 在每个物理步之前保存状态；显示插值不回写物理仿真。 */
  captureFlightState(): void {
    const sim = this.simulation;
    if (!sim) return;
    this.previousPosition.copy(sim.position);
    this.previousQuaternion.copy(sim.quaternion);
    this.previousCG.copy(sim.telemetry.cg);
    this.renderCG.copy(sim.telemetry.cg);
  }

  render(dt: number, alpha = 1): void {
    if (this.disposed) return;
    const start = performance.now();
    this.applyAircraft();
    const seconds = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.elapsed += seconds;
    this.waterTime.value = this.reducedMotion ? 0 : this.elapsed;
    const sim = this.simulation;
    if (sim) {
      const blend = sim.ended || sim.replayFinished ? 1 : clamp(alpha, 0, 1);
      this.aircraft.position.lerpVectors(this.previousPosition, sim.position, blend);
      this.aircraft.quaternion.slerpQuaternions(this.previousQuaternion, sim.quaternion, blend);
      this.renderCG.lerpVectors(this.previousCG, sim.telemetry.cg, blend);
      this.body.position.copy(this.renderCG).negate();
      this.driver.position.set(sim.pilotOffset.x, 0, sim.pilotOffset.z);
      this.updateControlSurfaces();
      this.followCamera(seconds, false);
      this.recordTrail(seconds);
      this.recordWingTrail();
      this.updateDebug();
      const inWater = sim.result?.landing === 'water';
      if (inWater && !this.wasInWater) this.beginSplash(sim.position);
      this.wasInWater = inWater;
    }
    this.updateExhaust();
    if (this.splashAge >= 0) this.updateSplash(seconds);
    if (this.controls.enabled) this.controls.update();
    this.constrainCamera();
    this.updateCenters();
    this.updateFuelCgRange();
    this.updateEditorOverlay();
    this.light.target.position.copy(this.aircraft.position);
    this.light.position.copy(this.aircraft.position).add(this.vector.set(-55, 110, 65));
    this.updateCatapult();
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
  private wingGeometry(wing: Wing, rootX: number, height: number, incidence: number, index: number): THREE.BufferGeometry {
    const vertices: number[] = [], indices: number[] = [], hinges: number[] = [], movable: number[] = [], hingeLines: number[] = [];
    const vertical = index === 2, fraction = wing.controlSurface, hingeFraction = 1 - fraction;
    const chordSteps = 16, spanSteps = 5;
    const profileCount = chordSteps * 2;
    const c = Math.cos(incidence * DEG), s = Math.sin(incidence * DEG);
    const dihedral = Math.tan(wing.dihedral * DEG);
    const sides = vertical ? [1] : [-1, 1];
    const axes: THREE.Vector3[] = [];
    for (const side of sides) {
      const offset = vertices.length / 3;
      const rootChord = wing.points[3].x - wing.points[0].x;
      const tipChord = wing.points[2].x - wing.points[1].x;
      const rootHinge = -wing.points[0].x - hingeFraction * rootChord;
      const tipHinge = -wing.points[1].x - hingeFraction * tipChord;
      const spanLength = wing.points[1].y;
      axes.push(vertical ? (fraction === 1 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(tipHinge - rootHinge, spanLength, 0).normalize())
        : new THREE.Vector3((tipHinge - rootHinge) * c, (tipHinge - rootHinge) * s + spanLength * dihedral, spanLength * side).normalize());
      for (let row = 0; row <= spanSteps; row++) {
        const t = row / spanSteps;
        const leading = THREE.MathUtils.lerp(wing.points[0].x, wing.points[1].x, t);
        const trailing = THREE.MathUtils.lerp(wing.points[3].x, wing.points[2].x, t);
        const span = THREE.MathUtils.lerp(wing.points[0].y, wing.points[1].y, t);
        const chord = trailing - leading;
        const hingeX = -leading - hingeFraction * chord;
        const hingeY = vertical ? 0 : 0.018 * chord * Math.sin(Math.PI * hingeFraction);
        const hx = rootX + (vertical ? fraction === 1 ? -wing.points[0].x - rootChord * 0.25 : hingeX : hingeX * c - hingeY * s);
        const hy = height + (vertical ? span : hingeX * s + hingeY * c + span * dihedral);
        const hz = vertical ? 0 : span * side;
        if (row === 0 || row === spanSteps) hingeLines.push(hx, hy + (vertical ? 0 : chord * 0.055), hz + (vertical ? chord * 0.055 : 0));
        for (let k = 0; k < profileCount; k++) {
          const upper = k <= chordSteps;
          const j = upper ? k : profileCount - k;
          // Put an exact vertex on the hinge so the fixed panel never bends.
          const u = fraction > 0 && fraction < 1
            ? j <= 12 ? hingeFraction * (1 - Math.cos(j / 12 * Math.PI)) / 2
              : hingeFraction + fraction * (1 - Math.cos((j - 12) / 4 * Math.PI)) / 2
            : (1 - Math.cos(j / chordSteps * Math.PI)) / 2;
          const thickness = 5 * 0.105 * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
          const camber = vertical ? 0 : 0.018 * chord * Math.sin(Math.PI * u);
          const x = -leading - u * chord;
          const y = camber + (upper ? thickness : -thickness);
          if (vertical) vertices.push(rootX + x, height + span, y);
          else vertices.push(rootX + x * c - y * s, height + x * s + y * c + span * dihedral, span * side);
          hinges.push(hx, hy, hz);
          movable.push(fraction > 0 && u >= hingeFraction ? 1 : 0);
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
    this.wingNeutral[index] = new Float32Array(vertices);
    this.wingNormals[index] = new Float32Array(geometry.getAttribute('normal').array);
    this.wingHinges[index] = new Float32Array(hinges);
    this.wingMovable[index] = new Uint8Array(movable);
    this.wingAxes[index] = axes;
    (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (geometry.getAttribute('normal') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.hingeLines[index].geometry.dispose();
    this.hingeLines[index].geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(hingeLines, 3));
    this.hingeLines[index].visible = fraction > 0 && fraction < 1;
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += Math.max(wing.points[3].x - wing.points[0].x, wing.points[2].x - wing.points[1].x);
    return geometry;
  }

  private updateControlSurfaces(): void {
    const controls = this.simulation?.controlDeflections;
    for (let index = 0; index < 3; index++) {
      const angle = index === 0 ? controls?.aileron ?? 0 : index === 1 ? controls?.elevator ?? 0 : controls?.rudder ?? 0;
      if (angle === this.wingAngles[index]) continue;
      this.wingAngles[index] = angle;
      const geometry = this.wingMeshes[index].geometry;
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
      const neutral = this.wingNeutral[index], normals = this.wingNormals[index], hinges = this.wingHinges[index];
      const axes = this.wingAxes[index], count = position.count / axes.length;
      for (let side = 0; side < axes.length; side++) {
        const direction = index === 0 ? -1 : index === 1 ? side === 0 ? 1 : -1 : 1;
        this.surfaceRotation.makeRotationAxis(axes[side], angle * direction);
        for (let vertex = side * count; vertex < (side + 1) * count; vertex++) {
          if (!this.wingMovable[index][vertex]) continue;
          const offset = vertex * 3;
          this.vector2.fromArray(hinges, offset);
          this.vector.fromArray(neutral, offset).sub(this.vector2).applyMatrix4(this.surfaceRotation).add(this.vector2);
          position.setXYZ(vertex, this.vector.x, this.vector.y, this.vector.z);
          this.vector.fromArray(normals, offset).applyMatrix4(this.surfaceRotation);
          normal.setXYZ(vertex, this.vector.x, this.vector.y, this.vector.z);
        }
      }
      position.needsUpdate = normal.needsUpdate = true;
    }
  }

  private setEnvironmentChallenge(challenge: ChallengeMode): void {
    if (challenge === this.environmentChallenge) return;
    this.release(this.mountainEnvironment);
    this.mountainEnvironment.clear();
    this.environmentChallenge = challenge;
    const mountain = challenge !== 'birdman';
    this.environmentFog.color.setHex(challenge === 'downhill' ? 0xc6d9e8 : challenge === 'birdman' ? 0xd4e3e4 : 0xc9ded7);
    this.environmentFog.density = challenge === 'downhill' ? 0.00055 : challenge === 'birdman' ? 0.00165 : 0.0008;
    (this.scene.background as THREE.Color).copy(this.environmentFog.color);
    this.perspective.far = this.orthographic.far = mountain ? 6000 : 3000;
    this.perspective.updateProjectionMatrix();
    this.orthographic.updateProjectionMatrix();
    this.controls.maxDistance = mountain ? 1400 : 700;
    if (mountain) this.buildMountainEnvironment(challenge);
    this.metrics.memory = this.geometryMemory();
  }

  private buildMountainEnvironment(challenge: ChallengeMode): void {
    const downhill = challenge === 'downhill';
    const { minX, maxX, minZ, maxZ, step } = challengeTerrainGrid;
    const columns = Math.round((maxX - minX) / step) + 1;
    const rows = Math.round((maxZ - minZ) / step) + 1;
    const vertices = new Float32Array(columns * rows * 3);
    const colors = new Float32Array(vertices.length);
    const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
    const color = new THREE.Color(), grass = new THREE.Color(0x71856a), rock = new THREE.Color(0x8f928d), snow = new THREE.Color(0xeaf1ef);
    let triangle = 0;
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const x = minX + column * step, z = minZ + row * step;
      const y = challengeTerrainHeight(challenge, x, z);
      const vertex = row * columns + column, offset = vertex * 3;
      vertices[offset] = x; vertices[offset + 1] = y; vertices[offset + 2] = z;
      const slope = Math.abs(challengeTerrainHeight(challenge, x, z + step) - challengeTerrainHeight(challenge, x, z - step)) / (step * 2);
      color.copy(grass).lerp(rock, clamp(slope * 0.9 + (y - 250) / 1000, 0, 1));
      if (downhill) color.lerp(snow, clamp((y - 690) / 95, 0, 1) * clamp(1.5 - slope, 0, 1));
      color.multiplyScalar(0.94 + 0.06 * Math.sin(x * 0.06 + z * 0.08));
      color.toArray(colors, offset);
      if (column === columns - 1 || row === rows - 1) continue;
      // Same diagonal and interpolation as challengeTerrainHeight, including valley walls.
      indices[triangle++] = vertex; indices[triangle++] = vertex + columns; indices[triangle++] = vertex + 1;
      indices[triangle++] = vertex + 1; indices[triangle++] = vertex + columns; indices[triangle++] = vertex + columns + 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    const terrain = this.mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), this.mountainEnvironment);
    terrain.name = 'challenge-terrain';
    terrain.castShadow = false;

    const course = challengeDefinitions[challenge], gates = challengeCheckpoints(challenge);
    const route: number[] = [], routeIndices: number[] = [];
    const clearance = downhill && gates.length ? (gates[0].minHeight + gates[0].maxHeight) / 2 : LOW_ALTITUDE.scoringHeight / 2;
    for (let x = 0, sample = 0; x <= course.length; x += step, sample++) {
      const z = challengeCenter(challenge, x);
      const routeY = challengeTerrainHeight(challenge, x, z) + clearance;
      const y = THREE.MathUtils.lerp(course.startHeight, routeY, clamp(x / 180, 0, 1));
      route.push(x, y, z - 1.5, x, y, z + 1.5);
      if (sample === 0) continue;
      const a = (sample - 1) * 2;
      routeIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const routeGeometry = new THREE.BufferGeometry();
    routeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(route, 3));
    routeGeometry.setIndex(routeIndices);
    const routeMesh = new THREE.Mesh(routeGeometry, new THREE.MeshBasicMaterial({ color: 0xffdc82, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false }));
    routeMesh.name = 'continuous-flight-route';
    this.mountainEnvironment.add(routeMesh);
    const frameGeometry = new THREE.BoxGeometry(1, 1, 1);
    const checkpointMaterial = new THREE.MeshBasicMaterial({ color: 0xf2ba62 });
    const frameThickness = downhill ? 1.6 : 0.6;
    const finishMaterial = new THREE.MeshBasicMaterial({ color: 0x83e4d8, side: THREE.DoubleSide });
    for (let index = 0; index < gates.length; index++) {
      const gate = gates[index], finish = index === gates.length - 1;
      const group = new THREE.Group();
      group.name = finish ? 'challenge-finish' : `checkpoint-${index + 1}`;
      group.position.set(gate.x, gate.y, gate.z);
      this.mountainEnvironment.add(group);
      const height = gate.maxHeight - gate.minHeight;
      for (const side of [-1, 1]) {
        const post = this.mesh(frameGeometry, finish ? finishMaterial : checkpointMaterial, group);
        post.position.set(0, (gate.minHeight + gate.maxHeight) / 2, side * gate.halfWidth);
        post.scale.set(frameThickness, height, frameThickness);
        post.castShadow = post.receiveShadow = false;
      }
      for (const y of [gate.minHeight, gate.maxHeight]) {
        const bar = this.mesh(frameGeometry, finish ? finishMaterial : checkpointMaterial, group);
        bar.position.y = y;
        bar.scale.set(frameThickness, frameThickness, gate.halfWidth * 2);
        bar.castShadow = bar.receiveShadow = false;
      }
      if (!downhill) {
        const targetVertices: number[] = [];
        for (let z = -gate.halfWidth; z < gate.halfWidth; z += step) {
          const nextZ = Math.min(gate.halfWidth, z + step);
          const y = challengeTerrainHeight(challenge, gate.x, gate.z + z) - gate.y + LOW_ALTITUDE.scoringHeight;
          const nextY = challengeTerrainHeight(challenge, gate.x, gate.z + nextZ) - gate.y + LOW_ALTITUDE.scoringHeight;
          targetVertices.push(-0.6, y, z, 0.6, y, z, -0.6, nextY, nextZ,
            0.6, y, z, 0.6, nextY, nextZ, -0.6, nextY, nextZ);
        }
        const targetGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(targetVertices, 3));
        const target = new THREE.Mesh(targetGeometry, finishMaterial);
        target.name = 'low-altitude-scoring-height';
        group.add(target);
      }
      const sign = this.label(finish ? '终点 FINISH' : `检查点 ${index + 1} · ${gate.x} m`, '#213d40', finish ? '#a6eee4' : '#ffe0a0', 512, 96);
      sign.position.set(0, downhill ? gate.maxHeight + 9 : LOW_ALTITUDE.scoringHeight + 4, 0);
      sign.scale.set(downhill ? 40 : 24, downhill ? 7.5 : 4.5, 1);
      group.add(sign);
    }
    const start = this.label(`${downhill ? '山顶起飞' : '低空起飞'} · 沿金色航线穿过全部检查点`, '#213d40', '#eef5f0', 768, 96);
    start.position.set(10, course.startHeight + 14, challengeCenter(challenge, 0));
    start.scale.set(40, 5, 1);
    this.mountainEnvironment.add(start);
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
    // The bank and shoreline share vertices; the central approach meets the rear deck exactly.
    const vertices: number[] = [], indices: number[] = [];
    const shore: number[] = [];
    for (let i = 0; i <= 60; i++) {
      const z = -100 + i * (200 / 60);
      const approach = Math.exp(-((Math.max(0, Math.abs(z) - 6.5) / 13) ** 4));
      const edge = THREE.MathUtils.lerp(-18 + Math.sin(i * 0.9) * 2, LAUNCH.startX, approach);
      const height = 8 + approach * (LAUNCH.height + LAUNCH.length * Math.sin(LAUNCH.slope) - 8);
      shore.push(edge, height, z, edge + 9, 0, z);
      for (let j = 0; j <= 24; j++) {
        const t = j / 24, blend = t * t * (3 - 2 * t);
        vertices.push(THREE.MathUtils.lerp(-132.5, edge, t), THREE.MathUtils.lerp(8, height, blend), z);
        if (i < 60 && j < 24) {
          const a = i * 25 + j;
          indices.push(a, a + 25, a + 1, a + 1, a + 25, a + 26);
        }
      }
    }
    const bankGeometry = new THREE.BufferGeometry();
    bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    bankGeometry.setIndex(indices);
    bankGeometry.computeVertexNormals();
    this.terrain.push(this.mesh(bankGeometry, ground, this.environment));
    const cliff = new THREE.MeshStandardMaterial({ color: 0xb7b59b, roughness: 1, flatShading: true });
    const shoreIndices: number[] = [];
    for (let i = 0; i < 60; i++) {
      const a = i * 2;
      shoreIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const cliffGeometry = new THREE.BufferGeometry();
    cliffGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shore, 3));
    cliffGeometry.setIndex(shoreIndices);
    cliffGeometry.computeVertexNormals();
    const cliffMaterial = cliff.clone(); cliffMaterial.side = THREE.DoubleSide;
    this.terrain.push(this.mesh(cliffGeometry, cliffMaterial, this.environment));
    // One deterministic 2 m tile; world-space UVs keep grain equally sized on every face.
    const textureSize = 256;
    const pixels = new Uint8Array(textureSize * textureSize * 4);
    let seed = 0x63a9f217;
    const mottling = new Float32Array(64);
    for (let i = 0; i < mottling.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      mottling[i] = (seed / 0x100000000 - 0.5) * 12;
    }
    for (let y = 0; y < textureSize; y++) for (let x = 0; x < textureSize; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = seed / 0x100000000;
      const gx = x / 32, gy = y / 32, ix = Math.floor(gx), iy = Math.floor(gy);
      const fx = gx - ix, fy = gy - iy, tx = fx * fx * (3 - 2 * fx), ty = fy * fy * (3 - 2 * fy);
      const left = iy * 8 + ix, right = iy * 8 + ((ix + 1) & 7);
      const below = ((iy + 1) & 7) * 8;
      const patch = (mottling[left] * (1 - tx) + mottling[right] * tx) * (1 - ty)
        + (mottling[below + ix] * (1 - tx) + mottling[below + ((ix + 1) & 7)] * tx) * ty;
      const shade = Math.round(88 + patch + (grain - 0.5) * 28 - (grain < 0.055 ? 18 : 0));
      const offset = (y * textureSize + x) * 4;
      pixels[offset] = shade;
      pixels[offset + 1] = shade + 2;
      pixels[offset + 2] = shade + 3;
      pixels[offset + 3] = 255;
    }
    const concreteTexture = new THREE.DataTexture(pixels, textureSize, textureSize);
    concreteTexture.colorSpace = THREE.SRGBColorSpace;
    concreteTexture.wrapS = concreteTexture.wrapT = THREE.RepeatWrapping;
    concreteTexture.magFilter = THREE.LinearFilter;
    concreteTexture.minFilter = THREE.LinearMipmapLinearFilter;
    concreteTexture.generateMipmaps = true;
    concreteTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    concreteTexture.needsUpdate = true;
    const concrete = new THREE.MeshStandardMaterial({ map: concreteTexture, roughness: 0.98 });
    const runway = new THREE.Group();
    runway.position.set(LAUNCH.endX, LAUNCH.height, 0);
    runway.rotation.z = -LAUNCH.slope;
    this.environment.add(runway);
    runway.add(this.catapult);
    this.catapult.name = 'steam-catapult';
    this.steam.name = 'catapult-steam';
    this.steam.frustumCulled = false;
    this.catapult.add(this.steam);
    const platformGeometry = new THREE.BoxGeometry(LAUNCH.length, PLATFORM.thickness, (PLATFORM.width - PLATFORM.slotWidth) / 2);
    const positions = platformGeometry.getAttribute('position');
    const normals = platformGeometry.getAttribute('normal');
    const uv = platformGeometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      const top = Math.abs(normals.getY(i)) > 0.5;
      const end = Math.abs(normals.getX(i)) > 0.5;
      uv.setXY(i, (end ? positions.getZ(i) : positions.getX(i)) / 2, (top ? positions.getZ(i) : positions.getY(i)) / 2);
    }
    for (const side of [-1, 1]) {
      const platform = this.mesh(platformGeometry, concrete, runway);
      platform.name = 'launch-platform';
      platform.position.set(-LAUNCH.length / 2, -PLATFORM.thickness / 2, side * (PLATFORM.width + PLATFORM.slotWidth) / 4);
      this.terrain.push(platform);
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x48565b, roughness: 0.42, metalness: 0.75 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x202c30, roughness: 0.6, metalness: 0.65 });
    const brass = new THREE.MeshStandardMaterial({ color: 0xd49a4b, roughness: 0.4, metalness: 0.7 });
    const trough = this.mesh(new THREE.BoxGeometry(LAUNCH.length, PLATFORM.slotFloorThickness, PLATFORM.slotWidth), darkSteel, this.catapult);
    trough.position.set(-LAUNCH.length / 2, -PLATFORM.slotDepth - PLATFORM.slotFloorThickness / 2, 0);
    for (const side of [-1, 1]) {
      const rail = this.mesh(new THREE.BoxGeometry(LAUNCH.length, 0.12, 0.075), steel, this.catapult);
      rail.position.set(-LAUNCH.length / 2, -0.02, side * 0.27);
      const pipe = this.mesh(new THREE.CylinderGeometry(0.07, 0.07, LAUNCH.length, 8), brass, this.catapult);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(-LAUNCH.length / 2, -0.22, side * 0.19);
    }
    this.shuttle.name = 'catapult-shuttle';
    this.catapult.add(this.shuttle);
    const sled = this.mesh(new THREE.BoxGeometry(0.8, 0.18, 0.46), steel, this.shuttle);
    sled.position.y = -0.03;
    this.towArm = this.mesh(this.strutGeometry, brass, this.shuttle);
    for (const side of [-1, 1]) {
      const jaw = this.mesh(new THREE.BoxGeometry(0.32, 0.12, 0.09), steel, this.shuttle);
      jaw.userData.side = side;
      this.towJaws.push(jaw);
    }
    const stop = this.mesh(new THREE.BoxGeometry(0.18, 0.2, 0.68), brass, this.catapult);
    stop.position.set(0.05, 0, 0);
    const supportGeometry = new THREE.BoxGeometry(0.5, 1, 0.5);
    for (const fraction of [0.2, 0.6, 0.9]) for (const z of [-5.4, 5.4]) {
      const x = -LAUNCH.length * fraction * Math.cos(LAUNCH.slope);
      const height = LAUNCH.height - x * Math.tan(LAUNCH.slope) - 0.6;
      const support = this.mesh(supportGeometry, cliff, this.environment);
      support.position.set(x, height / 2, z);
      support.scale.y = height;
    }
    const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    // The recessed steam slot replaces the painted centerline.
    const edgeGeometry = new THREE.BoxGeometry(LAUNCH.length, 0.08, 0.14);
    for (const z of [-6.2, 6.2]) {
      const edge = this.mesh(edgeGeometry, stripeMaterial, runway);
      edge.position.set(-LAUNCH.length / 2, 0.05, z);
    }
    const thresholdGeometry = new THREE.PlaneGeometry(0.2, 12.4);
    for (const x of [-LAUNCH.length + 0.35, -0.35]) {
      const threshold = this.mesh(thresholdGeometry, stripeMaterial, runway);
      threshold.rotation.x = -Math.PI / 2;
      threshold.position.set(x, 0.02, 0);
    }
    for (const side of [-1, 1]) {
      const plate = this.mesh(new THREE.BoxGeometry(7.4, 1.05, 0.12), steel, runway);
      plate.name = 'runway-specification-sign';
      plate.position.set(-5, -1.4, side * 6.52);
      for (const x of [-8, -2]) {
        const hanger = this.mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), steel, runway);
        hanger.position.set(x, -0.75, side * 6.52);
      }
      const sign = this.label('跑道 10 m · 坡度 3.5°', '#37483e', '#f5eedb', 512, 80, true);
      sign.position.set(-5, -1.4, side * 6.59);
      sign.rotation.y = side < 0 ? Math.PI : 0;
      sign.scale.set(7.1, 0.85, 1);
      runway.add(sign);
    }
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
    this.environment.updateMatrixWorld(true);
    for (let i = 0; i < 48; i++) {
      const x = -27 - (i % 8) * 11 + Math.sin(i * 7.2) * 3;
      const z = (i < 24 ? -1 : 1) * (15 + Math.floor((i % 24) / 8) * 22 + Math.sin(i * 2.2) * 8);
      const scale = 0.8 + (Math.sin(i * 8.2) + 1) * 0.8;
      const groundY = this.surfaceHeight(x, z);
      instance.position.set(x, groundY + 0.8, z);
      instance.scale.setScalar(1);
      instance.updateMatrix();
      trunks.setMatrixAt(i, instance.matrix);
      instance.position.set(x, groundY + 2 + scale * 1.1, z);
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
      const label = this.label(`${distance} m`, '#f7f1dc', '#49665c', 192, 80, true);
      label.name = `water-distance-${distance}`;
      label.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
      label.position.set(distance, 0.025, -19);
      label.scale.set(5.2, 2.15, 1);
      this.environment.add(label);
    }
    this.scene.add(this.cg, this.liftCenter, this.dragCenter);
    this.scene.updateMatrixWorld(true);
  }

  private updateCatapult(): void {
    if (this.environmentChallenge !== 'birdman') return;
    const attached = !this.simulation || this.simulation.launching;
    this.catapult.updateWorldMatrix(true, false);
    this.aircraft.updateWorldMatrix(true, false);
    this.vector.copy(this.aircraft.position);
    this.catapult.worldToLocal(this.vector);
    this.shuttle.position.set(attached ? clamp(this.vector.x, -LAUNCH.length, 0) : 0, 0, 0);
    // A telescopic tow arm reaches the fuselage for every editable CG and wing height.
    this.vector.set(this.definition.fuselage.center, 0, 0).sub(this.simulation ? this.renderCG : this.designCG);
    this.aircraft.localToWorld(this.vector);
    this.catapult.worldToLocal(this.vector).sub(this.shuttle.position);
    if (!attached) this.vector.set(0, 0.16, 0);
    this.vector2.set(0, 0.04, 0);
    this.placeStrut(this.towArm, this.vector2, this.vector, 0.055);
    for (const jaw of this.towJaws) {
      jaw.position.copy(this.vector);
      jaw.position.z += jaw.userData.side * (attached ? 0.11 : 0.26);
      jaw.rotation.x = attached ? 0 : jaw.userData.side * 0.65;
    }
    const time = this.simulation?.time ?? 0;
    const releaseAge = time - LAUNCH.speed / LAUNCH.acceleration;
    this.steam.visible = time > 0 && releaseAge < 0.8 && !this.simulation?.ended;
    if (this.steam.visible) {
      for (let i = 0; i < this.steam.count; i++) {
        const age = (time * 1.8 + i / this.steam.count) % 1;
        const fade = releaseAge > 0 ? Math.max(0, 1 - releaseAge / 0.8) : 1;
        this.steamParticle.position.set(
          clamp(this.shuttle.position.x - age * 2.5, -LAUNCH.length, 0),
          0.05 + age * 0.85,
          Math.sin(i * 2.4) * age * 0.5,
        );
        this.steamParticle.scale.setScalar((0.12 + age * 0.7) * (1 - age * 0.5) * fade);
        this.steamParticle.updateMatrix();
        this.steam.setMatrixAt(i, this.steamParticle.matrix);
      }
      this.steam.instanceMatrix.needsUpdate = true;
    }
  }

  private label(text: string, color: string, background: string, width: number, height: number, flat = false): THREE.Sprite | THREE.Mesh {
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
    if (flat) return new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, depthWrite: false }));
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
    this.desiredPosition.sub(this.renderCG);
    this.desiredTarget.sub(this.renderCG);
    this.desiredPosition.applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    this.desiredTarget.applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    this.desiredPosition.y = Math.max(0.45, this.desiredPosition.y);
    const blend = immediate || pilot || this.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
    this.camera.position.lerp(this.desiredPosition, blend);
    this.target.lerp(this.desiredTarget, blend);
    this.camera.up.copy(pilot ? this.vector.copy(UP).applyQuaternion(this.aircraft.quaternion) : UP);
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
    this.wingTrail.material.opacity = 0.12 + strength * 0.14;
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
        if (recent === this.wingTrailIndex) {
          this.wingTrailPoint.set(origin.x - chordX * Math.cos(incidence),
            origin.y - chordX * Math.sin(incidence) + span * Math.tan(wing.dihedral * DEG),
            (side === 0 ? -1 : 1) * span).sub(this.renderCG)
            .applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
        }
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
    this.cg.position.copy(this.aircraft.position);
    this.vector.copy(sim.telemetry.force).sub(sim.telemetry.drag);
    this.setArrow(this.arrows[0], this.aircraft.position, this.vector, 0.005);
    this.setArrow(this.arrows[1], this.aircraft.position, sim.telemetry.drag, 0.008);
    this.vector.set(0, -9.81 * sim.telemetry.mass, 0);
    this.setArrow(this.arrows[2], this.aircraft.position, this.vector, 0.005);
    this.setArrow(this.arrows[3], this.aircraft.position, sim.velocity, 0.3);
    for (let i = 0; i < this.applicationMarkers.length; i++) {
      const surface = sim.surfaces[i];
      const marker = this.applicationMarkers[i];
      marker.visible = !!surface;
      if (surface) {
        marker.position.copy(surface.point).sub(this.renderCG).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
        this.setArrow(this.arrows[i + 4], marker.position, surface.force, 0.007);
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
