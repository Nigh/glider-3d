import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BODY_GEOMETRY, clamp, clone, DEG, defaultAircraft, cockpitLimits, editWingPoint, normalizeAircraftGeometry, wingMountLimits, engineMounts, fuelTankDimensions, fuelTankPosition, fuelTankLimits, normalizeEngineHeight, fuselageEnds, mainWingMountLimits, mainWingSupport, resizeFuselage, wingOrigin, wingLocalPoint, type AircraftDefinition, type Wing, type WingKey } from './model';
import { LAUNCH, PLATFORM, SURFACE_STEP, launchHeight, derive, fuelCgRange, type FlightSimulation } from './physics';
import { downhillHeightLimit, downhillRouteCenter, downhillRuins, challengeCenter, challengeCheckpoints, challengeDefinitions, challengeLaunch, challengeStartGate, challengeGateProfile, CHALLENGE_WARNING_EXTENT, challengeRiverCenter, challengeRiverHeight, CHALLENGE_RIVER, challengeTerrainGrid, challengeTerrainHeight, challengeCollisionHeight, LOW_ALTITUDE, LOW_ALTITUDE_RAIL, type ChallengeCheckpoint, type ChallengeMode } from './challenges';
import { lowAltitudeRailSample, type LowAltitudeRailSample } from './challenges';
import { engineCatalog } from './engines';
import { isLaboratory, TEST_SPACE, testSpaceTerrainHeight } from './laboratory';
import { LaboratoryScene } from './laboratory-scene';
import { language, t } from './i18n';

type Quality = 'Auto' | 'High' | 'Medium' | 'Low';
const UP = new THREE.Vector3(0, 1, 0);
const WING_TRAIL_CAPACITY = 192;
const TRAIL_CAPACITY = 8192;
const PARTICLES = 64;
const STEAM_CAPACITY = 384;
const STEAM_PAIRS_PER_SECOND = 120;
const STEAM_LIFETIME = 1.6;
type EditorTarget = 'fuselage' | 'mainWing' | 'horizontalTail' | 'verticalTail' | 'propulsion' | null;
const CAMERA_MAX_PUSH = 8;
const DOWN = new THREE.Vector3(0, -1, 0);
const SVG_NS = 'http://www.w3.org/2000/svg';

export type PilotHudFrame = {
  width: number; height: number; clip: string; marker: string; ladder: string; dashedLadder: string;
  labels: { angle: number; left: string; right: string }[];
  speedLabel: string; speed: string; altitudeLabel: string; altitude: string; clearance: string; stall: string;
};

type PhysicsSection = FlightSimulation['structure']['sections'][number];
type WingRenderSection = {
  wingIndex: number; side: number; spanStart: number; spanEnd: number;
  vertexStart: number; rows: number; rootCap: number; tipCap: number;
  skin: number[]; rootIndices: number[]; tipIndices: number[];
  previous: WingRenderSection | null; next: WingRenderSection | null;
  physics: PhysicsSection | null; bodyId: number; previousBodyId: number;
  previousRoot: THREE.Vector3; previousTip: THREE.Vector3;
  previousRootRotation: THREE.Quaternion; previousTipRotation: THREE.Quaternion;
  root: THREE.Vector3; tip: THREE.Vector3;
  rootRotation: THREE.Quaternion; tipRotation: THREE.Quaternion;
  referenceRoot: THREE.Vector3; referenceTip: THREE.Vector3;
};
type FragmentRender = {
  id: number; wingIndex: number; mesh: THREE.Mesh; hinge: THREE.LineSegments;
  previousPosition: THREE.Vector3; previousQuaternion: THREE.Quaternion; previousCG: THREE.Vector3;
  cg: THREE.Vector3; captured: boolean;
};

/** 湖区常驻；山谷按挑战切换释放，动态飞机与轨迹缓冲区重复使用。 */
export class SceneView {
  readonly metrics = { fps: 60, mean: 16.7, p95: 16.7, p99: 16.7, renderMs: 0, geometryMs: 0, drawCalls: 0, triangles: 0, memory: 0, quality: 'Medium', geometries: 0, textures: 0, programs: 0 };
  onEditorSelect: ((target: Exclude<EditorTarget, null>) => void) | null = null;
  onDesignViewChange: ((view: string) => void) | null = null;
  private readonly crashMark = new THREE.Group();
  private crashAge = -1;
  private crashStroke: (() => void) | null = null;
  private crashSecond = false;
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly perspective = new THREE.PerspectiveCamera(43, 1, 0.1, 3000);
  private readonly orthographic = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 3000);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private controls: OrbitControls;
  private readonly controlsUp = UP.clone();
  private readonly aircraft = new THREE.Group();
  private readonly previousPosition = new THREE.Vector3();
  private readonly previousQuaternion = new THREE.Quaternion();
  private readonly previousCG = new THREE.Vector3();
  private readonly renderCG = new THREE.Vector3();
  private readonly body = new THREE.Group();
  private readonly pilot = new THREE.Group();
  private readonly driver = new THREE.Group();
  private readonly cockpit = new THREE.Group();
  private readonly pilotInterior = new THREE.Group();
  private readonly headOffset = new THREE.Vector3();
  private readonly headInverse = new THREE.Quaternion();
  private headTime = 0;
  private readonly hudMatrix = new THREE.Matrix4();
  private readonly engines: THREE.Group[] = [];
  private readonly engineSupports: THREE.Mesh[] = [];
  private readonly exhausts: THREE.Group[] = [];
  private readonly fuelTank = new THREE.Group();
  private exhaustStrength = 0;
  private exhaustPulse = 1;
  private readonly propulsionBounds = new THREE.Box3();
  private readonly aircraftMaterials = {
    ivory: new THREE.MeshStandardMaterial({ color: 0xf4f0dc, roughness: 0.65, metalness: 0.02, flatShading: true, side: THREE.DoubleSide }),
    main: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.02, flatShading: false, side: THREE.DoubleSide, vertexColors: true }),
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
  private readonly wingHinges: Float32Array[] = [];
  private readonly wingMovable: Uint8Array[] = [];
  private readonly wingAxes: THREE.Vector3[][] = [];
  private readonly wingAngles = new Float64Array(3).fill(NaN);
  private readonly wingSections: WingRenderSection[][] = [[], [], []];
  private readonly wingNormalGeometry: THREE.BufferGeometry[] = [];
  private readonly fragments: FragmentRender[] = [];
  private readonly deformationCenter = new THREE.Vector3();
  private readonly controlRotation = new THREE.Quaternion();
  private readonly deformationRotation = new THREE.Quaternion();
  private readonly deformationPoint = new THREE.Vector3();
  private readonly deformationReference = new THREE.Vector3();
  private readonly deformationRootTangent = new THREE.Vector3();
  private readonly deformationTipTangent = new THREE.Vector3();
  private readonly deformationAxis = new THREE.Vector3();
  private readonly deformationHinge = new THREE.Vector3();
  private renderBlend = 1;
  private readonly hingeLines: THREE.LineSegments[] = [];
  private readonly surfaceParameters = new Float64Array(3).fill(NaN);
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
  private readonly workshop = new THREE.Group();
  private environmentChallenge: ChallengeMode = 'birdman';
  private laboratoryScene: LaboratoryScene | null = null;
  private mountainShuttle: THREE.Mesh | null = null;
  private lowAltitudeRail: THREE.Group | null = null;
  private railCarriage: THREE.Group | null = null;
  private railCoupling: THREE.Mesh | null = null;
  private readonly railReferenceCG = new THREE.Vector3();
  private readonly railAttachment = new THREE.Vector3();
  private railLastAttachedX = 0;
  private railReferenceHeight = 0;
  private readonly railSample: LowAltitudeRailSample = { x: 0, y: 0, pitch: 0, slope: 0, pitchDerivative: 0 };
  private readonly catapult = new THREE.Group();
  private readonly shuttle = new THREE.Group();
  private towArm!: THREE.Mesh;
  private readonly towJaws: THREE.Mesh[] = [];
  private readonly steam = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 7, 5),
    new THREE.MeshBasicMaterial({ color: 0xf2f6f4, transparent: true, opacity: 0.38, depthWrite: false }),
    STEAM_CAPACITY,
  );
  private readonly steamParticle = new THREE.Object3D();
  private readonly steamOpacity = new THREE.InstancedBufferAttribute(new Float32Array(STEAM_CAPACITY), 1).setUsage(THREE.DynamicDrawUsage);
  private steamTime = 0;
  private steamEmitting = false;
  private readonly environmentFog = new THREE.FogExp2(0xd4e3e4, 0.00165);
  private readonly light = new THREE.DirectionalLight(0xffedcf, 3.3);
  private readonly cg = this.centerMarker('cg');
  private readonly liftCenter = this.centerMarker('lift');
  private readonly designLiftCenter = new THREE.Vector3();
  private readonly dragCenter = this.centerMarker('drag');
  private readonly thrustCenter = this.centerMarker('thrust');
  private readonly designThrustCenter = new THREE.Vector3();
  private readonly centerMarkers = [this.cg, this.liftCenter, this.dragCenter, this.thrustCenter];
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
  private readonly editorSegments: { group: SVGGElement; index: number; side: number; x: number; y: number; ax: number; ay: number; x1: number; y1: number; x2: number; y2: number }[] = [];
  private editorSegmentDrag = -1;
  private readonly editorSnap: { active: boolean; kind: 'grid' | 'vertex' | 'mount' | null; value: number | null; disabled: boolean } = { active: false, kind: null, value: null, disabled: false };
  private editorTarget: EditorTarget = null;
  private editorChange: ((definition: AircraftDefinition) => void) | null = null;
  private editorCommit: (() => void) | null = null;
  private readonly cancelEditorDrag = () => {
    this.endEditorDrag(true);
    this.selectionPointer = -1; this.selectionTarget = null;
    this.setHoveredPart(null);
  };
  private editorDrag = -1;
  private editorPointerId = -1;
  private editorChanged = false;
  private editDefinition: AircraftDefinition | null = null;
  private editorDirty = true;
  private readonly partRay = new THREE.Raycaster();
  private readonly partHits: THREE.Intersection[] = [];
  private readonly partPointer = new THREE.Vector2();
  private readonly hoverBox = new THREE.Box3();
  private readonly hoverOutline = new THREE.Box3Helper(this.hoverBox, 0x164f91);
  private hoverTarget: EditorTarget = null;
  private selectionPointer = -1;
  private selectionX = 0;
  private selectionY = 0;
  private selectionMoved = false;
  private selectionTarget: EditorTarget = null;
  private designOrbitRotation = new THREE.Quaternion();
  private readonly trailArray = new Float32Array(TRAIL_CAPACITY * 6);
  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly trail: THREE.LineSegments;
  private readonly lastTrail = new THREE.Vector3();
  private trailClock = 0;
  private trailIndex = 0;
  private trailCount = 0;
  private readonly wingTrailArray = new Float32Array(WING_TRAIL_CAPACITY * 36);
  private readonly wingTrailColors = new Float32Array(WING_TRAIL_CAPACITY * 48);
  private readonly wingTrailGeometry = new THREE.BufferGeometry();
  private readonly wingTrail: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly wingTrailHistory = new Float32Array((WING_TRAIL_CAPACITY + 1) * 6);
  private readonly wingTrailDistances = new Float64Array(2);
  private readonly wingTrailLengths = new Float64Array(2);
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
  private readonly spherical = new THREE.Spherical();
  private cameraDragging = false;
  private cameraReleasedAt = -Infinity;
  private cameraPointer = -1;
  private cameraPointerX = 0;
  private cameraPointerY = 0;
  private cameraYaw = 0;
  private cameraPitch = 0;
  private readonly cameraHome = new THREE.Vector3();
  private readonly targetHome = new THREE.Vector3();
  private resultOrbit = false;
  private readonly resultOffset = new THREE.Vector3();
  private readonly resultTarget = new THREE.Vector3();
  private readonly followPosition = new THREE.Vector3();
  private readonly followTarget = new THREE.Vector3();
  private followInitialized = false;
  private readonly cameraClearanceOffset = new THREE.Vector3();
  private readonly cameraClearanceOrigin = new THREE.Vector3();
  private readonly cameraClearancePoint = new THREE.Vector3();
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
  private splashSurface = 0;
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
    this.renderer.domElement.setAttribute('aria-label', t('滑空机三维视图。拖动旋转，滚轮缩放，右键或双指平移。'));
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
    for (const marker of this.centerMarkers) marker.renderOrder = 20;
    this.buildEnvironment();
    this.buildWorkshop();
    this.scene.add(this.workshop, this.hoverOutline);
    this.workshop.visible = false;
    this.hoverOutline.visible = false;
    this.hoverOutline.renderOrder = 110;
    const outlineMaterial = this.hoverOutline.material as THREE.LineBasicMaterial;
    outlineMaterial.depthTest = outlineMaterial.depthWrite = false;
    outlineMaterial.toneMapped = outlineMaterial.fog = false;
    this.buildFuelCgRange();
    this.wingTrailGeometry.setAttribute('position', new THREE.BufferAttribute(this.wingTrailArray, 3).setUsage(THREE.DynamicDrawUsage));
    this.wingTrailGeometry.setAttribute('color', new THREE.BufferAttribute(this.wingTrailColors, 4).setUsage(THREE.DynamicDrawUsage));
    this.wingTrailGeometry.setDrawRange(0, 0);
    this.wingTrail = new THREE.Mesh(this.wingTrailGeometry, new THREE.MeshBasicMaterial({ color: 0xf5fcff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
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
    this.controls = this.createControls();
    this.renderer.domElement.addEventListener('pointerdown', event => {
      if (this.controls.enabled || event.button !== 0) return;
      this.cameraPointer = event.pointerId;
      this.cameraPointerX = event.clientX; this.cameraPointerY = event.clientY;
      this.cameraDragging = true;
      this.renderer.domElement.setPointerCapture(event.pointerId);
    });
    this.renderer.domElement.addEventListener('pointermove', event => {
      if (event.pointerId !== this.cameraPointer) return;
      if (!this.resultOrbit) this.cameraYaw -= (event.clientX - this.cameraPointerX) * 0.006;
      this.cameraPitch += (event.clientY - this.cameraPointerY) * (this.view === 'pilot' && !this.resultOrbit ? 0.006 : -0.006);
      const limit = this.view === 'locked' && !this.resultOrbit ? 0.12 : 1.35;
      this.cameraPitch = clamp(this.cameraPitch, -limit, limit);
      if (this.view === 'locked' && !this.resultOrbit) this.cameraYaw = clamp(this.cameraYaw, -0.18, 0.18);
      this.cameraPointerX = event.clientX; this.cameraPointerY = event.clientY;
    });
    const releaseCamera = (event: PointerEvent) => {
      if (event.pointerId !== this.cameraPointer) return;
      this.cameraPointer = -1; this.cameraDragging = false;
      this.cameraReleasedAt = this.elapsed;
    };
    this.renderer.domElement.addEventListener('pointerup', releaseCamera);
    this.renderer.domElement.addEventListener('pointercancel', releaseCamera);
    this.beginPartSelection = this.beginPartSelection.bind(this);
    this.movePartSelection = this.movePartSelection.bind(this);
    this.endPartSelection = this.endPartSelection.bind(this);
    this.cancelPartSelection = this.cancelPartSelection.bind(this);
    this.leavePartSelection = this.leavePartSelection.bind(this);
    this.renderer.domElement.addEventListener('pointerdown', this.beginPartSelection, true);
    this.renderer.domElement.addEventListener('pointermove', this.movePartSelection);
    this.renderer.domElement.addEventListener('pointerup', this.endPartSelection, true);
    this.renderer.domElement.addEventListener('pointercancel', this.cancelPartSelection);
    this.renderer.domElement.addEventListener('lostpointercapture', this.cancelPartSelection);
    this.renderer.domElement.addEventListener('pointerleave', this.leavePartSelection);
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
    this.unsubscribeLanguage = language.subscribe(() => {
      this.editorDirty = true;
      this.editorOverlay.setAttribute('aria-label', t('真实翼面与部件位置编辑'));
      this.renderer.domElement.setAttribute('aria-label', t('滑空机三维视图。拖动旋转，滚轮缩放，右键或双指平移。'));
      this.scene.traverse(object => object.userData.redrawLabel?.());
    });
  }

  private createControls(): OrbitControls {
    this.controlsUp.copy(this.camera.up);
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = 3;
    controls.maxDistance = 700;
    controls.maxPolarAngle = Math.PI * 0.94;
    controls.minZoom = 0.1;
    controls.maxZoom = 10;
    controls.addEventListener('change', () => { this.editorDirty = true; this.promoteDesignPerspective(); });
    controls.addEventListener('start', () => { this.cameraDragging = true; });
    controls.addEventListener('end', () => { this.cameraDragging = false; this.cameraReleasedAt = this.elapsed; });
    return controls;
  }

  private refreshControlsUp(): void {
    if (this.controlsUp.equals(this.camera.up)) return;
    // OrbitControls caches the up-axis transform at construction, not when object.up changes.
    const previous = this.controls;
    previous.dispose();
    this.controls = this.createControls();
    this.controls.target.copy(previous.target);
    this.controls.enabled = previous.enabled;
    this.controls.enableDamping = previous.enableDamping;
  }

  private readonly unsubscribeLanguage: () => void;

  setEditor(target: EditorTarget, onchange: (definition: AircraftDefinition) => void, oncommit: () => void): void {
    this.editorChange = onchange;
    this.editorCommit = oncommit;
    if (this.editorTarget === target) return;
    const wasEditing = !!this.editorTarget;
    this.endEditorDrag();
    this.editorTarget = target;
    if (!this.simulation && !!target !== wasEditing) this.positionAtLaunch();
    for (const handle of this.editorHandles) handle.x = handle.y = handle.ax = handle.ay = 0;
    for (const segment of this.editorSegments) segment.x = segment.y = segment.ax = segment.ay = 0;
    this.editorDirty = true;
    this.updateEnvironment();
    if (!this.simulation) {
      this.aircraft.rotation.set(0, 0, target ? 0 : -LAUNCH.slope);
      if (!!target !== wasEditing) this.cameraView('orbit');
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
      workshopVisible: this.workshop.visible,
      cameraClearance: { maximumPush: CAMERA_MAX_PUSH, offset: position(this.cameraClearanceOffset) },
      editor: {
        target: this.editorTarget, dragging: this.editorDrag, segment: this.editorSegmentDrag < 0 ? null : this.editorSegments[this.editorSegmentDrag].index === 0 ? '14' : '23',
        hover: this.hoverTarget,
        parts: [this.beam, ...this.wingMeshes, ...this.engines.filter(engine => engine.visible)].map(object => {
          const point = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
          point.project(this.camera);
          return { target: this.partTarget(object), x: (point.x + 1) * this.width / 2, y: (1 - point.y) * this.height / 2 };
        }),
        snap: { ...this.editorSnap },
        fuselageEnds: fuselageEnds(this.definition),
        mainWingMountLimits: mainWingMountLimits(this.definition), mountSnapTolerance: this.mountSnapTolerance(),
        handles: this.editorTarget && !this.simulation ? this.editorHandles.filter(h => h.group.style.display !== 'none').map(h => ({ handle: Number(h.group.getAttribute('data-handle')), index: h.index, side: h.side, x: h.x, y: h.y, ax: h.ax, ay: h.ay })) : [],
        segments: this.editorTarget && !this.simulation ? this.editorSegments.filter(s => s.group.style.display !== 'none').map(s => ({ id: s.index === 0 ? '14' : '23', side: s.side, x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 })) : [],
      },
      aircraft: position(this.aircraft.position),
      pilot: { visible: this.pilot.visible, movement: position(this.driver.position) },
      cockpitVisible: this.cockpit.visible,
      aircraftExteriorVisible: this.body.visible,
      pilotInteriorVisible: this.pilotInterior.visible,
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
      centers: { cg: position(this.cg.position), lift: position(this.liftCenter.position), drag: position(this.dragCenter.position), thrust: position(this.thrustCenter.position) },
      centerVisibility: { cg: this.cg.visible, lift: this.liftCenter.visible, drag: this.dragCenter.visible, thrust: this.thrustCenter.visible },
      thrustCenter: { body: position(this.designThrustCenter), direction: position(new THREE.Vector3(0, 1, 0).applyQuaternion(this.thrustCenter.quaternion)) },
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
      terrainGrid: this.environmentChallenge === 'test-space' ? { minX: -5000, maxX: 5000, minZ: -5000, maxZ: 5000, step: TEST_SPACE.step } : this.environmentChallenge === 'birdman' || this.environmentChallenge === 'wind-tunnel' ? null : challengeTerrainGrid,
      laboratory: this.laboratoryScene ? { mode: this.laboratoryScene.mode, room: this.laboratoryScene.room, platformHeight: this.laboratoryScene.platform.position.y, platformX: this.laboratoryScene.platform.position.x,
        balloons: this.laboratoryScene.platform.children.filter(child => child.name === 'platform-balloon').length,
        walls: this.mountainEnvironment.children.filter(child => child.name.startsWith('wind-tunnel-') && child.name !== 'wind-tunnel-airflow').map(child => ({ name: child.name, ...child.userData })),
        wind: this.simulation?.challenge === 'wind-tunnel' ? { ...this.simulation.windTunnel } : null } : null,
      lowAltitudeRail: this.lowAltitudeRail && this.railCarriage ? {
        visible: this.mountainEnvironment.visible && this.lowAltitudeRail.visible,
        height: LOW_ALTITUDE_RAIL.height, launch: challengeLaunch('low-altitude'),
        attached: this.simulation?.challenge === 'low-altitude' && this.simulation.launching,
        couplingVisible: this.railCoupling?.visible ?? false,
        carriage: position(this.railCarriage.position), attachment: position(this.railAttachment),
        pitch: this.railCarriage.rotation.z,
        exitPitch: LOW_ALTITUDE_RAIL.exitPitch,
        referenceCG: position(this.railReferenceCG),
        supportCount: this.lowAltitudeRail.userData.supportCount as number,
        steamVisible: this.steam.visible,
      } : null,
      gates: this.mountainEnvironment.children.filter(object => object.userData.gate).map(object => ({
        name: object.name, position: position(object.position), ...object.userData.gate,
        profile: object.userData.gate.profile.map((point: { z: number; bottom: number; top: number }) => ({ ...point })),
      })),
      wingTrail: { active: this.wingTrailActive, segments: this.wingTrailGeometry.drawRange.count / 6, opacity: this.wingTrail.material.opacity, style: 'ribbon' },
      catapultSteam: this.steamDiagnostics(),
      structureRendering: this.structureDiagnostics(),
    };
  }

  /** 按需快照，不进入逐帧路径；浏览器 smoke 可检查接缝、法线、封口、归属与几何复用。 */
  private structureDiagnostics() {
    const point = (value: THREE.Vector3) => ({ x: value.x, y: value.y, z: value.z });
    const world = (section: WingRenderSection, value: THREE.Vector3) => {
      const fragment = this.fragmentRender(section.bodyId);
      const result = value.clone();
      if (fragment) result.sub(fragment.cg).applyQuaternion(fragment.mesh.quaternion).add(fragment.mesh.position);
      else result.sub(this.simulation ? this.renderCG : this.designCG).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
      return point(result);
    };
    return {
      smoothShading: !this.aircraftMaterials.main.flatShading, displayStep: 0.2,
      meshCount: this.wingMeshes.length + this.fragments.length, blend: this.renderBlend,
      wings: this.wingSections.map((sections, index) => {
        const geometry = this.wingMeshes[index].geometry;
        const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
        let maxSeamGap = 0, maxNormalError = 0, maxDeflection = 0, caps = 0, finite = true;
        for (let vertex = 0; vertex < positions.count; vertex++) {
          finite &&= Number.isFinite(positions.getX(vertex)) && Number.isFinite(positions.getY(vertex)) && Number.isFinite(positions.getZ(vertex))
            && Number.isFinite(normals.getX(vertex)) && Number.isFinite(normals.getY(vertex)) && Number.isFinite(normals.getZ(vertex));
          maxNormalError = Math.max(maxNormalError, Math.abs(Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex)) - 1));
        }
        for (const section of sections) {
          maxDeflection = Math.max(maxDeflection, section.root.distanceTo(section.referenceRoot), section.tip.distanceTo(section.referenceTip));
          if (!section.previous || section.previous.bodyId !== section.bodyId) caps++;
          if (!section.next || section.next.bodyId !== section.bodyId) caps++;
          if (!section.next || section.next.bodyId !== section.bodyId) continue;
          for (let k = 0; k < 32; k++) {
            const a = section.vertexStart + section.rows * 32 + k, b = section.next.vertexStart + k;
            maxSeamGap = Math.max(maxSeamGap, Math.hypot(positions.getX(a) - positions.getX(b), positions.getY(a) - positions.getY(b), positions.getZ(a) - positions.getZ(b)));
          }
        }
        return {
          wingKey: index === 0 ? 'mainWing' : index === 1 ? 'horizontalTail' : 'verticalTail',
          geometryId: geometry.uuid, vertices: positions.count, attachedTriangles: geometry.drawRange.count / 3,
          sectionCount: sections.length, caps, finite, maxSeamGap, maxNormalError, maxDeflection,
          bounds: geometry.boundingBox ? { min: point(geometry.boundingBox.min), max: point(geometry.boundingBox.max) } : null,
          sections: sections.map(section => ({
            id: section.physics?.id ?? null, side: section.side, spanStart: section.spanStart, spanEnd: section.spanEnd,
            bodyId: section.bodyId, rows: section.rows,
            rootWorld: world(section, section.root), tipWorld: world(section, section.tip),
            root: point(section.root), tip: point(section.tip),
            controlDeflection: section.physics?.controlDeflection ?? 0,
            rootCap: !section.previous || section.previous.bodyId !== section.bodyId,
            tipCap: !section.next || section.next.bodyId !== section.bodyId,
          })),
        };
      }),
      fragments: this.fragments.map(fragment => ({
        id: fragment.id, wingIndex: fragment.wingIndex, geometryId: fragment.mesh.geometry.uuid,
        triangles: fragment.mesh.geometry.drawRange.count / 3, position: point(fragment.mesh.position),
        quaternion: { x: fragment.mesh.quaternion.x, y: fragment.mesh.quaternion.y, z: fragment.mesh.quaternion.z, w: fragment.mesh.quaternion.w },
        cg: point(fragment.cg),
        landed: this.simulation?.fragments.find(body => body.id === fragment.id)?.landed ?? false,
      })),
      applicationMarkers: this.applicationMarkers.map((marker, index) => ({
        bodyId: this.simulation?.surfaces[index]?.bodyId ?? null, visible: marker.visible, position: point(marker.position),
      })),
    };
  }

  private positionAtLaunch(): void {
    if (this.editorTarget) this.aircraft.position.set(LAUNCH.startX + this.designCG.x, LAUNCH.height + 1 + this.designCG.y, this.designCG.z);
    else this.aircraft.position.set(LAUNCH.startX, launchHeight(this.definition, this.designCG), 0);
  }

  private centerMarker(kind: 'cg' | 'lift' | 'drag' | 'thrust'): THREE.Group {
    const marker = new THREE.Group();
    const surface = new THREE.MeshBasicMaterial({ color: kind === 'cg' ? 0xffd52a : kind === 'lift' ? 0x19b9ef : kind === 'thrust' ? 0xd58032 : 0xe43c3c, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false });
    const black = new THREE.MeshBasicMaterial({ color: 0x17201d, depthTest: false, depthWrite: false, transparent: true, toneMapped: false, fog: false });
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
    this.thrustCenter.visible = !sim && this.definition.engine.count > 0;
    this.cg.position.copy(this.aircraft.position);
    if (lift) this.liftCenter.position.copy(lift).sub(sim ? this.renderCG : this.designCG)
      .applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    if (drag) this.dragCenter.position.copy(drag).sub(sim ? this.renderCG : this.designCG)
      .applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    this.thrustCenter.position.copy(this.designThrustCenter).sub(this.designCG)
      .applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    this.vector.set(1, 0, 0).applyQuaternion(this.aircraft.quaternion);
    this.thrustCenter.quaternion.setFromUnitVectors(UP, this.vector);
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
    this.workshop.visible = editing;
    this.workshop.position.copy(this.aircraft.position).sub(this.designCG);
    this.scene.background = new THREE.Color(editing ? 0x07182d : 0xd4e3e4);
    this.controls.maxDistance = editing ? 72 : 700;
    this.controls.maxPolarAngle = editing ? Math.PI : Math.PI * 0.94;
    if (!editing) this.setHoveredPart(null);
    this.scene.fog = editing || this.environmentChallenge === 'wind-tunnel' ? null : this.environmentFog;
    this.debugGroup.visible = this.debug && !editing;
  }

  private surfaceHeight(x: number, z: number): number {
    if (this.environmentChallenge === 'wind-tunnel') return 2;
    if (this.environmentChallenge !== 'birdman') return challengeCollisionHeight(this.environmentChallenge, x, z);
    this.groundRay.set(this.vector.set(x, 1000, z), DOWN);
    this.groundHits.length = 0;
    this.groundRay.intersectObjects(this.terrain, false, this.groundHits);
    return Math.max(0, this.groundHits[0]?.point.y ?? 0);
  }

  private restoreCameraClearance(): void {
    this.camera.position.sub(this.cameraClearanceOffset);
    this.cameraClearanceOffset.set(0, 0, 0);
  }

  private constrainCamera(): void {
    if (this.editorTarget && !this.simulation) return;
    const target = this.controls.enabled ? this.controls.target : this.target;
    const origin = this.cameraClearanceOrigin.copy(this.camera.position);
    const offset = this.cameraClearanceOffset;
    offset.set(0, 0, 0);
    const distance = origin.distanceTo(target);
    // Prefer shortening the sightline. Terrain walls must not cause unbounded upward teleporting.
    if (distance > 0.001) {
      const maximumPull = Math.min(CAMERA_MAX_PUSH, Math.max(0, distance - 0.05));
      for (let sample = 0; sample <= 32; sample++) {
        const fraction = 1 - maximumPull * sample / (32 * distance);
        this.cameraClearancePoint.lerpVectors(target, origin, fraction);
        const point = this.cameraClearancePoint;
        if (point.y >= this.surfaceHeight(point.x, point.z) + 0.55) {
          this.camera.position.copy(point);
          break;
        }
      }
    }
    const minimum = this.surfaceHeight(this.camera.position.x, this.camera.position.z) + 0.55;
    offset.subVectors(this.camera.position, origin);
    const maximumY = Math.sqrt(Math.max(0, CAMERA_MAX_PUSH ** 2 - offset.x ** 2 - offset.z ** 2));
    offset.y += Math.min(Math.max(0, minimum - this.camera.position.y), Math.max(0, maximumY - offset.y));
    this.camera.position.copy(origin).add(offset);
    this.camera.lookAt(target);
  }

  private buildWorkshop(): void {
    this.workshop.name = 'design-wind-tunnel';
    const wall = new THREE.Mesh(new THREE.BoxGeometry(160, 96, 160),
      new THREE.MeshStandardMaterial({ color: 0x102b4d, roughness: 0.88, side: THREE.BackSide }));
    wall.name = 'workshop-deep-blue-walls';
    wall.position.y = 36;
    wall.receiveShadow = true;
    this.workshop.add(wall);
    for (const surface of ['floor', 'back', 'front', 'left', 'right'] as const) {
      const grid = new THREE.GridHelper(160, 160, 0x6596bf, 0x294d71);
      grid.name = `workshop-${surface}-metre-grid`;
      if (surface === 'floor') grid.position.y = -11.98;
      else if (surface === 'back' || surface === 'front') {
        grid.rotation.x = Math.PI / 2;
        grid.position.set(0, 36, surface === 'back' ? -79.98 : 79.98);
        grid.scale.z = 0.6;
      } else {
        grid.rotation.z = Math.PI / 2;
        grid.position.set(surface === 'left' ? -79.98 : 79.98, 36, 0);
        grid.scale.x = 0.6;
      }
      this.workshop.add(grid);
    }
    const frameMaterial = new THREE.MeshBasicMaterial({ color: 0x5280a9 });
    const frameGeometry = new THREE.TorusGeometry(24, 0.22, 6, 48);
    for (const side of [-1, 1]) {
      const frame = new THREE.Mesh(frameGeometry, frameMaterial);
      frame.name = 'wind-tunnel-duct';
      frame.rotation.y = Math.PI / 2;
      frame.position.set(side * 79.8, 15, 0);
      this.workshop.add(frame);
    }
    for (let metre = -70; metre <= 70; metre += 10) {
      const tick = this.label(`${metre} m`, '#d5eeff', '#102b4d', 192, 80, true);
      tick.name = 'workshop-metre-label';
      tick.position.set(metre, -11.96, -16);
      tick.rotation.x = -Math.PI / 2;
      tick.scale.set(3.6, 1.5, 1);
      this.workshop.add(tick);
      const wallTick = this.label(`${metre} m`, '#d5eeff', '#102b4d', 192, 80, true);
      wallTick.position.set(metre, -8, -79.96);
      wallTick.scale.set(3.6, 1.5, 1);
      this.workshop.add(wallTick);
    }
  }

  private promoteDesignPerspective(): void {
    if (this.simulation || this.camera !== this.orthographic || !this.cameraDragging
      || this.editorPointerId >= 0 || this.camera.quaternion.angleTo(this.designOrbitRotation) < 1e-6) return;
    const target = this.controls.target;
    const distance = (this.orthographic.top - this.orthographic.bottom)
      / (2 * this.orthographic.zoom * Math.tan(this.perspective.fov * DEG / 2));
    this.vector.subVectors(this.orthographic.position, target).setLength(distance);
    this.perspective.position.copy(target).add(this.vector);
    this.perspective.quaternion.copy(this.orthographic.quaternion);
    this.perspective.up.copy(this.orthographic.up);
    this.camera = this.perspective;
    this.controls.object = this.camera;
    this.view = 'orbit';
    this.editorDirty = true;
    this.onDesignViewChange?.('orbit');
  }

  private partTarget(object: THREE.Object3D): EditorTarget {
    let target: EditorTarget = null;
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      if (!node.visible) return null;
      if (!target && node.userData.editorTarget) target = node.userData.editorTarget as EditorTarget;
    }
    return target;
  }

  private pickPart(event: PointerEvent): EditorTarget {
    if (!this.editorTarget || this.simulation || this.editorPointerId >= 0) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.partPointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    this.body.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld();
    this.partRay.setFromCamera(this.partPointer, this.camera);
    this.partHits.length = 0;
    this.partRay.intersectObject(this.body, true, this.partHits);
    for (const hit of this.partHits) {
      if (!(hit.object instanceof THREE.Mesh)) continue;
      const target = this.partTarget(hit.object);
      if (target) return target;
    }
    return null;
  }

  private setHoveredPart(target: EditorTarget): void {
    this.hoverTarget = target;
    this.hoverOutline.visible = !!target;
    this.renderer.domElement.style.cursor = target ? 'pointer' : '';
    if (!target) return;
    this.hoverBox.makeEmpty();
    this.body.traverse(object => {
      if (object instanceof THREE.Mesh && this.partTarget(object) === target) this.hoverBox.expandByObject(object);
    });
    this.hoverBox.expandByScalar(0.08);
  }

  private beginPartSelection(event: PointerEvent): void {
    if (event.button !== 0 || !this.editorTarget || this.simulation || this.editorPointerId >= 0) return;
    if (this.selectionPointer >= 0) { this.selectionMoved = true; return; }
    this.selectionPointer = event.pointerId;
    this.selectionX = event.clientX; this.selectionY = event.clientY;
    this.selectionMoved = false;
    this.selectionTarget = this.pickPart(event);
  }

  private movePartSelection(event: PointerEvent): void {
    if (event.pointerId === this.selectionPointer
      && Math.hypot(event.clientX - this.selectionX, event.clientY - this.selectionY) > 5) this.selectionMoved = true;
    if (this.selectionPointer < 0 && !this.cameraDragging) this.setHoveredPart(this.pickPart(event));
    else this.setHoveredPart(null);
  }

  private endPartSelection(event: PointerEvent): void {
    if (event.pointerId !== this.selectionPointer) return;
    const target = !this.selectionMoved && this.selectionTarget === this.pickPart(event) ? this.selectionTarget : null;
    this.selectionPointer = -1;
    this.selectionTarget = null;
    if (target) {
      if (this.editorChange && this.editorCommit) this.setEditor(target, this.editorChange, this.editorCommit);
      this.onEditorSelect?.(target);
    }
    this.setHoveredPart(this.pickPart(event));
  }

  private cancelPartSelection(event: PointerEvent): void {
    if (event.pointerId !== this.selectionPointer) return;
    this.selectionPointer = -1; this.selectionTarget = null;
    this.setHoveredPart(null);
  }

  private leavePartSelection(): void { this.setHoveredPart(null); }

  private buildEditorOverlay(): void {
    const overlay = this.editorOverlay;
    overlay.classList.add('scene-editor');
    overlay.setAttribute('aria-label', t('真实翼面与部件位置编辑'));
    overlay.style.cssText = 'display:none;position:absolute;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;touch-action:none';
    for (let i = 0; i < 2; i++) {
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.classList.add('editor-selection');
      overlay.appendChild(polygon);
      this.editorPolygons.push(polygon);
    }
    for (let i = 0; i < 3; i++) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.classList.add('editor-control', 'editor-chord', i === 0 ? 'editor-root-chord' : 'editor-tip-chord');
      group.style.cssText = 'pointer-events:none;cursor:grab';
      for (const halo of [true, false]) {
        const line = document.createElementNS(SVG_NS, 'line');
        line.classList.add(halo ? 'editor-line-halo' : 'editor-chord-line');
        line.style.pointerEvents = 'none';
        group.appendChild(line);
      }
      const leader = document.createElementNS(SVG_NS, 'line');
      leader.classList.add('editor-leader');
      leader.setAttribute('stroke', 'currentColor');
      leader.setAttribute('stroke-dasharray', '3 3');
      leader.style.pointerEvents = 'none';
      group.appendChild(leader);
      const knob = document.createElementNS(SVG_NS, 'circle');
      knob.setAttribute('r', '10');
      knob.classList.add('editor-knob');
      knob.setAttribute('stroke', 'currentColor');
      knob.setAttribute('stroke-width', '3');
      knob.setAttribute('data-segment-knob', '');
      const hit = knob.cloneNode() as SVGCircleElement;
      hit.removeAttribute('data-segment-knob');
      hit.removeAttribute('class');
      hit.setAttribute('r', '22');
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('stroke', 'none');
      hit.style.pointerEvents = 'all';
      knob.style.pointerEvents = 'all';
      const text = document.createElementNS(SVG_NS, 'text');
      text.classList.add('editor-control-label');
      text.textContent = t(i === 0 ? '根弦 1–4' : '梢弦 2–3');
      const focus = document.createElementNS(SVG_NS, 'circle');
      focus.classList.add('editor-focus-ring');
      focus.setAttribute('r', '17');
      group.append(hit, knob, focus, text);
      this.editorSegments.push({ group, index: i === 0 ? 0 : 1, side: i === 2 ? -1 : 1, x: 0, y: 0, ax: 0, ay: 0, x1: 0, y1: 0, x2: 0, y2: 0 });
      group.addEventListener('pointerdown', e => this.beginEditorDrag(e, i, true));
      group.addEventListener('keydown', e => this.keyEditor(e, i, true));
      overlay.appendChild(group);
    }
    for (let i = 0; i < 8; i++) {
      const group = document.createElementNS(SVG_NS, 'g');
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.classList.add('editor-control', 'editor-point');
      group.style.cssText = 'pointer-events:all;cursor:grab';
      const hit = document.createElementNS(SVG_NS, 'circle');
      hit.setAttribute('r', '22');
      hit.setAttribute('fill', 'transparent');
      const point = document.createElementNS(SVG_NS, 'circle');
      point.setAttribute('r', '6');
      point.classList.add('editor-vertex-mark');
      point.setAttribute('fill', '#fafbf6');
      point.setAttribute('stroke', 'currentColor');
      point.setAttribute('stroke-width', '2');
      point.style.pointerEvents = 'none';
      const mount = document.createElementNS(SVG_NS, 'path');
      mount.classList.add('editor-mount-mark');
      mount.setAttribute('d', 'M 0 -12 L 12 0 L 0 12 L -12 0 Z M -5 0 H 5 M 0 -5 V 5');
      const focus = document.createElementNS(SVG_NS, 'circle');
      focus.classList.add('editor-focus-ring');
      focus.setAttribute('r', '17');
      const text = document.createElementNS(SVG_NS, 'text');
      text.classList.add('editor-control-label');
      text.setAttribute('x', '11'); text.setAttribute('y', '-10');
      text.setAttribute('fill', '#173e43'); text.setAttribute('font-size', '12');
      text.setAttribute('paint-order', 'stroke'); text.setAttribute('stroke', '#fafbf6');
      text.setAttribute('stroke-width', '3');
      text.style.pointerEvents = 'none';
      const leader = document.createElementNS(SVG_NS, 'line');
      leader.classList.add('editor-point-leader');
      leader.setAttribute('stroke', 'currentColor');
      leader.setAttribute('stroke-dasharray', '3 3');
      leader.style.pointerEvents = 'none';
      group.append(hit, point, mount, focus, text);
      const handle = { group, leader, index: i < 4 ? i : i - 3, side: i < 4 ? 1 : -1, x: 0, y: 0, ax: 0, ay: 0 };
      this.editorHandles.push(handle);
      group.addEventListener('pointerdown', e => this.beginEditorDrag(e, i));
      group.addEventListener('keydown', e => this.keyEditor(e, i));
      overlay.append(group, leader);
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
    if (!key || key === 'fuselage' || key === 'propulsion') return out.set(0, 0, 0);
    const wing = this.definition[key], point = wing.points[index], origin = wingOrigin(this.definition, key);
    const vertical = key === 'verticalTail';
    const incidence = (key === 'mainWing' ? this.definition.assembly.mainIncidence : key === 'horizontalTail' ? this.definition.assembly.tailIncidence : 0) * DEG;
    if (vertical) out.set(origin.x - point.x, origin.y + point.y, 0);
    else {
      wingLocalPoint(wing, incidence, side, -point.x, 0, point.y, out);
      out.x += origin.x; out.y += origin.y;
    }
    return out;
  }

  private editorAssemblyIndex(index: number): number {
    const key = this.editorTarget;
    if (key === 'fuselage') return index;
    if (index < 6) return -1;
    return key === 'propulsion' ? index : key === 'mainWing' ? 0 : key === 'horizontalTail' ? 1 : 2;
  }

  private assemblyEditorPoint(index: number, out: THREE.Vector3): THREE.Vector3 {
    const d = this.definition;
    if (index === 6) return out.set(d.engine.x, d.engine.y, 0);
    if (index === 7) {
      const tank = fuelTankPosition(d);
      return out.set(tank.x, tank.y, tank.z);
    }
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
    if (!key || !visible || !this.editorDirty) return;
    this.editorDirty = false;
    this.editorOverlay.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.aircraft.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const label = t(key === 'mainWing' ? '主翼' : key === 'horizontalTail' ? '副翼' : '垂直尾翼');
    const wingMount = key !== 'fuselage' && key !== 'propulsion' ? this.editorHandles[6] : undefined;
    for (let i = 0; i < this.editorHandles.length; i++) {
      const handle = this.editorHandles[i];
      const show = key === 'fuselage' ? i >= 3 && i <= 5 : key === 'propulsion' ? i >= 6 && this.definition.engine.count > 0 && (i === 6 || this.definition.fuelTank.capacity > 0) : i === 6 || i < (key === 'verticalTail' ? 4 : 6);
      handle.group.style.display = show ? '' : 'none';
      if (!show) { handle.leader.style.display = 'none'; continue; }
      const assemblyIndex = this.editorAssemblyIndex(i);
      handle.group.classList.toggle('editor-mount', assemblyIndex >= 0);
      handle.leader.classList.toggle('editor-mount', assemblyIndex >= 0);
      if (assemblyIndex >= 0) this.assemblyEditorPoint(assemblyIndex, this.editProjection);
      else this.wingEditorPoint(handle.index, handle.side, this.editProjection);
      this.body.localToWorld(this.editProjection).project(this.camera);
      const ax = (this.editProjection.x + 1) * this.width / 2, ay = (1 - this.editProjection.y) * this.height / 2;
      // Preserve the layout offset; tiny anchor changes must not restart collision placement.
      if (handle === wingMount) { handle.x = clamp(ax, 24, this.width - 24); handle.y = clamp(ay, 64, this.height - 24); }
      else { handle.x += ax - handle.ax; handle.y += ay - handle.ay; }
      handle.ax = ax; handle.ay = ay;
      handle.leader.style.display = 'none';
      handle.group.setAttribute('transform', `translate(${handle.x} ${handle.y})`);
      const name = assemblyIndex >= 0 ? t(['主翼位置', '副翼位置', '垂直尾翼位置', '驾驶舱位置', '机头端点', '机尾端点', '引擎位置', '油箱位置'][assemblyIndex]) : t('{wing}{side}顶点{index}', { wing: label, side: handle.side < 0 ? t('左翼') : '', index: handle.index + 1 });
      handle.group.setAttribute('aria-label', name);
      handle.group.setAttribute('data-handle', String(i));
      handle.group.querySelector('text')!.textContent = assemblyIndex >= 0 ? t(['主翼安装', '副翼安装', '垂尾安装', '驾驶舱位置', '机头端点', '机尾端点', '引擎位置', '油箱位置'][assemblyIndex]) : String(handle.index + 1);
    }
    for (let i = 0; i < this.editorSegments.length; i++) {
      const segment = this.editorSegments[i];
      const show = key !== 'fuselage' && key !== 'propulsion' && (key !== 'verticalTail' || segment.side > 0);
      segment.group.style.display = show ? '' : 'none';
      if (!show) continue;
      const first = this.editorHandles[segment.side < 0 ? 4 : segment.index];
      const last = this.editorHandles[segment.side < 0 ? 5 : segment.index === 0 ? 3 : 2];
      segment.x1 = first.ax; segment.y1 = first.ay;
      segment.x2 = last.ax; segment.y2 = last.ay;
      const id = segment.index === 0 ? '14' : '23';
      segment.group.setAttribute('data-segment', id);
      segment.group.setAttribute('data-side', String(segment.side));
      const side = key === 'verticalTail' ? '' : t(segment.side > 0 ? '右翼' : '左翼');
      segment.group.setAttribute('aria-label', t('{wing}{chord}', { wing: label, chord: segment.index === 0 ? t('根弦线段1–4') : t('{side}梢弦线段2–3', { side }) }));
      for (const line of Array.from(segment.group.children).slice(0, 2)) {
        line.setAttribute('x1', String(segment.x1)); line.setAttribute('y1', String(segment.y1));
        line.setAttribute('x2', String(segment.x2)); line.setAttribute('y2', String(segment.y2));
      }
      // Choose the outside from projected geometry, not world-side signs.
      const mx = (segment.x1 + segment.x2) / 2, my = (segment.y1 + segment.y2) / 2;
      const oppositeFirst = this.editorHandles[segment.index === 0 ? 1 : 0];
      const oppositeLast = this.editorHandles[segment.index === 0 ? 2 : 3];
      const outwardX = mx - (oppositeFirst.ax + oppositeLast.ax) / 2;
      const outwardY = my - (oppositeFirst.ay + oppositeLast.ay) / 2;
      const dx = segment.x2 - segment.x1, dy = segment.y2 - segment.y1;
      const length = Math.hypot(dx, dy), outwardLength = Math.hypot(outwardX, outwardY);
      let nx = length > 1 ? dy / length : outwardLength > 1 ? outwardX / outwardLength : 0;
      let ny = length > 1 ? -dx / length : outwardLength > 1 ? outwardY / outwardLength : segment.index === 0 ? -1 : 1;
      if (nx * outwardX + ny * outwardY < 0) { nx = -nx; ny = -ny; }
      const desiredX = mx + nx * 52, desiredY = my + ny * 52;
      segment.x += desiredX - segment.ax; segment.y += desiredY - segment.ay;
      segment.ax = desiredX; segment.ay = desiredY;
      const fits = (x: number, y: number, gap = 52) => x >= 24 && x <= this.width - 24 && y >= 64 && y <= this.height - 24
        && (!wingMount || Math.hypot(wingMount.x - x, wingMount.y - y) >= 52 - 1e-6)
        && !this.editorSegments.some((other, index) => index < i && other.group.style.display !== 'none' && Math.hypot(other.x - x, other.y - y) < gap - 1e-6);
      // A small clearance margin prevents jitter, but releases stale collision offsets.
      if (fits(desiredX, desiredY, 58)) { segment.x = desiredX; segment.y = desiredY; }
      let placed = fits(segment.x, segment.y);
      for (let radius = 0; radius <= Math.max(this.width, this.height) && !placed; radius += 26) {
        for (let step = 0; step < 16; step++) {
          const angle = Math.atan2(ny, nx) + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * Math.PI / 8;
          const x = desiredX + Math.cos(angle) * radius;
          const y = desiredY + Math.sin(angle) * radius;
          if (!fits(x, y)) continue;
          segment.x = x; segment.y = y; placed = true; break;
        }
      }
      const leader = segment.group.children[2];
      leader.setAttribute('x1', String((segment.x1 + segment.x2) / 2));
      leader.setAttribute('y1', String((segment.y1 + segment.y2) / 2));
      leader.setAttribute('x2', String(segment.x)); leader.setAttribute('y2', String(segment.y));
      for (const circle of segment.group.querySelectorAll('circle')) {
        circle.setAttribute('cx', String(segment.x)); circle.setAttribute('cy', String(segment.y));
      }
      const text = segment.group.querySelector('text')!;
      text.textContent = t(segment.index === 0 ? '根弦 1–4' : '梢弦 2–3');
      const labelOnLeft = segment.x > this.width / 2;
      text.setAttribute('text-anchor', labelOnLeft ? 'end' : 'start');
      text.setAttribute('x', String(segment.x + (labelOnLeft ? -15 : 15))); text.setAttribute('y', String(segment.y + 4));
    }
    {
      const handles = this.editorHandles.filter(h => h.group.style.display !== 'none');
      const occupied = this.editorSegments.filter(s => s.group.style.display !== 'none').map(s => ({ x: s.x, y: s.y }));
      for (const handle of handles) {
        // Occupancy uses immutable screen positions, never mutable geometry anchors.
        const fits = (x: number, y: number, gap = 52) => x >= 24 && x <= this.width - 24 && y >= 64 && y <= this.height - 24
          && !occupied.some(other => Math.hypot(other.x - x, other.y - y) < gap - 1e-6)
          && !handles.some(other => other !== handle && Math.hypot(other.ax - x, other.ay - y) < gap - 1e-6);
        if (fits(handle.ax, handle.ay, 58)) { handle.x = handle.ax; handle.y = handle.ay; }
        if (handle !== wingMount && !fits(handle.x, handle.y)) {
          const first = handles.find(other => other.index === 0);
          const last = handles.find(other => other.index === 2 && other.side === handle.side);
          const outward = first && last ? Math.atan2(handle.ay - (first.ay + last.ay) / 2, handle.ax - (first.ax + last.ax) / 2)
            : handle.index < 2 ? -Math.PI / 2 : Math.PI / 2;
          let found = false;
          for (let radius = 52; radius <= Math.max(this.width, this.height) && !found; radius += 26) {
            for (let step = 0; step < 16; step++) {
              const angle = outward + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * Math.PI / 8;
              const x = handle.ax + Math.cos(angle) * radius, y = handle.ay + Math.sin(angle) * radius;
              if (!fits(x, y)) continue;
              handle.x = x; handle.y = y; found = true; break;
            }
          }
        }
        occupied.push({ x: handle.x, y: handle.y });
        handle.group.setAttribute('transform', `translate(${handle.x} ${handle.y})`);
        handle.leader.style.display = handle.x === handle.ax && handle.y === handle.ay ? 'none' : '';
        handle.leader.setAttribute('x1', String(handle.ax)); handle.leader.setAttribute('y1', String(handle.ay));
        handle.leader.setAttribute('x2', String(handle.x)); handle.leader.setAttribute('y2', String(handle.y));
      }
    }
    for (let side = 0; side < 2; side++) {
      const polygon = this.editorPolygons[side];
      polygon.style.display = key === 'fuselage' || key === 'propulsion' || side === 1 && key === 'verticalTail' ? 'none' : '';
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
    {
      // Resolve overlapping 44px touch targets by visible geometry, not SVG paint order.
      const rect = this.renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      let nearest = 22 ** 2, vertex = -1, edge = -1;
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
          nearest = knobDistance; vertex = -1; edge = i;
        }
      }
      if (edge >= 0) { segment = true; index = edge; }
      else if (vertex >= 0) { segment = false; index = vertex; }
      else return;
    }
    this.editDefinition = clone(this.definition);
    const mount = !segment && this.editorAssemblyIndex(index) >= 0;
    const handle = segment ? this.editorSegments[index] : this.editorHandles[index];
    if (mount) this.assemblyEditorPoint(this.editorAssemblyIndex(index), this.editOrigin);
    else this.wingEditorPoint(handle.index, handle.side, this.editOrigin);
    this.body.localToWorld(this.editOrigin);
    const sideView = mount || this.editorTarget === 'fuselage' || this.editorTarget === 'verticalTail' || this.editorTarget === 'propulsion';
    const normal = this.vector.set(0, sideView ? 0 : 1, sideView ? 1 : 0);
    if (!sideView) {
      const key = this.editorTarget as 'mainWing' | 'horizontalTail';
      const incidence = (key === 'mainWing' ? this.definition.assembly.mainIncidence : this.definition.assembly.tailIncidence) * DEG;
      wingLocalPoint(this.definition[key], incidence, handle.side, 0, 1, 0, normal);
    }
    normal.applyQuaternion(this.body.getWorldQuaternion(this.deformationRotation));
    this.camera.getWorldDirection(this.vector2);
    if (Math.abs(normal.dot(this.vector2)) < 0.15) normal.copy(this.vector2);
    this.editPlane.setFromNormalAndCoplanarPoint(normal, this.editOrigin);
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
    const assemblyIndex = this.editorSegmentDrag < 0 ? this.editorAssemblyIndex(this.editorDrag) : -1;
    if (assemblyIndex >= 0) this.changeAssembly(assemblyIndex, this.editPoint.x - this.editStart.x, this.editPoint.y - this.editStart.y);
    else if (key !== 'fuselage' && key !== 'propulsion') {
      const base = this.editDefinition!;
      const incidence = (key === 'mainWing' ? base.assembly.mainIncidence : key === 'horizontalTail' ? base.assembly.tailIncidence : 0) * DEG;
      const point = base[key].points[handle.index];
      const dx = this.editPoint.x - this.editStart.x, dy = this.editPoint.y - this.editStart.y, dz = this.editPoint.z - this.editStart.z;
      const localX = key === 'verticalTail' ? dx : dx * Math.cos(incidence) + dy * Math.sin(incidence);
      const localHeight = -dx * Math.sin(incidence) + dy * Math.cos(incidence);
      let span = point.y + (key === 'verticalTail' ? dy
        : dz * handle.side * Math.cos(base[key].dihedral * DEG) + localHeight * Math.sin(base[key].dihedral * DEG));
      let x = point.x - localX;
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
    const amount = event.shiftKey ? 0.1 : 0.01;
    const horizontal = event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0;
    const vertical = event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0;
    const key = this.editorTarget;
    const assemblyIndex = segment ? -1 : this.editorAssemblyIndex(index);
    if (assemblyIndex >= 0) this.changeAssembly(assemblyIndex, horizontal, vertical);
    else if (key !== 'fuselage' && key !== 'propulsion') {
      const handle = segment ? this.editorSegments[index] : this.editorHandles[index];
      const p = this.definition[key].points[handle.index];
      let x = p.x - (key === 'verticalTail' ? horizontal : vertical);
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
    let best = Math.round(value * 100) / 100, distance = Math.abs(best - value);
    let kind: 'grid' | 'vertex' = 'grid';
    const key = this.editorTarget;
    if (key && key !== 'fuselage' && key !== 'propulsion') {
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
    if (!key || key === 'fuselage' || key === 'propulsion') return;
    const next = clone(this.editDefinition ?? this.definition), p = next[key].points;
    const last = index === 0 ? 3 : 2;
    let delta = Math.round((x - p[index].x) * 100) / 100;
    delta = clamp(delta, -3 - Math.min(p[index].x, p[last].x), 6 - Math.max(p[index].x, p[last].x));
    if (index === 0 && !(key === 'horizontalTail' && next.assembly.tailOnFin)) {
      const limits = wingMountLimits(next, key);
      const c = Math.cos((key === 'mainWing' ? next.assembly.mainIncidence : key === 'horizontalTail' ? next.assembly.tailIncidence : 0) * DEG);
      delta = clamp(delta, (next.assembly[key] - limits.max) / c, (next.assembly[key] - limits.min) / c);
    }
    if (next[key].rootReference === undefined) next[key].rootReference = (p[0].x + p[3].x) / 2;
    const firstX = p[index].x + delta, lastX = p[last].x + delta;
    // Shift both chord ends together; point edits use the same stable origin.
    if (key === 'horizontalTail' && next.assembly.tailOnFin && index === 0) {
      next.verticalTail.points[1].x = firstX; next.verticalTail.points[2].x = lastX;
    } else {
      p[index].x = firstX; p[last].x = lastX;
      if (index === 1) editWingPoint(next, key, 1, firstX, span);
    }
    normalizeAircraftGeometry(next);
    this.editorChange?.(next);
  }

  private changeWing(index: number, x: number, span: number): void {
    const key = this.editorTarget;
    if (!key || key === 'fuselage' || key === 'propulsion') return;
    const next = clone(this.editDefinition ?? this.definition);
    editWingPoint(next, key, index, x, span);
    this.editorChange?.(next);
  }

  private changeAssembly(index: number, x: number, y: number): void {
    const next = clone(this.editDefinition ?? this.definition);
    x = Math.round(x * 100) / 100; y = Math.round(y * 100) / 100;
    const ends = fuselageEnds(next);
    if (index === 0) {
      const limits = mainWingMountLimits(next);
      next.assembly.mainWing = clamp(next.assembly.mainWing + x, limits.min, limits.max);
      next.assembly.mainWingHeight = clamp(this.snapMountHeight(next.assembly.mainWingHeight + y), -0.5, 1);
    } else if (index === 1) {
      const base = this.editDefinition ?? this.definition, origin = wingOrigin(base, 'horizontalTail');
      const middle = (base.horizontalTail.points[0].x + base.horizontalTail.points[3].x) / 2;
      const cx = origin.x - middle * Math.cos(base.assembly.tailIncidence * DEG) + x;
      const cy = origin.y - middle * Math.sin(base.assembly.tailIncidence * DEG) + y;
      const fin = wingOrigin(next, 'verticalTail'), tip = next.verticalTail.points;
      const fx = fin.x - (tip[1].x + tip[2].x) / 2, fy = tip[1].y;
      const tolerance = Math.max(0.3, this.mountSnapTolerance() * 6);
      const attach = !this.editorSnap.disabled && Math.hypot(cx - fx, cy - fy) <= tolerance;
      if (attach) {
        next.assembly.tailOnFin = true;
        this.editorSnap.active = true; this.editorSnap.kind = 'mount'; this.editorSnap.value = fy;
      } else {
        next.assembly.tailOnFin = false;
        const limits = wingMountLimits(next, 'horizontalTail');
        const reference = next.horizontalTail.rootReference ?? middle;
        next.assembly.horizontalTail = clamp(cx + (middle - reference) * Math.cos(next.assembly.tailIncidence * DEG), limits.min, limits.max);
      }
    } else if (index === 2) {
      const limits = wingMountLimits(next, 'verticalTail');
      next.assembly.verticalTail = clamp(next.assembly.verticalTail + x, limits.min, limits.max);
    } else if (index === 3) {
      const limits = cockpitLimits(next);
      next.cockpit.position = clamp(next.cockpit.position + x, limits.min, limits.max);
    }
    else if (index === 6) {
      next.engine.x = clamp(next.engine.x + x, ends.tail, ends.nose);
      next.engine.y = normalizeEngineHeight(next, next.engine.y + y);
    } else if (index === 7) {
      const limits = fuelTankLimits(next);
      next.fuelTank.x = clamp(next.fuelTank.x + x, limits.min, limits.max);
    } else resizeFuselage(next, index === 4 ? 'nose' : 'tail', (index === 4 ? ends.nose : ends.tail) + x);
    normalizeAircraftGeometry(next);
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
    if (key === 'fuselage') return Math.max(2.3, this.definition.fuselage.length / (2 * aspect * 0.8), Math.abs(this.definition.verticalTail.points[1].y) + 0.7);
    const wing = this.definition[key], p = wing.points;
    const chord = Math.max(p[2].x, p[3].x) - Math.min(p[0].x, p[1].x);
    const horizontal = key === 'verticalTail' ? chord / 2 : p[1].y;
    const vertical = key === 'verticalTail' ? Math.abs(p[1].y) / 2 : chord / 2;
    return Math.max(2.3, horizontal / (aspect * (this.width <= 700 ? 0.72 : 0.62)), vertical / (this.width <= 700 ? 0.32 : 0.62));
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
    this.clearFragments();
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
        const orange = moving || i === 0 && Math.abs(position.getZ(vertex)) > span * 0.82;
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
    this.updateCockpitShell();
    this.pilot.visible = d.birdman;
    this.cockpit.visible = !d.birdman;
    this.updatePropulsionGeometry();
    this.cg.visible = !this.simulation || this.debug;
    if (!this.simulation) {
      this.positionAtLaunch();
      this.aircraft.rotation.set(0, 0, this.editorTarget ? 0 : -LAUNCH.slope);
      this.driver.position.set(0, 0, 0);
    }
    this.syncWingPhysics();
    this.updateControlSurfaces();
    this.updateCenters();
    if (this.hoverTarget) this.setHoveredPart(this.hoverTarget);
    this.metrics.geometryMs = performance.now() - start;
  }

  private updateCockpitShell(): void {
    const shell = this.cockpit.getObjectByName('streamlined-cockpit-shell') as THREE.Mesh;
    const geometry = shell.geometry, positions = geometry.getAttribute('position');
    const rearLength = this.definition.cockpit.rearLength ?? BODY_GEOMETRY.shell.xRadius;
    if (geometry.userData.rearLength === rearLength) return;
    const original = geometry.userData.originalPositions ??= new Float32Array(positions.array);
    const ratio = rearLength / BODY_GEOMETRY.shell.xRadius;
    for (let i = 0; i < positions.count; i++) {
      const x = original[i * 3];
      positions.setX(i, x < 0 ? x * ratio : x);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.userData.rearLength = rearLength;
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
    // Common low dashboard, with no canopy or design-dependent wing obstruction.
    this.aircraft.add(this.pilotInterior);
    this.pilotInterior.name = 'pilot-interior';
    const dashboard = this.mesh(new THREE.BoxGeometry(0.35, 0.12, 1.1), graphite, this.pilotInterior);
    dashboard.position.set(1.8, -0.1, 0);
    this.pilotInterior.visible = false;
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
    this.beam = this.mesh(new THREE.CylinderGeometry(0.05, BODY_GEOMETRY.beamRadius, 1, 24), ivory, this.body);
    this.beam.rotation.z = Math.PI / 2;
    this.support = this.mesh(new THREE.BoxGeometry(1, 1, 0.06), graphite, this.body);
    this.support.name = 'main-wing-support';
    this.support.matrixAutoUpdate = false;
    this.support.visible = false;
    this.nose = this.mesh(new THREE.SphereGeometry(0.22, 10, 7), orange, this.body);
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
    this.body.userData.editorTarget = 'fuselage';
    for (let i = 0; i < this.wingMeshes.length; i++) this.wingMeshes[i].userData.editorTarget = ['mainWing', 'horizontalTail', 'verticalTail'][i];
    this.support.userData.editorTarget = 'mainWing';
    for (const engine of this.engines) engine.userData.editorTarget = 'propulsion';
    for (const support of this.engineSupports) support.userData.editorTarget = 'propulsion';
    this.fuelTank.userData.editorTarget = 'propulsion';
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
    this.designThrustCenter.set(0, 0, 0);
    for (let index = 0; index < this.engines.length; index++) {
      const group = this.engines[index], support = this.engineSupports[index], mount = mounts[index];
      group.visible = !!mount;
      support.visible = !!mount && mount.supportLength > 0;
      if (!mount) continue;
      group.position.set(mount.x, mount.y, mount.z);
      this.designThrustCenter.add(group.position);
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
    // All installed engines receive equal thrust along body +X in the physics model.
    if (mounts.length) this.designThrustCenter.divideScalar(mounts.length);
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

  markCrash(stroke: () => void): void {
    const sim = this.simulation;
    if (!sim) return;
    this.crashAge = 0; this.crashSecond = false; this.crashStroke = stroke;
    this.crashMark.position.copy(sim.groundImpactPoint);
    if (!this.crashMark.children.length) {
      for (const side of [-1, 1]) {
        const points: number[] = [];
        for (let i = 0; i <= 64; i++) {
          const x = -3 + i * 6 / 64, z = x * side;
          const y = challengeTerrainHeight(sim.challenge, this.crashMark.position.x + x, this.crashMark.position.z + z) - this.crashMark.position.y + 0.15;
          points.push(x, y, z);
        }
        const geometry = new LineGeometry().setPositions(points);
        geometry.instanceCount = 0;
        const line = new Line2(geometry, new LineMaterial({color:0xe32636,linewidth:12,worldUnits:false,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1}));
        line.material.resolution.set(this.width, this.height);
        this.crashMark.add(line);
      }
      this.scene.add(this.crashMark);
    }
    this.crashMark.visible = true;
  }

  setFlight(sim: FlightSimulation | null, reuseAircraft = false): void {
    this.crashMark.visible = false; this.crashAge = -1; this.crashStroke = null;
    for (const child of [...this.crashMark.children]) {const mesh=child as THREE.Mesh;mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();this.crashMark.remove(child);}

    this.resultOrbit = false;
    this.endEditorDrag();
    this.editorDirty = true;
    this.simulation = sim;
    if (sim && !reuseAircraft) this.updateAircraft(sim.definition);
    this.applyAircraft();
    this.headOffset.set(0, 0, 0);
    this.headTime = sim?.elapsedTime ?? 0;
    this.body.visible = true;
    this.pilotInterior.visible = false;
    this.clearFragments();
    this.syncWingPhysics();
    this.renderBlend = 1;
    this.wingAngles.fill(NaN);
    this.setEnvironmentChallenge(sim?.challenge ?? 'birdman');
    this.railReferenceCG.copy(sim?.telemetry.cg ?? this.designCG);
    this.railReferenceHeight = sim?.challenge === 'low-altitude' ? sim.position.y - sim.railAttachmentHeight : 0;
    this.railLastAttachedX = challengeLaunch('low-altitude')!.startX;
    this.captureFlightState();
    this.trailCount = this.trailIndex = 0;
    this.trailClock = 0;
    this.trailGeometry.setDrawRange(0, 0);
    this.clearWingTrail();
    this.updateEnvironment();
    this.updateChallengeGates();
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
    this.updateCatapult();
    this.updateCenters();
    this.metrics.memory = this.geometryMemory();
  }

  /** Controller look shares the drag offsets and idle return of the flight camera. */
  lookInput(horizontal: number, vertical: number, dt: number): void {
    if (!this.simulation || (!horizontal && !vertical)) return;
    const yaw = horizontal * dt * 1.8, pitch = vertical * dt * 1.8;
    this.cameraReleasedAt = this.elapsed;
    if (this.controls.enabled) {
      this.vector.subVectors(this.camera.position, this.controls.target);
      const radius = this.vector.length();
      this.spherical.setFromVector3(this.vector);
      this.spherical.theta -= yaw;
      this.spherical.phi = clamp(this.spherical.phi + pitch, 0.05, Math.PI * 0.94);
      this.vector.setFromSpherical(this.spherical).setLength(radius);
      this.camera.position.copy(this.controls.target).add(this.vector);
      this.controls.update();
    } else {
      this.cameraYaw -= yaw;
      const limit = this.view === 'locked' && !this.resultOrbit ? 0.12 : 1.35;
      this.cameraPitch = clamp(this.cameraPitch - pitch, -limit, limit);
      if (this.view === 'locked' && !this.resultOrbit) this.cameraYaw = clamp(this.cameraYaw, -0.18, 0.18);
    }
  }

  cameraView(name: string): void {
    this.restoreCameraClearance();
    const names: Record<string, string> = { '俯视': 'top', '侧视': 'side', '正视': 'front', '后视': 'rear', '追尾': 'chase', '锁定': 'locked', '侧追尾': 'legacy-chase', '侧面': 'flight-side', '驾驶员': 'pilot', '自由': 'free', '自由镜头': 'free', '轨道': 'orbit', '三维': 'orbit', 'perspective': 'orbit', 'cockpit': 'pilot', 'follow': 'chase', 'back': 'rear' };
    this.view = names[name] ?? name;
    this.cameraYaw = this.cameraPitch = 0;
    this.followInitialized = false;
    this.cameraDragging = false;
    this.cameraReleasedAt = -Infinity;
    if (this.cameraPointer >= 0 && this.renderer.domElement.hasPointerCapture(this.cameraPointer)) this.renderer.domElement.releasePointerCapture(this.cameraPointer);
    this.cameraPointer = -1;
    const orthographic = ['top', 'side', 'front', 'rear'].includes(this.view);
    this.camera = orthographic ? this.orthographic : this.perspective;
    this.controls.object = this.camera;
    this.controls.enabled = !this.simulation || this.view === 'free' || this.view === 'orbit' || orthographic;
    this.controls.enableRotate = true;
    this.controls.enableDamping = this.view !== 'locked';
    this.target.copy(this.aircraft.position);
    if (this.editorTarget && this.editorTarget !== 'fuselage' && this.editorTarget !== 'propulsion' && !this.simulation) {
      const key = this.editorTarget, wing = this.definition[key], origin = wingOrigin(this.definition, key);
      const incidence = (key === 'mainWing' ? this.definition.assembly.mainIncidence : key === 'horizontalTail' ? this.definition.assembly.tailIncidence : 0) * DEG;
      const chord = (wing.points[0].x + wing.points[1].x + wing.points[2].x + wing.points[3].x) / 4;
      if (key === 'verticalTail') this.vector.set(-chord, wing.points[1].y / 2, 0);
      else wingLocalPoint(wing, incidence, 1, -chord, 0, wing.points[1].y / 2, this.vector);
      this.target.x += origin.x + this.vector.x - this.designCG.x;
      this.target.y += origin.y + this.vector.y - this.designCG.y;
    } else if (this.editorTarget === 'fuselage' && !this.simulation) {
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
    this.refreshControlsUp();
    this.orthographic.zoom = 1;
    this.resize();
    this.editorDirty = true;
    this.controls.update();
    if (this.simulation && (!this.controls.enabled || this.view === 'free')) this.followCamera(1, true);
    this.cameraHome.copy(this.camera.position);
    this.targetHome.copy(this.controls.target);
    if (orthographic && !this.simulation) {
      this.designOrbitRotation.copy(this.camera.quaternion);
    }
    this.constrainCamera();
    if (!this.simulation) this.onDesignViewChange?.(this.view);
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
    this.debugGroup.traverse(object => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      object.renderOrder = 100;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) { material.depthTest=false;material.depthWrite=false;material.transparent=true;material.fog=false;material.needsUpdate=true; }
    });
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
    if (sim.challenge === 'low-altitude' && sim.launching) {
      this.railLastAttachedX = sim.railPositionX;
    }
    for (const sections of this.wingSections) {
      for (const section of sections) {
        const physical = section.physics;
        if (!physical) continue;
        section.previousBodyId = physical.bodyId;
        section.previousRoot.copy(physical.root.position);
        section.previousTip.copy(physical.tip.position);
        section.previousRootRotation.copy(physical.root.quaternion);
        section.previousTipRotation.copy(physical.tip.quaternion);
      }
    }
    for (const fragment of this.fragments) {
      const body = sim.fragments.find(body => body.id === fragment.id);
      if (!body) continue;
      fragment.previousPosition.copy(body.position);
      fragment.previousQuaternion.copy(body.quaternion);
      fragment.previousCG.copy(body.cg);
      fragment.captured = true;
    }
  }

  render(dt: number, alpha = 1): void {
    if (this.disposed) return;
    const start = performance.now();
    this.restoreCameraClearance();
    this.applyAircraft();
    const seconds = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
    this.elapsed += seconds;
    this.waterTime.value = this.reducedMotion ? 0 : this.elapsed;
    const sim = this.simulation;
    if (sim) {
      const blend = sim.ended || sim.replayFinished ? 1 : clamp(alpha, 0, 1);
      this.renderBlend = blend;
      this.aircraft.position.lerpVectors(this.previousPosition, sim.position, blend);
      this.aircraft.quaternion.slerpQuaternions(this.previousQuaternion, sim.quaternion, blend);
      this.renderCG.lerpVectors(this.previousCG, sim.telemetry.cg, blend);
      this.body.position.copy(this.renderCG).negate();
      this.driver.position.set(sim.pilotOffset.x, 0, sim.pilotOffset.z);
      this.updateControlSurfaces();
      this.followCamera(seconds, false);
      if (!isLaboratory(sim.challenge)) { this.recordTrail(seconds); this.recordWingTrail(); }
      this.updateDebug();
      const inWater = sim.telemetry.waterContact || sim.result?.landing === 'water';
      if (inWater && !this.wasInWater) this.beginSplash(sim.telemetry.waterContact ? sim.telemetry.waterContactPoint : sim.position);
      this.wasInWater = inWater;
    }
    if (!sim && this.editorTarget) this.workshop.position.copy(this.aircraft.position).sub(this.designCG);
    if (this.crashAge >= 0) {
      const previous = this.crashAge; this.crashAge += seconds;
      if (previous < 0.4 && this.crashAge >= 0.4) this.crashStroke?.();
      if (!this.crashSecond && this.crashAge >= 0.8) {this.crashSecond=true;this.crashStroke?.();}
      this.crashMark.children.forEach((child,index)=>(child as Line2).geometry.instanceCount=Math.floor(clamp((this.crashAge-0.4-index*0.4)/0.32,0,1)*64));
    }
    this.updateChallengeGates();
    this.updateExhaust();
    if (this.splashAge >= 0) this.updateSplash(seconds);
    if (this.controls.enabled) this.controls.update();
    this.updateCameraInteraction(seconds);
    this.constrainCamera();
    const interior = !!sim && !sim.ended && this.view === 'pilot';
    this.body.visible = !interior;
    this.pilotInterior.visible = interior;
    this.pilotInterior.position.copy(this.body.position);
    this.pilotInterior.position.x += this.definition.cockpit.position;
    this.updateCenters();
    this.updateFuelCgRange();
    this.updateEditorOverlay();
    this.updateLight();
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
    this.endEditorDrag(true);
    this.selectionPointer = -1; this.selectionTarget = null;
    this.resizeObserver.disconnect();
    this.layoutObserver.disconnect();
    window.removeEventListener('blur', this.cancelEditorDrag);
    this.unsubscribeLanguage();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('pointerdown', this.beginPartSelection, true);
    this.renderer.domElement.removeEventListener('pointermove', this.movePartSelection);
    this.renderer.domElement.removeEventListener('pointerup', this.endPartSelection, true);
    this.renderer.domElement.removeEventListener('pointercancel', this.cancelPartSelection);
    this.renderer.domElement.removeEventListener('lostpointercapture', this.cancelPartSelection);
    this.renderer.domElement.removeEventListener('pointerleave', this.leavePartSelection);
    this.onEditorSelect = this.onDesignViewChange = null;
    this.editorOverlay.remove();
    for (const geometry of this.wingNormalGeometry) geometry.dispose();
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

  private updateLight(): void {
    this.light.target.position.copy(this.aircraft.position);
    this.light.position.copy(this.aircraft.position).add(this.vector.set(-55, 110, 65));
    // Follow the aircraft, but retain its ground receiver along the same light ray.
    const far = this.environmentChallenge === 'test-space'
      ? Math.max(230, this.vector.length() * (1 + Math.max(0, this.aircraft.position.y) / 110) + 20) : 230;
    const camera = this.light.shadow.camera;
    if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    this.light.shadow.bias = -0.0805 / far;
  }

  private placeStrut(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
    const length = a.distanceTo(b);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.scale.set(radius, length, radius);
    mesh.quaternion.setFromUnitVectors(UP, this.desiredPosition.copy(b).sub(a).normalize());
  }

  /** 结构边界独立顶点；段内 0.2 m 显示细分，断口使用独立封口顶点。 */
  private wingGeometry(wing: Wing, rootX: number, height: number, incidence: number, index: number): THREE.BufferGeometry {
    const vertices: number[] = [], indices: number[] = [], hinges: number[] = [], movable: number[] = [];
    const sections = this.wingSections[index];
    sections.length = 0;
    const vertical = index === 2, fraction = wing.controlSurface, hingeFraction = 1 - fraction;
    const profileCount = 32, chordSteps = 16;
    const angle = incidence * DEG;
    const point = new THREE.Vector3(), hinge = new THREE.Vector3();
    const halfSpan = Math.abs(wing.points[1].y), spanSign = vertical ? Math.sign(wing.points[1].y) : 1;
    const rootChord = wing.points[3].x - wing.points[0].x, tipChord = wing.points[2].x - wing.points[1].x;
    const rootHinge = -wing.points[0].x - hingeFraction * rootChord;
    const tipHinge = -wing.points[1].x - hingeFraction * tipChord;
    const axes: THREE.Vector3[] = [];
    for (const side of vertical ? [1] : [-1, 1]) {
      axes.push(vertical ? (fraction === 1 ? new THREE.Vector3(0, spanSign, 0) : new THREE.Vector3(tipHinge - rootHinge, spanSign * halfSpan, 0).normalize())
        : wingLocalPoint(wing, angle, side, tipHinge - rootHinge, 0, halfSpan, new THREE.Vector3()).normalize());
      let previous: WingRenderSection | null = null;
      for (let start = 0; start < halfSpan - 1e-10; start += SURFACE_STEP) {
        const end = Math.min(start + SURFACE_STEP, halfSpan), rows = Math.max(1, Math.ceil((end - start) / 0.2));
        const section: WingRenderSection = {
          wingIndex: index, side, spanStart: start, spanEnd: end, vertexStart: vertices.length / 3, rows,
          rootCap: 0, tipCap: 0, skin: [], rootIndices: [], tipIndices: [], previous, next: null,
          physics: null, bodyId: 0, previousBodyId: -1,
          previousRoot: new THREE.Vector3(), previousTip: new THREE.Vector3(),
          previousRootRotation: new THREE.Quaternion(), previousTipRotation: new THREE.Quaternion(),
          root: new THREE.Vector3(), tip: new THREE.Vector3(),
          rootRotation: new THREE.Quaternion(), tipRotation: new THREE.Quaternion(),
          referenceRoot: new THREE.Vector3(), referenceTip: new THREE.Vector3(),
        };
        if (previous) previous.next = section;
        previous = section;
        sections.push(section);
        for (let row = 0; row <= rows; row++) {
          const span = THREE.MathUtils.lerp(start, end, row / rows), t = span / halfSpan;
          const leading = THREE.MathUtils.lerp(wing.points[0].x, wing.points[1].x, t);
          const trailing = THREE.MathUtils.lerp(wing.points[3].x, wing.points[2].x, t), chord = trailing - leading;
          const hingeX = -leading - hingeFraction * chord;
          const hingeY = vertical ? 0 : 0.018 * chord * Math.sin(Math.PI * hingeFraction);
          if (vertical) hinge.set(rootX + (fraction === 1 ? -wing.points[0].x - rootChord * 0.25 : hingeX), height + spanSign * span, 0);
          else {
            wingLocalPoint(wing, angle, side, hingeX, hingeY, span, hinge);
            hinge.x += rootX; hinge.y += height;
          }
          if (row === 0 || row === rows) {
            const reference = row === 0 ? section.referenceRoot : section.referenceTip;
            const quarter = -leading - chord * 0.25;
            if (vertical) reference.set(rootX + quarter, height + spanSign * span, 0);
            else {
              wingLocalPoint(wing, angle, side, quarter, 0, span, reference);
              reference.x += rootX; reference.y += height;
            }
          }
          for (let k = 0; k < profileCount; k++) {
            const upper = k <= chordSteps, j = upper ? k : profileCount - k;
            const u = fraction > 0 && fraction < 1
              ? j <= 12 ? hingeFraction * (1 - Math.cos(j / 12 * Math.PI)) / 2
                : hingeFraction + fraction * (1 - Math.cos((j - 12) / 4 * Math.PI)) / 2
              : (1 - Math.cos(j / chordSteps * Math.PI)) / 2;
            const thickness = 5 * 0.105 * chord * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
            const camber = vertical ? 0 : 0.018 * chord * Math.sin(Math.PI * u);
            const x = -leading - u * chord, y = camber + (upper ? thickness : -thickness);
            if (vertical) vertices.push(rootX + x, height + spanSign * span, y);
            else {
              wingLocalPoint(wing, angle, side, x, y, span, point);
              vertices.push(rootX + point.x, height + point.y, point.z);
            }
            hinges.push(hinge.x, hinge.y, hinge.z);
            movable.push(fraction > 0 && u >= hingeFraction ? 1 : 0);
          }
        }
        for (let row = 0; row < rows; row++) {
          for (let k = 0; k < profileCount; k++) {
            const a = section.vertexStart + row * profileCount + k, b = section.vertexStart + row * profileCount + (k + 1) % profileCount;
            if (vertical ? spanSign > 0 : side < 0) section.skin.push(a, b + profileCount, b, a, a + profileCount, b + profileCount);
            else section.skin.push(a, b, b + profileCount, a, b + profileCount, a + profileCount);
          }
        }
        for (let cap = 0; cap < 2; cap++) {
          const base = vertices.length / 3, source = section.vertexStart + (cap === 0 ? 0 : rows * profileCount);
          if (cap === 0) section.rootCap = base;
          else section.tipCap = base;
          for (let k = 0; k < profileCount; k++) {
            const offset = (source + k) * 3;
            vertices.push(vertices[offset], vertices[offset + 1], vertices[offset + 2]);
            hinges.push(hinges[offset], hinges[offset + 1], hinges[offset + 2]);
            movable.push(movable[source + k]);
          }
          const capIndices = cap === 0 ? section.rootIndices : section.tipIndices;
          for (let k = 1; k < profileCount - 1; k++) {
            const reverse = (cap === 0) !== (vertical ? spanSign > 0 : side < 0);
            if (reverse) capIndices.push(base, base + k, base + k + 1);
            else capIndices.push(base, base + k + 1, base + k);
          }
        }
        indices.push(...section.skin, ...section.rootIndices, ...section.tipIndices);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertices.length), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices.length), 1).setUsage(THREE.DynamicDrawUsage));
    this.wingNormalGeometry[index]?.dispose();
    const normalGeometry = new THREE.BufferGeometry();
    normalGeometry.setAttribute('position', geometry.getAttribute('position'));
    normalGeometry.setAttribute('normal', geometry.getAttribute('normal'));
    normalGeometry.setIndex(indices);
    this.wingNormalGeometry[index] = normalGeometry;
    this.wingNeutral[index] = new Float32Array(vertices);
    this.wingHinges[index] = new Float32Array(hinges);
    this.wingMovable[index] = new Uint8Array(movable);
    this.wingAxes[index] = axes;
    this.hingeLines[index].geometry.dispose();
    this.hingeLines[index].geometry = new THREE.BufferGeometry()
      .setAttribute('position', geometry.getAttribute('position'))
      .setIndex(new THREE.BufferAttribute(new Uint32Array(sections.reduce((count, section) => count + section.rows * 2, 0)), 1).setUsage(THREE.DynamicDrawUsage));
    this.hingeLines[index].visible = fraction > 0 && fraction < 1;
    this.writeWingIndices(index, 0, geometry, this.hingeLines[index].geometry);
    return geometry;
  }

  private writeWingIndices(index: number, bodyId: number, geometry: THREE.BufferGeometry, hinge: THREE.BufferGeometry): void {
    const triangles = geometry.index!.array, lines = hinge.index!.array;
    let count = 0, lineCount = 0;
    for (const section of this.wingSections[index]) {
      if (section.bodyId !== bodyId) continue;
      for (const vertex of section.skin) triangles[count++] = vertex;
      if (!section.previous || section.previous.bodyId !== bodyId) {
        for (const vertex of section.rootIndices) triangles[count++] = vertex;
      }
      if (!section.next || section.next.bodyId !== bodyId) {
        for (const vertex of section.tipIndices) triangles[count++] = vertex;
      }
      for (let row = 0; row < section.rows; row++) {
        lines[lineCount++] = section.vertexStart + row * 32 + 12;
        lines[lineCount++] = section.vertexStart + (row + 1) * 32 + 12;
      }
    }
    geometry.setDrawRange(0, count);
    hinge.setDrawRange(0, lineCount);
    geometry.index!.needsUpdate = hinge.index!.needsUpdate = true;
  }

  private removeFragment(fragment: FragmentRender): void {
    for (const object of [fragment.mesh, fragment.hinge]) {
      this.scene.remove(object);
      // 顶点属性由主翼拥有；片体只释放自己的索引与VAO，不能销毁仍被主翼引用的GPU缓冲。
      for (const name in object.geometry.attributes) object.geometry.deleteAttribute(name);
      object.geometry.dispose();
    }
  }

  private clearFragments(): void {
    for (const fragment of this.fragments) this.removeFragment(fragment);
    this.fragments.length = 0;
  }

  private syncWingPhysics(): void {
    const sim = this.simulation;
    for (let index = 0; index < 3; index++) {
      const key = index === 0 ? 'mainWing' : index === 1 ? 'horizontalTail' : 'verticalTail';
      for (const section of this.wingSections[index]) {
        section.physics = sim?.structure.sections.find(physical => physical.wingKey === key && physical.side === section.side
          && Math.abs(physical.spanStart - section.spanStart) < 1e-8) ?? null;
        section.previousBodyId = -1;
      }
    }
  }

  private fragmentRender(id: number, wingIndex?: number): FragmentRender | undefined {
    for (const fragment of this.fragments) if (fragment.id === id && (wingIndex === undefined || fragment.wingIndex === wingIndex)) return fragment;
    return undefined;
  }

  private ensureFragments(): boolean {
    const sim = this.simulation;
    if (!sim) return false;
    let changed = false;
    for (let index = this.fragments.length - 1; index >= 0; index--) {
      const fragment = this.fragments[index];
      let present = false;
      for (const body of sim.fragments) if (body.id === fragment.id) { present = true; break; }
      if (present && this.wingSections[fragment.wingIndex].some(section => section.physics?.bodyId === fragment.id)) continue;
      this.removeFragment(fragment);
      this.fragments.splice(index, 1);
      changed = true;
    }
    for (const body of sim.fragments) for (let wingIndex = 0; wingIndex < 3; wingIndex++) {
      if (this.fragmentRender(body.id, wingIndex) || !this.wingSections[wingIndex].some(section => section.physics?.bodyId === body.id)) continue;
      const source = this.wingMeshes[wingIndex].geometry;
      const geometry = new THREE.BufferGeometry();
      for (const name in source.attributes) geometry.setAttribute(name, source.getAttribute(name));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(source.index!.count), 1).setUsage(THREE.DynamicDrawUsage));
      const hingeGeometry = new THREE.BufferGeometry().setAttribute('position', source.getAttribute('position'))
        .setIndex(new THREE.BufferAttribute(new Uint32Array(this.hingeLines[wingIndex].geometry.index!.count), 1).setUsage(THREE.DynamicDrawUsage));
      const mesh = this.mesh(geometry, this.aircraftMaterials.main, this.scene);
      mesh.name = `wing-fragment-${body.id}-${wingIndex}`;
      const hinge = new THREE.LineSegments(hingeGeometry, this.hingeLines[wingIndex].material);
      hinge.name = `${mesh.name}-hinge`;
      this.scene.add(hinge);
      this.fragments.push({ id: body.id, wingIndex, mesh, hinge, previousPosition: body.position.clone(),
        previousQuaternion: body.quaternion.clone(), previousCG: body.cg.clone(), cg: body.cg.clone(), captured: false });
      changed = true;
    }
    return changed;
  }

  private deformPoint(section: WingRenderSection, point: THREE.Vector3, t: number): void {
    this.deformationRotation.slerpQuaternions(section.rootRotation, section.tipRotation, t);
    this.deformationReference.lerpVectors(section.referenceRoot, section.referenceTip, t);
    point.sub(this.deformationReference).applyQuaternion(this.deformationRotation);
    this.deformationRootTangent.subVectors(section.referenceTip, section.referenceRoot).applyQuaternion(section.rootRotation);
    this.deformationTipTangent.subVectors(section.referenceTip, section.referenceRoot).applyQuaternion(section.tipRotation);
    const t2 = t * t, t3 = t2 * t;
    point.addScaledVector(section.root, 2 * t3 - 3 * t2 + 1)
      .addScaledVector(section.tip, -2 * t3 + 3 * t2)
      .addScaledVector(this.deformationRootTangent, t3 - 2 * t2 + t)
      .addScaledVector(this.deformationTipTangent, t3 - t2);
  }

  /** 舵面先在中性翼面旋转，再组合物理弹性。断片保持物理冻结舵角。 */
  private updateControlSurfaces(): void {
    const sim = this.simulation, controls = sim?.controlDeflections;
    let topologyChanged = this.ensureFragments();
    if (sim) {
      for (const fragment of this.fragments) {
        const body = sim.fragments.find(body => body.id === fragment.id);
        if (!body) continue;
        const blend = fragment.captured ? this.renderBlend : 1;
        fragment.mesh.position.lerpVectors(fragment.previousPosition, body.position, blend);
        fragment.mesh.quaternion.slerpQuaternions(fragment.previousQuaternion, body.quaternion, blend);
        fragment.cg.lerpVectors(fragment.previousCG, body.cg, blend);
        fragment.hinge.position.copy(fragment.mesh.position);
        fragment.hinge.quaternion.copy(fragment.mesh.quaternion);
      }
    }
    for (let index = 0; index < 3; index++) {
      const angle = index === 0 ? controls?.aileron ?? 0 : index === 1 ? controls?.elevator ?? 0 : controls?.rudder ?? 0;
      const sections = this.wingSections[index], geometry = this.wingMeshes[index].geometry;
      if (!sim && angle === this.wingAngles[index]) continue;
      this.wingAngles[index] = angle;
      const position = geometry.getAttribute('position') as THREE.BufferAttribute;
      const neutral = this.wingNeutral[index], hinges = this.wingHinges[index];
      for (const section of sections) {
        const physical = section.physics, bodyId = physical?.bodyId ?? 0;
        if (section.bodyId !== bodyId) topologyChanged = true;
        section.bodyId = bodyId;
        const blend = section.previousBodyId === bodyId ? this.renderBlend : 1;
        if (physical) {
          section.referenceRoot.copy(physical.referenceRoot);
          section.referenceTip.copy(physical.referenceTip);
          section.root.lerpVectors(section.previousRoot, physical.root.position, blend);
          section.tip.lerpVectors(section.previousTip, physical.tip.position, blend);
          section.rootRotation.slerpQuaternions(section.previousRootRotation, physical.root.quaternion, blend);
          section.tipRotation.slerpQuaternions(section.previousTipRotation, physical.tip.quaternion, blend);
        } else {
          section.root.copy(section.referenceRoot);
          section.tip.copy(section.referenceTip);
          section.rootRotation.identity();
          section.tipRotation.identity();
        }
        const fragment = bodyId === 0 ? undefined : this.fragmentRender(bodyId, index);
        const sideIndex = index === 2 || section.side < 0 ? 0 : 1;
        const direction = index === 0 ? -1 : index === 1 ? -section.side : 1;
        this.deformationAxis.copy(this.wingAxes[index][sideIndex]);
        this.controlRotation.setFromAxisAngle(this.deformationAxis, physical?.controlDeflection ?? angle * direction);
        const count = (section.rows + 1) * 32;
        let previousT = -1;
        for (let local = 0; local < count + 64; local++) {
          const vertex = local < count ? section.vertexStart + local
            : local < count + 32 ? section.rootCap + local - count : section.tipCap + local - count - 32;
          const t = local < count ? Math.floor(local / 32) / section.rows : local < count + 32 ? 0 : 1;
          if (t !== previousT) {
            this.deformationCenter.lerpVectors(section.referenceRoot, section.referenceTip, t);
            this.deformPoint(section, this.deformationCenter, t);
            previousT = t;
          }
          this.deformationPoint.fromArray(neutral, vertex * 3);
          if (this.wingMovable[index][vertex]) {
            this.deformationHinge.fromArray(hinges, vertex * 3);
            this.deformationPoint.sub(this.deformationHinge).applyQuaternion(this.controlRotation).add(this.deformationHinge);
          }
          this.deformationPoint.sub(this.deformationReference).applyQuaternion(this.deformationRotation).add(this.deformationCenter);
          if (fragment) this.deformationPoint.sub(fragment.cg);
          position.setXYZ(vertex, this.deformationPoint.x, this.deformationPoint.y, this.deformationPoint.z);
        }
      }
      position.needsUpdate = true;
      this.updateWingNormals(index);
      this.updateWingBounds(index, 0, geometry);
      this.hingeLines[index].geometry.boundingBox = geometry.boundingBox;
      this.hingeLines[index].geometry.boundingSphere = geometry.boundingSphere;
    }
    if (topologyChanged) {
      this.clearWingTrail();
      for (let index = 0; index < 3; index++) this.writeWingIndices(index, 0, this.wingMeshes[index].geometry, this.hingeLines[index].geometry);
      for (const fragment of this.fragments) this.writeWingIndices(fragment.wingIndex, fragment.id, fragment.mesh.geometry, fragment.hinge.geometry);
      this.metrics.memory = this.geometryMemory();
    }
    for (const fragment of this.fragments) {
      this.updateWingBounds(fragment.wingIndex, fragment.id, fragment.mesh.geometry);
      fragment.hinge.geometry.boundingBox = fragment.mesh.geometry.boundingBox;
      fragment.hinge.geometry.boundingSphere = fragment.mesh.geometry.boundingSphere;
      fragment.hinge.visible = this.hingeLines[fragment.wingIndex].visible;
    }
  }

  private updateWingBounds(index: number, bodyId: number, geometry: THREE.BufferGeometry): void {
    const bounds = geometry.boundingBox ??= new THREE.Box3();
    const sphere = geometry.boundingSphere ??= new THREE.Sphere();
    const positions = geometry.getAttribute('position');
    bounds.makeEmpty();
    for (const section of this.wingSections[index]) {
      if (section.bodyId !== bodyId) continue;
      const end = section.vertexStart + (section.rows + 1) * 32;
      for (let vertex = section.vertexStart; vertex < end; vertex++) {
        const x = positions.getX(vertex), y = positions.getY(vertex), z = positions.getZ(vertex);
        bounds.min.x = Math.min(bounds.min.x, x); bounds.max.x = Math.max(bounds.max.x, x);
        bounds.min.y = Math.min(bounds.min.y, y); bounds.max.y = Math.max(bounds.max.y, y);
        bounds.min.z = Math.min(bounds.min.z, z); bounds.max.z = Math.max(bounds.max.z, z);
      }
    }
    if (bounds.isEmpty()) {
      bounds.min.set(0, 0, 0); bounds.max.set(0, 0, 0);
    }
    bounds.getCenter(sphere.center);
    sphere.radius = sphere.center.distanceTo(bounds.max);
  }

  private updateWingNormals(index: number): void {
    const geometry = this.wingNormalGeometry[index];
    const positions = geometry.getAttribute('position').array, normals = geometry.getAttribute('normal').array;
    const indices = geometry.index!.array;
    normals.fill(0);
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
      const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
      const x = aby * acz - abz * acy, y = abz * acx - abx * acz, z = abx * acy - aby * acx;
      normals[a] += x; normals[a + 1] += y; normals[a + 2] += z;
      normals[b] += x; normals[b + 1] += y; normals[b + 2] += z;
      normals[c] += x; normals[c + 1] += y; normals[c + 2] += z;
    }
    for (const section of this.wingSections[index]) {
      const next = section.next;
      if (!next || next.bodyId !== section.bodyId) continue;
      for (let k = 0; k < 32; k++) {
        const a = (section.vertexStart + section.rows * 32 + k) * 3, b = (next.vertexStart + k) * 3;
        for (let axis = 0; axis < 3; axis++) normals[a + axis] = normals[b + axis] = normals[a + axis] + normals[b + axis];
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const inverse = 1 / (Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1);
      normals[i] *= inverse; normals[i + 1] *= inverse; normals[i + 2] *= inverse;
    }
    (geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }

  private setEnvironmentChallenge(challenge: ChallengeMode): void {
    if (challenge === this.environmentChallenge && !isLaboratory(challenge)) return;
    this.release(this.mountainEnvironment);
    this.mountainEnvironment.clear();
    this.laboratoryScene = null;
    this.mountainShuttle = null;
    this.lowAltitudeRail = this.railCarriage = null;
    this.railCoupling = null;
    this.environmentChallenge = challenge;
    const mountain = challenge !== 'birdman';
    this.environmentFog.color.setHex(challenge === 'downhill' ? 0xc6d9e8 : challenge === 'birdman' ? 0xd4e3e4 : 0xc9ded7);
    this.environmentFog.density = challenge === 'downhill' ? 0.00055 : challenge === 'birdman' ? 0.00165 : 0.0008;
    (this.scene.background as THREE.Color).copy(this.environmentFog.color);
    this.perspective.far = this.orthographic.far = mountain ? 6000 : 3000;
    this.perspective.updateProjectionMatrix();
    this.orthographic.updateProjectionMatrix();
    this.controls.maxDistance = mountain ? 1400 : 700;
    if (isLaboratory(challenge)) {
      if (challenge === 'test-space') this.buildTestSpaceEnvironment();
      this.laboratoryScene = new LaboratoryScene(challenge, this.definition, this.mountainEnvironment);
      if (this.simulation) this.laboratoryScene.update(this.simulation);
      this.environmentFog.color.setHex(challenge === 'wind-tunnel' ? 0x45494b : 0xd5e4e7);
      this.environmentFog.density = challenge === 'wind-tunnel' ? 0 : 0.000055;
      (this.scene.background as THREE.Color).copy(this.environmentFog.color);
      this.perspective.far = this.orthographic.far = challenge === 'wind-tunnel' ? 1000 : 18000;
      this.perspective.updateProjectionMatrix(); this.orthographic.updateProjectionMatrix();
      this.controls.maxDistance = challenge === 'wind-tunnel' ? 150 : 6000;
    } else if (mountain) this.buildMountainEnvironment(challenge);
    this.metrics.memory = this.geometryMemory();
  }

  private groundMaterial(color: number, vertexColors = false): THREE.MeshStandardMaterial {
    const size = 128, pixels = new Uint8Array(size * size * 4);
    let seed = 0x4a17b923;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const patch = Math.sin(x * Math.PI / 16) * Math.sin(y * Math.PI / 32);
      const shade = Math.round(222 + patch * 16 + (seed / 0x100000000 - 0.5) * 28);
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = shade;
      pixels[offset + 3] = 255;
    }
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color, vertexColors, map: texture, roughness: 1, side: THREE.DoubleSide });
  }

  private buildTestSpaceEnvironment(): void {
    const { halfSize, step, beachHalfWidth } = TEST_SPACE, count = halfSize * 2 / step + 1;
    const positions = new Float32Array(count * count * 3), colors = new Float32Array(positions.length);
    const uvs = new Float32Array(count * count * 2), indices = new Uint32Array((count - 1) ** 2 * 6);
    const color = new THREE.Color();
    let index = 0;
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) {
      const vertex = row * count + col, offset = vertex * 3;
      const x = -halfSize + col * step, z = -halfSize + row * step, y = testSpaceTerrainHeight(x, z);
      positions[offset] = x; positions[offset + 1] = y; positions[offset + 2] = z;
      uvs[vertex * 2] = x / 24; uvs[vertex * 2 + 1] = z / 24;
      color.setHex(Math.abs(z) <= beachHalfWidth ? 0xdac7a0 : z > beachHalfWidth ? 0x92a8a1 : y > 3800 ? 0xe1e7e5 : y > 1800 ? 0x92958a : 0x78916d);
      color.toArray(colors, offset);
      if (col === count - 1 || row === count - 1) continue;
      const next = vertex + count;
      indices[index++] = vertex; indices[index++] = next; indices[index++] = vertex + 1;
      indices[index++] = vertex + 1; indices[index++] = next; indices[index++] = next + 1;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1)); geometry.computeVertexNormals();
    const terrain = this.mesh(geometry, this.groundMaterial(0xffffff, true), this.mountainEnvironment);
    terrain.name = 'test-space-terrain'; terrain.castShadow = false;
    const width = halfSize * 2, length = halfSize - beachHalfWidth;
    const material = this.waterMaterial(0x6a9fae, width, length);
    // Match the lake's render-only waterline offset, with stable shore depth at long view distances.
    material.polygonOffset = true; material.polygonOffsetFactor = -1; material.polygonOffsetUnits = -1;
    const ocean = this.mesh(new THREE.PlaneGeometry(width, length), material, this.mountainEnvironment);
    ocean.name = 'test-space-ocean'; ocean.rotation.x = -Math.PI / 2; ocean.position.set(0, -0.035, (halfSize + beachHalfWidth) / 2); ocean.castShadow = false;
    const bounds = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(10000, 10000, 10000)), new THREE.LineBasicMaterial({ color: 0xa3b5ae, transparent: true, opacity: 0.18 }));
    bounds.name = 'test-space-boundary'; bounds.position.y = 5000; this.mountainEnvironment.add(bounds);
    this.buildTrees(this.mountainEnvironment, true);
  }

  private buildMountainEnvironment(challenge: ChallengeMode): void {
    const downhill = challenge === 'downhill';
    const { minX, maxX, minZ, maxZ, step } = challengeTerrainGrid;
    const columns = Math.round((maxX - minX) / step) + 1;
    const rows = Math.round((maxZ - minZ) / step) + 1;
    const vertices = new Float32Array(columns * rows * 3);
    const uvs = new Float32Array(columns * rows * 2);
    const colors = new Float32Array(vertices.length);
    const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
    const color = new THREE.Color(), grass = new THREE.Color(0x71856a), rock = new THREE.Color(0x8f928d), soil = new THREE.Color(0x967956), snow = new THREE.Color(0xeaf1ef);
    let triangle = 0;
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const x = minX + column * step, z = minZ + row * step;
      const y = challengeTerrainHeight(challenge, x, z);
      const vertex = row * columns + column, offset = vertex * 3;
      uvs[vertex * 2] = x / 24; uvs[vertex * 2 + 1] = z / 24;
      vertices[offset] = x; vertices[offset + 1] = y; vertices[offset + 2] = z;
      const slope = Math.abs(challengeTerrainHeight(challenge, x, z + step) - challengeTerrainHeight(challenge, x, z - step)) / (step * 2);
      color.copy(grass).lerp(rock, clamp(slope * 0.9 + (y - 250) / 1000, 0, 1));
      if (downhill) {
        color.copy(grass).lerp(soil, clamp((y - 90) / 260, 0, 1));
        color.lerp(rock, clamp((y - 450) / 350, 0, 1));
        color.lerp(snow, clamp((y - 1050) / 350, 0, 1));
      }
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
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeVertexNormals();
    const terrain = this.mesh(geometry, this.groundMaterial(0xffffff, true), this.mountainEnvironment);
    terrain.name = 'challenge-terrain';
    terrain.castShadow = false;

    if (downhill) this.buildDownhillRuins();
    this.buildChallengeLaunch(challenge);
    this.buildChallengeRiver();
    const course = challengeDefinitions[challenge], startGate = challengeStartGate(challenge), launch = challengeLaunch(challenge);
    const checkpoints = challengeCheckpoints(challenge);
    const gates = startGate ? [startGate, ...checkpoints] : checkpoints;
    const route: number[] = [], routeIndices: number[] = [];
    for (let x = 0, sample = 0; x <= course.length; x += step, sample++) {
      const z = downhill ? downhillRouteCenter(x) : challengeCenter(challenge, x);
      const floor = challengeCollisionHeight(challenge, x, z);
      const routeY = floor + (downhill ? downhillHeightLimit(x) : LOW_ALTITUDE.scoringHeight) / 2;
      const y = THREE.MathUtils.lerp(launch?.y ?? 0, routeY, clamp(x / 180, 0, 1));
      route.push(x, y, z - 1.5, x, y, z + 1.5);
      if (sample === 0) continue;
      const a = (sample - 1) * 2;
      routeIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const routeGeometry = new THREE.BufferGeometry();
    routeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(route, 3));
    routeGeometry.setIndex(routeIndices);
    const routeMesh = new THREE.Mesh(routeGeometry, new THREE.MeshBasicMaterial({ color: 0xb9a2ff, side: THREE.DoubleSide, transparent: true, opacity: 0.65, depthWrite: false }));
    routeMesh.name = 'continuous-flight-route';
    this.mountainEnvironment.add(routeMesh);
    const frameGeometry = new THREE.BoxGeometry(1, 1, 1);
    const checkpointMaterial = new THREE.MeshBasicMaterial({ color: 0xf2ba62 });
    const frameThickness = downhill ? 1.6 : 0.6;
    const finishMaterial = new THREE.MeshBasicMaterial({ color: 0x83e4d8, side: THREE.DoubleSide });
    const startMaterial = new THREE.MeshBasicMaterial({ color: 0x69caff });
    for (let index = 0; index < gates.length; index++) {
      const gate = gates[index], finish = index === gates.length - 1, timingStart = gate === startGate;
      const profile = challengeGateProfile(challenge, gate);
      const material = timingStart ? startMaterial : finish ? finishMaterial : checkpointMaterial;
      const checkpointIndex = index + (startGate ? 0 : 1);
      const group = new THREE.Group();
      group.name = timingStart ? 'challenge-start' : finish ? 'challenge-finish' : `checkpoint-${checkpointIndex}`;
      group.position.set(gate.x, gate.y, gate.z);
      // 门框仅作导航标记，不注册为地形或物理碰撞体；开口直接使用判门共享参数。
      group.userData.gate = { checkpointIndex, halfWidth: gate.halfWidth, maxHeight: gate.maxHeight, collision: false, profile };
      this.mountainEnvironment.add(group);
      const stripeMaterial = new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,
        uniforms:{opacity:{value:0},finish:{value:0}},
        vertexShader:'varying vec2 stripe; void main(){stripe=position.yz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader:'varying vec2 stripe;uniform float opacity;uniform float finish;void main(){float band=step(0.5,fract((stripe.x+stripe.y)*0.35));vec3 color=finish>0.5?mix(vec3(0.15,0.55,0.48),vec3(0.8,1.,0.92),band):mix(vec3(0.45,0.01,0.02),vec3(1.,0.08,0.05),band);gl_FragColor=vec4(color,finish>0.5?0.38:opacity);}' });
      for (const region of this.gateWarningRegions(challenge, gate, finish)) {
        const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(region.vertices, 3));
        const regionMaterial = region.finish ? stripeMaterial.clone() : stripeMaterial;
        if (region.finish) regionMaterial.uniforms.finish.value = 1;
        const stripes = new THREE.Mesh(geometry, regionMaterial);
        stripes.userData.warning = true;
        stripes.name = region.name;
        group.add(stripes);
      }
      const height = downhill ? 20 : gate.maxHeight;
      for (const side of [-1, 1]) {
        const post = this.mesh(frameGeometry, material, group);
        post.position.set(0, profile[side === -1 ? 0 : profile.length - 1].top - height / 2, side * (gate.halfWidth + frameThickness / 2));
        post.scale.set(frameThickness, height, frameThickness);
        post.castShadow = post.receiveShadow = false;
      }
      const barVertices: number[] = [], barIndices: number[] = [];
      for (let sample = 0; sample < profile.length; sample++) {
        const point = profile[sample], half = frameThickness / 2;
        barVertices.push(-half,point.top-half,point.z,half,point.top-half,point.z,half,point.top+half,point.z,-half,point.top+half,point.z);
        if (sample === 0) continue;
        const a = (sample - 1) * 4, b = sample * 4;
        for (let side = 0; side < 4; side++) {
          const next = (side + 1) % 4;
          barIndices.push(a+side,a+next,b+side,a+next,b+next,b+side);
        }
      }
      const end = (profile.length - 1) * 4;
      barIndices.push(0,2,1,0,3,2,end,end+1,end+2,end,end+2,end+3);
      const barGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(barVertices, 3));
      barGeometry.setIndex(barIndices);
      const bar = this.mesh(barGeometry, material, group);
      bar.name = 'gate-ceiling-frame';
      bar.castShadow = bar.receiveShadow = false;
      if (!downhill) {
        if (!timingStart) {
          const goldVertices: number[] = [];
          for (let z = -gate.halfWidth; z < gate.halfWidth; z += step) {
            const nextZ = Math.min(gate.halfWidth, z + step);
            const a = challengeCollisionHeight(challenge, gate.x, gate.z + z) - gate.y;
            const b = challengeCollisionHeight(challenge, gate.x, gate.z + nextZ) - gate.y;
            goldVertices.push(0,a,z,0,a+LOW_ALTITUDE.bonusHeight,z,0,b,nextZ,0,b,nextZ,0,a+LOW_ALTITUDE.bonusHeight,z,0,b+LOW_ALTITUDE.bonusHeight,nextZ);
          }
          const gold = stripeMaterial.clone();
          gold.fragmentShader = 'varying vec2 stripe;uniform float opacity;void main(){float band=step(0.65,fract((stripe.x+stripe.y)*0.6));gl_FragColor=vec4(1.,0.73,0.16,opacity*band*0.22);}';
          const zone = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(goldVertices,3)),gold);
          zone.name='low-altitude-bonus-zone';zone.userData.warning=true;group.add(zone);
        }
        const targetVertices: number[] = [];
        for (let z = -gate.halfWidth; z < gate.halfWidth; z += step) {
          const nextZ = Math.min(gate.halfWidth, z + step);
          const y = challengeCollisionHeight(challenge, gate.x, gate.z + z) - gate.y + LOW_ALTITUDE.scoringHeight;
          const nextY = challengeCollisionHeight(challenge, gate.x, gate.z + nextZ) - gate.y + LOW_ALTITUDE.scoringHeight;
          targetVertices.push(-0.6, y, z, 0.6, y, z, -0.6, nextY, nextZ,
            0.6, y, z, 0.6, nextY, nextZ, -0.6, nextY, nextZ);
        }
        const targetGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(targetVertices, 3));
        const target = new THREE.Mesh(targetGeometry, finishMaterial);
        target.name = 'low-altitude-scoring-height';
        group.add(target);
      }
      const sign = this.label(timingStart ? '计时起点 START' : finish ? '终点 FINISH' : '检查点 {index} · {distance} m', '#213d40', timingStart ? '#a7dfff' : finish ? '#a6eee4' : '#ffe0a0', 512, 96, false, { index: checkpointIndex, distance: gate.x.toFixed(1) });
      sign.position.set(0, downhill ? gate.maxHeight + 9 : LOW_ALTITUDE.scoringHeight + 4, 0);
      sign.scale.set(downhill ? 40 : 24, downhill ? 7.5 : 4.5, 1);
      group.add(sign);
    }
    const start = this.label(downhill ? '20 m 高山弹射台 · 离地至少 50 m · 过蓝门计时' : '跑道上方 2 m 导轨 · 升力脱轨 · 过蓝门计时', '#213d40', '#eef5f0', 1024, 96);
    start.position.set(launch?.startX ?? 0, (launch?.y ?? 0) + 14, launch?.z ?? challengeCenter(challenge, 0));
    start.scale.set(40, 5, 1);
    this.mountainEnvironment.add(start);
  }

  private gateWarningRegions(challenge: ChallengeMode, gate: Readonly<ChallengeCheckpoint>, finish: boolean) {
    const extent = CHALLENGE_WARNING_EXTENT, profile = challengeGateProfile(challenge, gate);
    const regions: { name: string; finish: boolean; vertices: number[] }[] = [];
    const add = (name: string, samples: { z: number; bottom: number; top: number }[], finishZone = false) => {
      const vertices: number[] = [];
      for (let index = 1; index < samples.length; index++) {
        const a = samples[index - 1], b = samples[index];
        vertices.push(0,a.bottom,a.z,0,a.top,a.z,0,b.bottom,b.z,0,b.bottom,b.z,0,a.top,a.z,0,b.top,b.z);
      }
      regions.push({ name, finish: finishZone, vertices });
    };
    for (const [name, left, right] of [
      ['gate-left-boundary', -extent, -gate.halfWidth],
      ['gate-right-boundary', gate.halfWidth, extent],
    ] as const) add(name, [left, right].map(z => ({ z, bottom: -extent, top: extent })));
    add('gate-ceiling-boundary', profile.map(point => ({ z: point.z, bottom: point.top, top: extent })));
    if (challenge === 'downhill') add('gate-ground-boundary', profile.map(point => ({ z: point.z, bottom: -extent, top: point.bottom })));
    if (finish) add('gate-finish-zone', profile, true);
    return regions;
  }

  private updateChallengeGates() {
    const sim = this.simulation;
    const passed = sim?.telemetry.timingStarted
      ? Math.round(sim.telemetry.challengeProgress * challengeCheckpoints(sim.challenge).length) : -1;
    for (const gate of this.mountainEnvironment.children) {
      const data = gate.userData.gate;
      if (!data) continue;
      gate.visible = !sim || sim.challenge !== 'downhill' || data.checkpointIndex > passed;
      const distance = sim ? gate.position.x - sim.position.x : Infinity;
      const proximity = sim && gate.visible ? 1 - clamp((sim.challenge === 'downhill' ? distance : Math.abs(distance)) / 90, 0, 1) : 0;
      for (const child of gate.children) {
        if (child.userData.warning) (child as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material.uniforms.opacity.value = proximity;
      }
    }
  }

  private buildChallengeLaunch(challenge: ChallengeMode): void {
    const launch = challengeLaunch(challenge);
    if (!launch) return;
    const catapult = launch.kind === 'catapult';
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const steel = new THREE.MeshStandardMaterial({ color: 0x536571, metalness: 0.65, roughness: 0.5 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xf8e8ac, roughness: 0.85 });
    const deckGeometry = new THREE.BoxGeometry(launch.length, launch.thickness, launch.width);
    const positions = deckGeometry.getAttribute('position'), uv = deckGeometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) uv.setXY(i, positions.getX(i) / 24, positions.getZ(i) / 24);
    const deckMaterial = this.groundMaterial(catapult ? 0x8f9796 : 0x525b60);
    if (!catapult) {
      deckMaterial.polygonOffset = true;
      deckMaterial.polygonOffsetFactor = -1;
      deckMaterial.polygonOffsetUnits = -1;
    }
    const deck = this.mesh(deckGeometry, deckMaterial, this.mountainEnvironment);
    deck.name = catapult ? 'mountain-catapult-platform' : 'ground-runway';
    deck.position.set((launch.startX + launch.endX) / 2, launch.y - launch.thickness / 2, launch.z);
    for (const side of [-1, 1]) {
      const edge = this.mesh(unit, paint, this.mountainEnvironment);
      edge.position.set(deck.position.x, launch.y + 0.025, launch.z + side * (launch.width / 2 - 0.5));
      edge.scale.set(launch.length, 0.05, 0.2);
      if (catapult) {
        const rail = this.mesh(unit, steel, this.mountainEnvironment);
        rail.position.set(deck.position.x, launch.y + 0.12, launch.z + side * 0.45);
        rail.scale.set(launch.length, 0.2, 0.12);
        for (const x of [launch.startX + 1, deck.position.x, launch.endX - 1]) {
          const z = launch.z + side * (launch.width / 2 - 1);
          const ground = challengeTerrainHeight(challenge, x, z);
          const height = launch.y - launch.thickness - ground;
          const support = this.mesh(unit, steel, this.mountainEnvironment);
          support.position.set(x, ground + height / 2, z);
          support.scale.set(0.7, height, 0.7);
        }
      }
    }
    for (const x of [launch.startX + 2, launch.endX - 2]) {
      const threshold = this.mesh(unit, paint, this.mountainEnvironment);
      threshold.position.set(x, launch.y + 0.03, launch.z);
      threshold.scale.set(0.5, 0.06, launch.width - 2);
    }
    if (catapult) {
      this.mountainShuttle = this.mesh(unit, new THREE.MeshStandardMaterial({ color: 0xd99b47, metalness: 0.55, roughness: 0.5 }), this.mountainEnvironment);
      this.mountainShuttle.name = 'mountain-catapult-shuttle';
      this.mountainShuttle.position.set(launch.startX, launch.y + 0.32, launch.z);
      this.mountainShuttle.scale.set(1.2, 0.25, 1.5);
    } else {
      this.buildLowAltitudeRail(unit, steel);
      for (let x = launch.startX + 12; x < launch.endX - 8; x += 24) {
        const stripe = this.mesh(unit, paint, this.mountainEnvironment);
        stripe.position.set(x, launch.y + 0.03, launch.z);
        stripe.scale.set(10, 0.06, 0.35);
      }
      const number = this.label('09', '#f8e8ac', '#525b60', 192, 192, true);
      number.name = 'runway-heading';
      number.position.set(launch.startX + 24, launch.y + 0.07, launch.z);
      number.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
      number.scale.set(7, 7, 1);
      this.mountainEnvironment.add(number);
    }
  }

  private buildLowAltitudeRail(unit: THREE.BoxGeometry, steel: THREE.MeshStandardMaterial): void {
    const launch = challengeLaunch('low-altitude')!;
    const rail = this.lowAltitudeRail = new THREE.Group();
    rail.name = 'low-altitude-rail';
    this.mountainEnvironment.add(rail);
    const top = launch.y + LOW_ALTITUDE_RAIL.height;
    const sample = this.railSample;
    const bendStart = launch.endX - LOW_ALTITUDE_RAIL.bendLength;
    for (let x = launch.startX; x < launch.endX;) {
      const y0 = lowAltitudeRailSample(x, sample).y;
      const x1 = x < bendStart ? bendStart : Math.min(x + 2, launch.endX);
      const y1 = lowAltitudeRailSample(x1, sample).y;
      for (const side of [-1, 1]) {
        const beam = this.mesh(unit, steel, rail);
        beam.position.set((x + x1) / 2, (y0 + y1) / 2 - 0.1, launch.z + side * 0.65);
        beam.rotation.z = Math.atan2(y1 - y0, x1 - x);
        beam.scale.set(Math.hypot(x1 - x, y1 - y0), 0.2, 0.12);
      }
      x = x1;
    }
    let supportCount = 0;
    for (let x = launch.startX; x <= launch.endX; x += 20) {
      lowAltitudeRailSample(x, sample);
      for (const side of [-1, 1]) {
        const support = this.mesh(unit, steel, rail);
        const height = sample.y - launch.y - 0.2;
        support.position.set(x, launch.y + height / 2, launch.z + side * 0.65);
        support.scale.set(0.16, height, 0.16);
        supportCount++;
      }
      const crossbar = this.mesh(unit, steel, rail);
      crossbar.position.set(x, sample.y - 0.28, launch.z);
      crossbar.rotation.z = sample.pitch;
      crossbar.scale.set(0.16, 0.16, 1.55);
    }
    rail.userData.supportCount = supportCount;
    const carriage = this.railCarriage = new THREE.Group();
    carriage.name = 'low-altitude-rail-carriage';
    carriage.position.set(launch.startX, top, launch.z);
    rail.add(carriage);
    const bracket = new THREE.MeshStandardMaterial({ color: 0xd99b47, metalness: 0.65, roughness: 0.4 });
    const crossbar = this.mesh(unit, bracket, carriage);
    crossbar.scale.set(0.7, 0.12, 1.5);
    crossbar.position.y = -0.3;
    const rollerGeometry = new THREE.CylinderGeometry(0.14, 0.14, 0.18, 12);
    for (const x of [-0.25, 0.25]) for (const side of [-1, 1]) {
      const roller = this.mesh(rollerGeometry, bracket, carriage);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(x, 0.14, side * 0.65);
    }
    // 独立几何归山谷环境所有，切换挑战时不释放飞机共用的strutGeometry。
    this.railCoupling = this.mesh(new THREE.CylinderGeometry(1, 1, 1, 8), bracket, carriage);
    this.railCoupling.name = 'low-altitude-rail-coupling';
  }

  private buildDownhillRuins(): void {
    const concrete = this.groundMaterial(0x777b77), dark = new THREE.MeshStandardMaterial({color:0x293335,roughness:1});
    const box = new THREE.BoxGeometry(1,1,1), transform = new THREE.Object3D(), local = new THREE.Matrix4(), matrix = new THREE.Matrix4();
    const bodies = new THREE.InstancedMesh(box,concrete,downhillRuins.length);
    const bands = new THREE.InstancedMesh(box,dark,downhillRuins.reduce((sum,r)=>sum+Math.ceil(r.length/6)*2+1,0));
    bodies.name='fallen-highrises';bands.name='ruin-window-bands';bodies.castShadow=bodies.receiveShadow=true;
    this.mountainEnvironment.add(bodies,bands);
    let band=0;
    for (const [index,ruin] of downhillRuins.entries()) {
      transform.position.set(ruin.x,ruin.y,ruin.z);transform.rotation.set(ruin.tilt,ruin.yaw,0,'YXZ');
      transform.scale.set(ruin.width,ruin.height,ruin.length);transform.updateMatrix();bodies.setMatrixAt(index,transform.matrix);
      transform.scale.set(1,1,1);transform.updateMatrix();
      // Floor/window bands share one draw call across the ruined city.
      for (let floor=-ruin.length/2+4;floor<ruin.length/2-2;floor+=6) for (const side of [-1,1]) {
        local.makeScale(0.08,ruin.height*0.68,3.5).setPosition(side*(ruin.width/2+0.02),0,floor);
        bands.setMatrixAt(band++,matrix.multiplyMatrices(transform.matrix,local));
      }
      local.makeScale(ruin.width*0.8,ruin.height*0.8,0.08).setPosition(0,0,ruin.length/2+0.03);
      bands.setMatrixAt(band++,matrix.multiplyMatrices(transform.matrix,local));
    }
    bands.count=band;
  }

  private buildChallengeRiver(): void {
    const { minX, maxX, step } = challengeTerrainGrid;
    const vertices: number[] = [], indices: number[] = [];
    for (let x = minX; x <= maxX; x += step) {
      const downhill = this.environmentChallenge === 'downhill';
      if (downhill && x < 3300) continue;
      const z = downhill ? challengeCenter('downhill', x) : challengeRiverCenter(x), y = downhill ? challengeTerrainHeight('downhill', x, z) + 0.15 : challengeRiverHeight(x);
      vertices.push(x, y, z - CHALLENGE_RIVER.width / 2, x, y, z + CHALLENGE_RIVER.width / 2);
      if (vertices.length === 6) continue;
      const a = vertices.length / 3 - 4;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ color: 0x3c9eaa, metalness: 0.25, roughness: 0.27, side: THREE.DoubleSide });
    material.onBeforeCompile = shader => {
      shader.uniforms.riverTime = this.waterTime;
      shader.vertexShader = 'varying vec3 riverPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nriverPosition = position;');
      shader.fragmentShader = 'uniform float riverTime;\nvarying vec3 riverPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat ripple = sin(riverPosition.x * 1.2 - riverTime * 2.0) * sin(riverPosition.z * 1.8 + riverTime * 0.7);\ndiffuseColor.rgb *= 1.0 + ripple * 0.1;');
    };
    const river = this.mesh(geometry, material, this.mountainEnvironment);
    river.name = 'challenge-river';
    river.castShadow = false;
  }

  private waterMaterial(color: number, width: number, length: number): THREE.MeshStandardMaterial {
    const size = 64, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x * Math.PI * 2 / size, v = y * Math.PI * 2 / size;
      const shade = Math.round(218 + 22 * Math.sin(4 * u + Math.sin(2 * v)) * Math.sin(3 * v + Math.sin(u)));
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = shade; pixels[offset + 3] = 255;
    }
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.repeat.set(width / 32, length / 32); texture.needsUpdate = true;
    const water = new THREE.MeshStandardMaterial({ color, map: texture, roughness: 0.35, metalness: 0.24, flatShading: true });
    water.onBeforeCompile = shader => {
      shader.uniforms.lakeTime = this.waterTime;
      shader.vertexShader = 'uniform float lakeTime;\nvarying vec3 lakePosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nlakePosition = position;');
      shader.fragmentShader = 'uniform float lakeTime;\nvarying vec3 lakePosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\nfloat wave = sin(lakePosition.x * 0.2 + lakePosition.y * 0.48 + lakeTime * 0.42) * sin(lakePosition.y * 0.17 - lakeTime * 0.3);\ndiffuseColor.rgb *= 1.0 + wave * 0.045;');
    };
    return water;
  }

  private buildEnvironment(): void {
    const water = this.waterMaterial(0x7bada6, 2400, 2000);
    const lake = this.mesh(new THREE.PlaneGeometry(2400, 2000), water, this.environment);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(700, -0.035, 0);
    lake.castShadow = false;
    this.terrain.push(lake);
    const ground = this.groundMaterial(0x9caa81);
    // The bank and shoreline share vertices; the central approach meets the rear deck exactly.
    const vertices: number[] = [], indices: number[] = [];
    const groundUvs: number[] = [];
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
        groundUvs.push(THREE.MathUtils.lerp(-132.5, edge, t) / 24, z / 24);
        if (i < 60 && j < 24) {
          const a = i * 25 + j;
          indices.push(a, a + 25, a + 1, a + 1, a + 25, a + 26);
        }
      }
    }
    const bankGeometry = new THREE.BufferGeometry();
    bankGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    bankGeometry.setIndex(indices);
    bankGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(groundUvs, 2));
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
    this.steam.visible = false;
    this.steam.count = 0;
    this.steam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.steam.geometry.setAttribute('steamOpacity', this.steamOpacity);
    this.steam.material.onBeforeCompile = shader => {
      shader.vertexShader = `attribute float steamOpacity;\nvarying float vSteamOpacity;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSteamOpacity = steamOpacity;');
      shader.fragmentShader = `varying float vSteamOpacity;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vSteamOpacity;');
    };
    this.scene.add(this.steam);
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
    this.buildTrees(this.detail);
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
    this.scene.add(...this.centerMarkers);
    this.scene.updateMatrixWorld(true);
  }

  private buildTrees(parent: THREE.Group, laboratory = false): void {
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6d7960, roughness: 1 });
    const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x617c62, roughness: 1, flatShading: true });
    const treeGeometry = new THREE.ConeGeometry(1, 3.4, 5);
    const trunkGeometry = new THREE.CylinderGeometry(0.15, 0.2, 2, 5);
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, 48);
    const trees = new THREE.InstancedMesh(treeGeometry, leavesMaterial, 48);
    trunks.name = 'tree-trunks'; trees.name = 'tree-canopies';
    trunks.castShadow = trees.castShadow = true;
    trunks.receiveShadow = trees.receiveShadow = true;
    parent.add(trunks, trees);
    const instance = new THREE.Object3D(), trunkScale = laboratory ? 3 : 1;
    this.environment.updateMatrixWorld(true);
    for (let i = 0; i < 48; i++) {
      const x = laboratory ? TEST_SPACE.platformX - 400 + (i % 8) * 115 + Math.sin(i * 7.2) * 25 : -27 - (i % 8) * 11 + Math.sin(i * 7.2) * 3;
      const z = laboratory ? -65 - Math.floor(i / 8) * 140 + Math.sin(i * 2.2) * 15 : (i < 24 ? -1 : 1) * (15 + Math.floor((i % 24) / 8) * 22 + Math.sin(i * 2.2) * 8);
      const scale = (0.8 + (Math.sin(i * 8.2) + 1) * 0.8) * trunkScale;
      const groundY = laboratory ? testSpaceTerrainHeight(x, z) : this.surfaceHeight(x, z);
      instance.position.set(x, groundY + 0.8 * trunkScale, z);
      instance.scale.setScalar(trunkScale);
      instance.updateMatrix(); trunks.setMatrixAt(i, instance.matrix);
      instance.position.set(x, groundY + 2 * trunkScale + scale * 1.1, z);
      instance.scale.setScalar(scale);
      instance.updateMatrix(); trees.setMatrixAt(i, instance.matrix);
    }
  }

  private updateCatapult(): void {
    if (this.laboratoryScene && this.simulation) {
      this.steam.visible = false; this.steam.count = 0;
      this.laboratoryScene.update(this.simulation); return;
    }
    this.updateSteam();
    if (this.environmentChallenge !== 'birdman') {
      const launch = challengeLaunch(this.environmentChallenge);
      if (this.railCarriage && this.railCoupling && launch) {
        const attached = this.simulation?.challenge === 'low-altitude' && this.simulation.launching;
        this.aircraft.updateWorldMatrix(true, false);
        this.vector.copy(this.railReferenceCG).sub(this.renderCG);
        this.vector.y -= this.railReferenceHeight;
        this.aircraft.localToWorld(this.vector);
        const x = clamp(attached ? this.vector.x : this.simulation?.railPositionX ?? this.railLastAttachedX, launch.startX, launch.endX);
        const sample = lowAltitudeRailSample(x, this.railSample);
        this.railCarriage.position.set(x, sample.y, launch.z);
        this.railCarriage.rotation.z = sample.pitch;
        this.railCarriage.updateWorldMatrix(true, false);
        this.railAttachment.set(this.definition.fuselage.center, 0, 0).sub(this.renderCG);
        this.aircraft.localToWorld(this.railAttachment);
        this.railCoupling.visible = attached;
        if (attached) {
          // 与飞机使用相同插值变换；物理脱轨即隐藏连接，不按显示时间猜测释放。
          this.vector.copy(this.railAttachment);
          this.railCarriage.worldToLocal(this.vector);
          this.vector2.set(0, -0.3, 0);
          this.placeStrut(this.railCoupling, this.vector2, this.vector, 0.065);
        }
      }
      if (this.mountainShuttle && launch) this.mountainShuttle.position.x = this.simulation?.launching ? clamp(this.aircraft.position.x, launch.startX, launch.endX) : launch.endX;
      return;
    }
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
  }

  private updateSteam(): void {
    const sim = this.simulation;
    const launch = challengeLaunch(this.environmentChallenge);
    const birdman = this.environmentChallenge === 'birdman';
    const acceleration = launch?.acceleration ?? LAUNCH.acceleration;
    const duration = (launch?.speed ?? LAUNCH.speed) / acceleration;
    this.steamTime = sim?.elapsedTime ?? 0;
    this.steamEmitting = !!sim && !sim.ended && !sim.replayFinished && sim.launching && (birdman || launch?.kind === 'catapult');
    this.steam.count = 0;
    this.steam.visible = false;
    if (!sim || sim.ended || sim.replayFinished || (!birdman && launch?.kind !== 'catapult')) return;
    const time = this.steamTime;
    const last = Math.min(Math.floor(time * STEAM_PAIRS_PER_SECOND + 1e-9), Math.round(duration * STEAM_PAIRS_PER_SECOND));
    const first = Math.max(1, Math.floor((time - STEAM_LIFETIME) * STEAM_PAIRS_PER_SECOND) + 1);
    if (last < first) return;
    const startX = launch?.startX ?? LAUNCH.startX, endX = launch?.endX ?? LAUNCH.endX;
    const slope = launch?.slope ?? LAUNCH.slope, endY = launch?.y ?? LAUNCH.height, z = launch?.z ?? 0;
    let count = 0;
    // 固定发射序列直接从物理时间求值；回放、跳帧和重飞不依赖显示帧历史。
    for (let emission = first; emission <= last && count < STEAM_CAPACITY; emission++) {
      const emittedAt = emission / STEAM_PAIRS_PER_SECOND;
      const age = time - emittedAt, life = age / STEAM_LIFETIME;
      const noise = Math.sin(emission * 2.399963), swirl = Math.cos(emission * 1.618034);
      const x = Math.min(endX, startX + 0.5 * acceleration * emittedAt ** 2 * Math.cos(slope));
      const y = endY + (endX - x) * Math.tan(slope) + 0.12;
      const spread = 0.38 + (5.2 + noise * 1.2) * age / (1 + age * 0.45);
      const size = 0.22 + age * (0.9 + noise * 0.15);
      for (let side = -1; side <= 1; side += 2) {
        this.steamParticle.position.set(x + swirl * age * 0.65 - age * 0.4, y + age * 0.8 + age * age * 0.45, z + side * spread);
        this.steamParticle.scale.set(size * 1.15, size * 0.8, size * 1.45);
        this.steamParticle.updateMatrix();
        this.steam.setMatrixAt(count, this.steamParticle.matrix);
        this.steamOpacity.setX(count, (1 - life) ** 2);
        count++;
      }
    }
    this.steam.count = count;
    this.steam.visible = count > 0;
    this.steam.instanceMatrix.needsUpdate = true;
    this.steamOpacity.needsUpdate = true;
  }

  /** 按需复制实例状态，诊断不暴露可写粒子池。 */
  private steamDiagnostics() {
    const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), size = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const particles = [];
    const time = this.steamTime;
    const first = Math.max(1, Math.floor((time - STEAM_LIFETIME) * STEAM_PAIRS_PER_SECOND) + 1);
    for (let index = 0; index < this.steam.count; index++) {
      this.steam.getMatrixAt(index, matrix);
      matrix.decompose(point, rotation, size);
      const emittedAt = (first + Math.floor(index / 2)) / STEAM_PAIRS_PER_SECOND;
      particles.push({
        side: index % 2 === 0 ? 'left' : 'right', age: time - emittedAt,
        position: { x: point.x, y: point.y, z: point.z },
        radius: size.y, opacity: this.steamOpacity.getX(index) * this.steam.material.opacity,
      });
    }
    return {
      visible: this.steam.visible, emitting: this.steamEmitting, time,
      count: this.steam.count, capacity: STEAM_CAPACITY, lifetime: STEAM_LIFETIME,
      leftCount: this.steam.count / 2, rightCount: this.steam.count / 2,
      pairsPerSecond: STEAM_PAIRS_PER_SECOND, particles,
    };
  }

  private label(text: string, color: string, background: string, width: number, height: number, flat = false, params?: Record<string, string | number>): THREE.Sprite | THREE.Mesh {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = flat ? new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, depthWrite: false }))
      : new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: false, depthWrite: false }));
    label.userData.redrawLabel = () => {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
      context.fillStyle = color;
      context.font = '500 36px system-ui, sans-serif';
      context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(t(text, params), width / 2, height / 2, width - 20);
      texture.needsUpdate = true;
    };
    label.userData.redrawLabel();
    return label;
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
    if (this.simulation?.challenge === 'test-space' && this.width <= 700) {
      const offsetY = this.height * 0.14;
      this.perspective.setViewOffset(this.width, this.height, 0, offsetY, this.width, this.height);
      this.orthographic.setViewOffset(this.width, this.height, 0, offsetY, this.width, this.height);
    } else if (!this.simulation) {
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

  /** Project native SVG from the pilot's body-fixed plane or the locked camera's instrument plane. */
  pilotHud(pitch: number, roll: number): PilotHudFrame | null {
    if (!this.simulation || !['pilot', 'locked'].includes(this.view) || this.simulation.ended) return null;
    this.body.updateWorldMatrix(true, false);
    this.camera.updateMatrixWorld();
    this.hudMatrix.set(0, 0, 0, this.definition.cockpit.position + 2.79,
      0, -0.002, 0, 0.72, 0.002, 0, 0, -0.6, 0, 0, 0, 1);
    if (this.view === 'locked') {
      // A restrained camera-space instrument plane; body-axis load response
      // shifts it independently of the gently delayed tracking camera.
      const scale = Math.min(1, this.width / this.height * 1.2);
      this.hudMatrix.set(0.002 * scale, 0, 0, -0.6 * scale + this.headOffset.z * 0.4,
        0, -0.002 * scale, 0, 0.4 * scale + this.headOffset.y * 0.4,
        0, 0, 0, -2 + this.headOffset.x * 0.4, 0, 0, 0, 1);
    } else this.hudMatrix.premultiply(this.body.matrixWorld).premultiply(this.camera.matrixWorldInverse);
    this.hudMatrix.premultiply(this.camera.projectionMatrix);
    const e = this.hudMatrix.elements;
    // Hide the panel if any corner crosses the camera's near plane.
    for (const x of [0, 600]) for (const y of [0, 400]) if (e[3] * x + e[7] * y + e[15] <= 0.1) return null;
    const project = (x: number, y: number) => {
      const w = e[3] * x + e[7] * y + e[15];
      return {
        x: (1 + (e[0] * x + e[4] * y + e[12]) / w) * this.width / 2,
        y: (1 - (e[1] * x + e[5] * y + e[13]) / w) * this.height / 2,
      };
    };
    const affine = (x: number, y: number, rotation = 0) => {
      const point = project(x, y), w = e[3] * x + e[7] * y + e[15];
      const nx = (e[0] * x + e[4] * y + e[12]) / w, ny = (e[1] * x + e[5] * y + e[13]) / w;
      const xx = (e[0] - nx * e[3]) / w * this.width / 2, xy = -(e[1] - ny * e[3]) / w * this.height / 2;
      const yx = (e[4] - nx * e[7]) / w * this.width / 2, yy = -(e[5] - ny * e[7]) / w * this.height / 2;
      const c = Math.cos(rotation), s = Math.sin(rotation);
      // Local SVG affine keeps each small label sharp without flattening the whole panel.
      return `matrix(${xx*c+yx*s} ${xy*c+yy*s} ${yx*c-xx*s} ${yy*c-xy*s} ${point.x} ${point.y})`;
    };
    const line = (x1: number, y1: number, x2: number, y2: number, clip = false) => {
      if (clip) {
        // Clip in panel coordinates before perspective division, including steep attitudes.
        const dx = x2 - x1, dy = y2 - y1;
        let start = 0, end = 1;
        for (const [p, q] of [[-dx, x1-180], [dx, 420-x1], [-dy, y1-75], [dy, 325-y1]]) {
          if (p === 0) { if (q < 0) return ''; }
          else if (p < 0) start = Math.max(start, q / p);
          else end = Math.min(end, q / p);
          if (start > end) return '';
        }
        x2 = x1 + dx * end; y2 = y1 + dy * end;
        x1 += dx * start; y1 += dy * start;
      }
      const a = project(x1, y1), b = project(x2, y2);
      return `M ${a.x} ${a.y} L ${b.x} ${b.y} `;
    };
    const rotation = -roll * Math.PI / 180, c = Math.cos(rotation), s = Math.sin(rotation);
    const attitudePoint = (x: number, y: number) => ({ x: 300 + x*c - y*s, y: 200 + x*s + y*c });
    const attitudeLine = (x1: number, y1: number, x2: number, y2: number) => {
      const a = attitudePoint(x1, y1), b = attitudePoint(x2, y2);
      return line(a.x, a.y, b.x, b.y, true);
    };
    let ladder = '', dashedLadder = '';
    const labels: { angle: number; left: string; right: string }[] = [];
    for (let angle = -60; angle <= 60; angle += 10) {
      const y = (pitch - angle) * 4, extent = angle === 0 ? 110 : 65;
      let path = attitudeLine(-extent, y, -25, y) + attitudeLine(25, y, extent, y);
      if (angle !== 0) path += attitudeLine(-65, y+5, -65, y) + attitudeLine(65, y, 65, y+5);
      if (angle < 0) dashedLadder += path; else ladder += path;
      const text = (x: number) => {
        const point = attitudePoint(x, y+4);
        return point.x >= 180 && point.x <= 420 && point.y >= 75 && point.y <= 325 ? affine(point.x, point.y, rotation) : '';
      };
      const left = text(-88), right = text(80);
      if (left || right) labels.push({ angle, left, right });
    }
    const clip = [[180,75], [420,75], [420,325], [180,325]].map(([x,y]) => {
      const point = project(x,y); return `${point.x},${point.y}`;
    }).join(' ');
    const marker = line(265,200,288,200) + line(288,200,300,208) + line(300,208,312,200) + line(312,200,335,200)
      + line(300,185,300,193) + line(285,62,300,72) + line(300,72,315,62);
    return {
      width: this.width, height: this.height, clip, marker, ladder, dashedLadder, labels,
      speedLabel: affine(78,175), speed: affine(78,205), altitudeLabel: affine(520,175), altitude: affine(520,205),
      clearance: affine(300,352), stall: affine(300,110),
    };
  }

  private followCamera(dt: number, immediate: boolean): void {
    if (!immediate && !this.simulation?.ended && !this.controls.enabled && this.followInitialized) {
      this.camera.position.copy(this.followPosition);
      this.target.copy(this.followTarget);
    }
    if (this.simulation?.ended) {
      if (!this.resultOrbit) {
        this.resultOrbit = true;
        this.resultOffset.subVectors(this.camera.position, this.aircraft.position);
        this.resultTarget.copy(this.controls.enabled ? this.controls.target : this.target);
        this.controls.enabled = false;
        this.cameraYaw = this.cameraPitch = 0;
      }
      if (!this.reducedMotion) this.resultOffset.applyAxisAngle(UP, dt * 0.12);
      this.camera.position.copy(this.aircraft.position).add(this.resultOffset);
      this.resultTarget.lerp(this.aircraft.position, 1 - Math.exp(-dt * 0.8));
      this.target.copy(this.resultTarget);
      this.camera.up.copy(UP);
      this.camera.lookAt(this.target);
      return;
    }
    if (this.controls.enabled) {
      if (this.view === 'free') {
        if (this.followInitialized) {
          this.vector.subVectors(this.aircraft.position, this.followPosition);
          this.camera.position.add(this.vector);
          this.controls.target.add(this.vector);
        }
        this.followPosition.copy(this.aircraft.position);
        this.followInitialized = true;
      }
      return;
    }
    const sim = this.simulation;
    if (!sim) return;
    const pilot = this.view === 'pilot';
    if (pilot || this.view === 'locked') {
      const headDt = Math.max(0, Math.min(0.1, sim.elapsedTime - this.headTime));
      this.headTime = sim.elapsedTime;
      this.vector.copy(sim.telemetry.specificForce ?? this.vector.copy(sim.telemetry.force).divideScalar(sim.mass)).applyQuaternion(this.headInverse.copy(this.aircraft.quaternion).invert());
      this.vector.y -= 9.81;
      this.vector.multiplyScalar(-0.0018).clampScalar(-0.06, 0.06);
      if (this.reducedMotion) this.headOffset.set(0, 0, 0);
      else this.headOffset.lerp(this.vector, 1 - Math.exp(-headDt * 8));
    }
    if (this.view === 'chase' || this.view === 'locked') {
      this.vector.set(1, 0, 0).applyQuaternion(this.aircraft.quaternion);
      this.vector2.copy(UP).applyQuaternion(this.aircraft.quaternion);
      const distance = Math.max(23, this.definition.mainWing.points[1].y * 1.8 / Math.max(0.65, this.width / this.height));
      this.desiredPosition.copy(this.aircraft.position).addScaledVector(this.vector, -distance).addScaledVector(this.vector2, distance * 0.065);
      this.desiredTarget.copy(this.aircraft.position).addScaledVector(this.vector, 6).add(this.vector2);
      const blend = immediate || this.reducedMotion ? 1 : 1 - Math.exp(-dt * (this.view === 'locked' ? 12 : 3.5));
      this.camera.position.lerp(this.desiredPosition, blend);
      this.target.lerp(this.desiredTarget, blend);
      this.camera.up.lerp(this.vector2, blend).normalize();
      this.camera.lookAt(this.target);
      return;
    }
    if (pilot) {
      this.desiredPosition.set(this.definition.cockpit.position + 0.79, 0.32, 0).add(this.headOffset);
      this.desiredTarget.copy(this.desiredPosition).add(this.vector.set(35, 0, 0));
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
    const blend = immediate || pilot || this.reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
    this.camera.position.lerp(this.desiredPosition, blend);
    this.target.lerp(this.desiredTarget, blend);
    this.camera.up.copy(pilot ? this.vector.copy(UP).applyQuaternion(this.aircraft.quaternion) : UP);
    this.camera.lookAt(this.target);
  }

  private updateCameraInteraction(dt: number): void {
    // Editing disables OrbitControls; do not mistake that for a flight camera orbit.
    if (!this.simulation || this.editorPointerId >= 0) return;
    if (this.view === 'free' && !this.resultOrbit) return;
    const returning = !this.cameraDragging && this.elapsed - this.cameraReleasedAt > 3;
    const blend = 1 - Math.exp(-dt * 0.35);
    if (this.controls.enabled) {
      if (returning) {
        this.camera.position.lerp(this.cameraHome, blend);
        this.controls.target.lerp(this.targetHome, blend);
        this.controls.update();
      }
      return;
    }
    if (returning) {
      this.cameraYaw *= 1 - blend;
      this.cameraPitch *= 1 - blend;
    }
    this.followPosition.copy(this.camera.position);
    this.followTarget.copy(this.target);
    this.followInitialized = true;
    const pilot = this.view === 'pilot' && !this.resultOrbit;
    this.vector.subVectors(pilot ? this.target : this.camera.position, pilot ? this.camera.position : this.target);
    this.vector.applyAxisAngle(this.camera.up, this.cameraYaw);
    this.vector2.crossVectors(this.camera.up, this.vector).normalize();
    this.vector.applyAxisAngle(this.vector2, this.cameraPitch);
    if (pilot) this.target.copy(this.camera.position).add(this.vector);
    else this.camera.position.copy(this.target).add(this.vector);
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

  private wingTipWorld(side: number, out: THREE.Vector3): THREE.Vector3 {
    for (const section of this.wingSections[0]) {
      if (section.side !== side || section.next) continue;
      out.fromBufferAttribute(this.wingMeshes[0].geometry.getAttribute('position'), section.vertexStart + section.rows * 32 + 16);
      const fragment = this.fragmentRender(section.bodyId);
      if (fragment) return out.applyQuaternion(fragment.mesh.quaternion).add(fragment.mesh.position);
      return out.sub(this.renderCG).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
    }
    return out.copy(this.aircraft.position);
  }

  private recordWingTrail(): void {
    const sim = this.simulation;
    if (!sim || sim.result || sim.telemetry.stall) {
      this.clearWingTrail();
      return;
    }
    const strength = clamp((sim.telemetry.speed - 9) / 12, 0, 1);
    if (sim.time < this.wingTrailTime || sim.time - this.wingTrailTime > 0.15) this.clearWingTrail();
    this.wingTrail.material.opacity = 0.95;
    const sample = this.wingTrailTime !== sim.time;
    this.wingTrailTime = sim.time;
    this.wingTrailActive = true;
    const capacity = WING_TRAIL_CAPACITY + 1;
    if (sample) {
      this.wingTrailIndex = (this.wingTrailIndex + 1) % capacity;
      this.wingTrailCount = Math.min(capacity, this.wingTrailCount + 1);
      for (let side = 0; side < 2; side++) {
        this.wingTipWorld(side === 0 ? -1 : 1, this.wingTrailPoint);
        this.wingTrailPoint.toArray(this.wingTrailHistory, this.wingTrailIndex * 6 + side * 3);
      }
    }
    this.wingTrailLengths.fill(0);
    for (let age = 1; age < this.wingTrailCount; age++) {
      const recent = (this.wingTrailIndex - age + 1 + capacity) % capacity;
      const older = (this.wingTrailIndex - age + capacity) % capacity;
      for (let side = 0; side < 2; side++) {
        this.wingTrailPoint.fromArray(this.wingTrailHistory, recent * 6 + side * 3);
        this.wingTrailOlder.fromArray(this.wingTrailHistory, older * 6 + side * 3);
        this.wingTrailLengths[side] += this.wingTrailPoint.distanceTo(this.wingTrailOlder);
      }
    }
    this.wingTrailDistances.fill(0);
    let offset = 0, colorOffset = 0;
    for (let age = 1; age < this.wingTrailCount; age++) {
      const recent = (this.wingTrailIndex - age + 1 + capacity) % capacity;
      const older = (this.wingTrailIndex - age + capacity) % capacity;
      for (let side = 0; side < 2; side++) {
        this.wingTrailPoint.fromArray(this.wingTrailHistory, recent * 6 + side * 3);
        if (recent === this.wingTrailIndex) {
          this.wingTipWorld(side === 0 ? -1 : 1, this.wingTrailPoint);
        }
        this.wingTrailOlder.fromArray(this.wingTrailHistory, older * 6 + side * 3);
        this.vector.copy(this.wingTrailOlder).sub(this.wingTrailPoint);
        if (this.vector.lengthSq() < 1e-12) continue;
        const length = Math.min(18 + strength * 42, this.wingTrailLengths[side]);
        let distance = this.wingTrailDistances[side];
        if (distance >= length) continue;
        const segmentLength = Math.min(this.vector.length(), length - distance);
        this.wingTrailOlder.copy(this.wingTrailPoint).addScaledVector(this.vector, segmentLength / this.vector.length());
        const endDistance = distance + segmentLength;
        this.wingTrailDistances[side] = endDistance;
        const gap = 0.1 + Math.max(0, sim.telemetry.speed - 10) * 0.03;
        if (endDistance <= gap) continue;
        if (distance < gap) {this.wingTrailPoint.lerp(this.wingTrailOlder,(gap-distance)/segmentLength);distance=gap;}
        this.vector2.copy(this.camera.position).sub(this.wingTrailPoint);
        this.wingTrailWidth.crossVectors(this.vector, this.vector2);
        if (this.wingTrailWidth.lengthSq() < 1e-12) this.wingTrailWidth.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        const pixelWidth = this.camera === this.orthographic
          ? (this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom / this.height
          : 2 * this.vector2.length() * Math.tan(this.perspective.fov * DEG / 2) / this.height;
        this.wingTrailWidth.normalize().multiplyScalar(Math.max(0.012 + strength * 0.022, pixelWidth * 0.45));
        // Two camera-facing triangles per segment; width never depends on WebGL lineWidth.
        for (let vertex = 0; vertex < 6; vertex++) {
          const start = vertex === 0 || vertex === 1 || vertex === 3;
          const sign = vertex === 0 || vertex === 3 || vertex === 5 ? -1 : 1;
          const vertexDistance = start ? distance : endDistance;
          const taper = clamp((vertexDistance-gap)/Math.max(6,length*0.3),0,1)*clamp((length-vertexDistance)/Math.max(10,length*0.5),0,1);
          const point = start ? this.wingTrailPoint : this.wingTrailOlder;
          for (let axis = 0; axis < 3; axis++) {
            this.wingTrailArray[offset++] = point.getComponent(axis) + this.wingTrailWidth.getComponent(axis) * sign * taper;
            this.wingTrailColors[colorOffset++] = 1;
          }
          this.wingTrailColors[colorOffset++] = taper;
        }
      }
    }
    this.wingTrailGeometry.setDrawRange(0, offset / 3);
    this.wingTrail.visible = offset > 0;
    const attribute = this.wingTrailGeometry.getAttribute('position') as THREE.BufferAttribute;
    attribute.clearUpdateRanges(); attribute.addUpdateRange(0, offset); attribute.needsUpdate = true;
    const colors = this.wingTrailGeometry.getAttribute('color') as THREE.BufferAttribute;
    colors.clearUpdateRanges(); colors.addUpdateRange(0, colorOffset); colors.needsUpdate = true;
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
        const fragment = this.fragmentRender(surface.bodyId);
        if (fragment) marker.position.copy(surface.point).sub(fragment.cg).applyQuaternion(fragment.mesh.quaternion).add(fragment.mesh.position);
        else marker.position.copy(surface.point).sub(this.renderCG).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);
        this.setArrow(this.arrows[i + 4], marker.position, surface.force, 0.007);
      } else {
        this.arrows[i + 4].visible = false;
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
    this.splashSurface = this.environmentChallenge === 'low-altitude' ? challengeRiverHeight(position.x) : 0;
    this.splash.visible = this.ring.visible = true;
    this.ring.position.set(position.x, this.splashSurface + 0.035, position.z);
    for (let i = 0; i < PARTICLES; i++) {
      const index = i * 3, angle = i * 2.399963;
      const speed = 1.4 + (i % 7) * 0.4;
      this.splashPositions[index] = position.x;
      this.splashPositions[index + 1] = this.splashSurface + 0.08;
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
      this.splashPositions[index + 1] = Math.max(this.splashSurface + 0.015, this.splashPositions[index + 1] + this.splashVelocities[index + 1] * dt);
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
    const buffers = new Set<ArrayBufferLike>();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (object instanceof THREE.InstancedMesh) bytes += object.instanceMatrix.array.byteLength;
      if (mesh.geometry && !geometries.has(mesh.geometry)) {
        geometries.add(mesh.geometry);
        for (const attribute of Object.values(mesh.geometry.attributes)) {
          if (!buffers.has(attribute.array.buffer)) { buffers.add(attribute.array.buffer); bytes += attribute.array.byteLength; }
        }
        const index = mesh.geometry.index;
        if (index && !buffers.has(index.array.buffer)) { buffers.add(index.array.buffer); bytes += index.array.byteLength; }
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
