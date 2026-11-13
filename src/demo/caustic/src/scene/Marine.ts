import {
  BufferGeometry,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Object3D,
  StaticDrawUsage,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { createCausticMaterial } from './CausticMaterials';
import { createFishGeometry } from './FishGeometry';
import { createFishTextures } from './FishTexture';
import { CausticField, WATER_HEIGHT } from './CausticField';
import { COLUMNS, floorHeight, ROOM_RADIUS, TERRACE_COUNT, TERRACE_RISE, TERRACE_START, TERRACE_WIDTH } from './Rotunda';

interface SchoolConfig {
  radius: number;
  height: number;
  speed: number;
  hue: number;
  hueRange: number;
  spread: number;
  /** Stripe colour along the back and optional belly colour, as in the original schools. */
  accent: string;
  belly?: string;
}

/** Four schools circle the dais at different radii and depths, never touching the column ring. */
const SCHOOLS: SchoolConfig[] = [
  { radius: 3.4, height: 2.3, speed: 0.17, hue: 0.025, hueRange: 0.065, spread: 0.9, accent: '#e85c25' },
  { radius: 5.5, height: 3.5, speed: -0.13, hue: 0.55, hueRange: 0.045, spread: 1.0, accent: '#305ce5', belly: '#f37fb7' },
  { radius: 5.9, height: 2.7, speed: 0.11, hue: 0.3, hueRange: 0.055, spread: 0.65, accent: '#1b9139', belly: '#438de8' },
  { radius: 4.6, height: 3.9, speed: -0.19, hue: 0.145, hueRange: 0.025, spread: 0.9, accent: '#d7b51c', belly: '#ed791e' },
];
const SCHOOL_SIZE = 34;
/** Lone riders: amber, cyan and purple fish (hues cycle by index) cruising one ring low over the terraces. */
const REEF_FISH = 12;
const REEF_HUES = [0.12, 0.5, 0.88];
const REEF_RADIUS = 5.3;
const REEF_SPEED = 0.073;
const FISH_COUNT = SCHOOLS.length * SCHOOL_SIZE + REEF_FISH;
const TUFTS_AT_COLUMNS = 300;
const TUFTS_AT_TERRACES = 240;

/** Fish notice the camera and the shark at these distances and flee until the orbit carries them off. */
const CAMERA_NOTICE = 4.6;
const SHARK_NOTICE = 5.5;
const FLEE_SPRING = 1.1;
const FLEE_DAMPING = 2.2;
const MAX_FLEE_SPEED = 3.4;
const MAX_DISPLACEMENT = 3.2;
const COLUMN_CLEARANCE = 0.38;
/**
 * A fish cannot swim sideways: the part of its flight velocity that is not along its body decays at
 * SLIP_DAMPING per second (a keel), and the body turns toward its real motion at HEADING_RATE,
 * rising to FLEE_HEADING_RATE while it is bolting.
 */
const SLIP_DAMPING = 14;
const HEADING_RATE = 7;
const FLEE_HEADING_RATE = 16;
const MAX_TURN_RATE = 12;
/** A fish thrusts hard once its body is roughly turned away from the threat. */
const FLEE_THRUST_GAIN = 1.5;
/** Share of the flee push that may still act sideways. */
const FLEE_TURN_ASSIST = 0.3;
/** Seconds ahead the body aims: flee push (m/s^2) times this is added to the velocity it aims along. */
const FLEE_LEAD = 0.35;
/** Largest sideways speed of a fish as a share of its forward speed (about 31 degrees off its body axis). */
const LATERAL_LIMIT = 0.6;
/** Share of MAX_DISPLACEMENT beyond which a fish counts as tethered to its orbit point, and its turn rate then. */
const TETHER_START = 0.85;
const TETHERED_TURN_RATE = 40;

/** The shark's body runs from this far behind its centre to this far ahead of it (along its heading). */
const SHARK_TAIL = 1.3;
const SHARK_NOSE = 1.25;
/** Fish keep at least this far from the shark's body axis (body radius plus the fish's own size and fins). */
const SHARK_BODY_CLEARANCE = 0.75;

/** What the fish need to know about the shark: where it is, where it is heading and which way its body points. */
export interface Threat {
  position: Vector3;
  velocity: Vector3;
  forward?: Vector3;
}

function createRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Lowest height a fish may cruise at: a continuous ramp over the terrace steps, as in the original. */
function fishFloor(radius: number): number {
  return Math.max(0.2, TERRACE_RISE * (1 + (radius - TERRACE_START) / TERRACE_WIDTH));
}

/** Three crossed, tapered blades with a slight curl. Height is one unit along +y. */
function createAlgaeGeometry(): BufferGeometry {
  const segments = 5;
  const blades: BufferGeometry[] = [];
  for (let b = 0; b < 3; b++) {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const width = 0.055 * (1 - t * 0.85);
      const curl = 0.12 * t * t;
      positions.push(-width, t, curl, width, t, curl);
      normals.push(0, 0, 1, 0, 0, 1);
      uvs.push(0, t, 1, t);
      if (s < segments) {
        const a = s * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const blade = new BufferGeometry();
    blade.setAttribute('position', new Float32BufferAttribute(positions, 3));
    blade.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    blade.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    blade.setIndex(indices);
    blade.rotateY((b * Math.PI) / 3);
    blades.push(blade);
  }
  const merged = mergeGeometries(blades);
  blades.forEach((g) => g.dispose());
  if (!merged) {
    throw new Error('Unable to merge algae geometry');
  }
  return merged;
}

/** Fish schools, lone riders and algae tufts, lit by the caustic map like the rest of the room. */
export class Marine {
  readonly group = new Group();
  private readonly fish: InstancedMesh;
  private readonly algae: InstancedMesh;
  private readonly fishGeometry: BufferGeometry;
  private readonly algaeGeometry: BufferGeometry;
  private readonly fishTextures: { map: DataTexture; normalMap: DataTexture };
  private readonly dummy = new Object3D();
  private readonly basis = new Matrix4();
  private readonly position = new Vector3();
  private readonly ahead = new Vector3();
  private readonly direction = new Vector3();
  private readonly up = new Vector3();
  private readonly side = new Vector3();
  private readonly worldUp = new Vector3(0, 1, 0);
  private readonly offsets: Float32Array;
  private readonly scales: Float32Array;
  private readonly phases: Float32Array;
  /** Per-fish flight offset from the orbit (x, y, z), its velocity and the smoothed heading. */
  private readonly displacement: Float32Array;
  private readonly displacementVelocity: Float32Array;
  private readonly headings: Float32Array;
  private readonly homeVelocity = new Vector3();
  private readonly home = new Vector3();
  private readonly offset = new Vector3();
  private readonly flee = new Vector3();
  private readonly free = new Vector3();
  private readonly intent = new Vector3();
  private readonly removed = new Vector3();
  private readonly sharkAxis = new Vector3();
  private readonly sharkPoint = new Vector3();
  /** Stand-in camera position when the viewer is above the water: nothing is ever scared of it. */
  private readonly far = new Vector3(1e5, 1e5, 1e5);
  private readonly lateral = new Vector3();
  private readonly sharkForward = new Vector3();
  private readonly cameraVelocity = new Vector3();
  private readonly previousCamera = new Vector3();
  private hasPreviousCamera = false;
  private cameraSpeed = 0;
  private cameraStillTime = 0;

  constructor(field: CausticField) {
    this.group.name = 'Marine life';
    const random = createRandom(3763512237);

    this.fishGeometry = createFishGeometry();
    this.fishTextures = createFishTextures();
    this.offsets = new Float32Array(FISH_COUNT * 4);
    this.scales = new Float32Array(FISH_COUNT);
    this.phases = new Float32Array(FISH_COUNT);
    this.displacement = new Float32Array(FISH_COUNT * 3);
    this.displacementVelocity = new Float32Array(FISH_COUNT * 3);
    this.headings = new Float32Array(FISH_COUNT * 3);
    const schooled = SCHOOLS.length * SCHOOL_SIZE;
    for (let i = 0; i < FISH_COUNT; i++) {
      this.offsets.set([random() * 2 - 1, random() * 2 - 1, random() * 2 - 1, random() * Math.PI * 2], i * 4);
      // Lone riders are a little smaller than the schooling fish, as in the original.
      this.scales[i] = (i < schooled ? 0.5 + random() * 0.24 : 0.38 + random() * 0.2) * 1.1;
      this.phases[i] = random() * Math.PI * 2;
    }
    this.fishGeometry.setAttribute('aPhase', new InstancedBufferAttribute(this.phases, 1));

    const tints = new Float32Array(FISH_COUNT * 4);
    const accents = new Float32Array(FISH_COUNT * 3);
    const bellies = new Float32Array(FISH_COUNT * 3);
    const tint = new Color();
    const accent = new Color();
    const belly = new Color();
    for (let i = 0; i < FISH_COUNT; i++) {
      const schoolIndex = Math.floor(i / SCHOOL_SIZE);
      const school = schoolIndex < SCHOOLS.length ? SCHOOLS[schoolIndex] : null;
      if (school) {
        tint.setHSL(school.hue + random() * school.hueRange, 0.78, 0.5 + random() * 0.08);
        accent.set(school.accent);
        if (school.belly) belly.set(school.belly);
        else belly.copy(tint);
      } else {
        tint.setHSL(REEF_HUES[i % REEF_HUES.length], 0.78, 0.5 + random() * 0.08);
        accent.copy(tint);
        belly.copy(tint);
      }
      // Only the schools carry the extra glow that keeps them readable at depth.
      tints.set([tint.r, tint.g, tint.b, school ? 0.3 : 0], i * 4);
      accents.set([accent.r, accent.g, accent.b], i * 3);
      bellies.set([belly.r, belly.g, belly.b], i * 3);
    }
    this.fishGeometry.setAttribute('aTint', new InstancedBufferAttribute(tints, 4));
    this.fishGeometry.setAttribute('aAccent', new InstancedBufferAttribute(accents, 3));
    this.fishGeometry.setAttribute('aBelly', new InstancedBufferAttribute(bellies, 3));

    const fishMaterial = createCausticMaterial(field, {
      color: new Color(1, 1, 1),
      side: DoubleSide,
      wag: true,
      vertexColors: true,
      fishMap: this.fishTextures.map,
      normalMap: this.fishTextures.normalMap,
      normalScale: new Vector2(1, 1),
    });
    this.fish = new InstancedMesh(this.fishGeometry, fishMaterial, FISH_COUNT);
    this.fish.name = 'Fish schools and lone riders';
    this.fish.frustumCulled = false;
    this.fish.instanceMatrix.setUsage(DynamicDrawUsage);
    this.group.add(this.fish);

    this.algaeGeometry = createAlgaeGeometry();
    const algaeMaterial = createCausticMaterial(field, {
      color: new Color(1, 1, 1),
      side: DoubleSide,
      sway: true,
    });
    const tufts = TUFTS_AT_COLUMNS + TUFTS_AT_TERRACES;
    this.algae = new InstancedMesh(this.algaeGeometry, algaeMaterial, Math.max(1, tufts));
    this.algae.name = 'Algae';
    this.algae.frustumCulled = false;
    this.algae.instanceMatrix.setUsage(StaticDrawUsage);
    this.plantAlgae(random);
    this.group.add(this.algae);
  }

  private plantAlgae(random: () => number) {
    const dummy = this.dummy;
    const tint = new Color();
    for (let i = 0; i < this.algae.count; i++) {
      const atColumn = i < TUFTS_AT_COLUMNS;
      let x: number;
      let z: number;
      let tall = false;
      if (atColumn) {
        const site = COLUMNS[i % COLUMNS.length];
        const around = random() * Math.PI * 2;
        const spread = 0.55 + random() * 0.4;
        x = site.x + Math.cos(around) * spread;
        z = site.z + Math.sin(around) * spread;
        tall = random() < 0.3;
      } else {
        let angle = random() * Math.PI * 2;
        // Keep the foreground walkway clear.
        if (Math.cos(angle) > 0.65) angle += Math.PI / 2;
        const terrace = 4 + Math.floor(random() * (TERRACE_COUNT - 5));
        const radius = TERRACE_START + terrace * TERRACE_WIDTH + 0.08 + random() * 0.16;
        x = Math.sin(angle) * radius;
        z = Math.cos(angle) * radius;
      }
      const y = floorHeight(Math.hypot(x, z)) + 0.005;
      dummy.position.set(x, y, z);
      dummy.rotation.set((random() - 0.5) * 0.4, random() * Math.PI * 2, (random() - 0.5) * 0.5);
      dummy.scale.set(
        tall ? 0.9 + random() * 0.6 : 0.6 + random() * 0.7,
        tall ? 0.9 + random() * 0.9 : 0.2 + Math.pow(random(), 2) * 0.8,
        1
      );
      dummy.updateMatrix();
      this.algae.setMatrixAt(i, dummy.matrix);
      tint.setHSL(0.27 + random() * 0.1, 0.55, 0.22 + random() * 0.1);
      this.algae.setColorAt(i, tint);
    }
    this.algae.instanceMatrix.needsUpdate = true;
    if (this.algae.instanceColor) this.algae.instanceColor.needsUpdate = true;
  }

  /** World position of a fish at the given water-clock time. */
  private fishPosition(i: number, time: number, target: Vector3): Vector3 {
    const ox = this.offsets[i * 4];
    const oy = this.offsets[i * 4 + 1];
    const oz = this.offsets[i * 4 + 2];
    const seed = this.offsets[i * 4 + 3];
    const schoolIndex = Math.floor(i / SCHOOL_SIZE);
    if (schoolIndex < SCHOOLS.length) {
      const school = SCHOOLS[schoolIndex];
      const angle = school.speed * time + schoolIndex * 1.7;
      const wobble = 1 + 0.3 * Math.sin(time * 0.7 + seed);
      const radius = school.radius + ox * school.spread * wobble + 0.25 * Math.sin(time * 0.31 + schoolIndex);
      const height = school.height + 0.45 * Math.sin(time * 0.23 + schoolIndex * 2.0) + oy * 0.55 * wobble;
      const lateral = angle + (oz * school.spread * 0.9) / school.radius + 0.12 * Math.sin(time * 0.5 + seed);
      return target.set(Math.cos(lateral) * radius, height, Math.sin(lateral) * radius);
    }
    // Lone riders: one ring of evenly spaced fish, each on its own lane, hugging the terrace ramp.
    const k = i - SCHOOLS.length * SCHOOL_SIZE;
    const angle = time * REEF_SPEED + (k / REEF_FISH) * Math.PI * 2;
    const lane = (((k * 5) % REEF_FISH) / (REEF_FISH - 1) - 0.5) * 1.8;
    const radius = REEF_RADIUS + lane + Math.sin(time * 0.23 + seed) * 0.18;
    const height = fishFloor(radius) + 0.75 + 0.12 * Math.sin(time * 0.37 + seed);
    return target.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius);
  }

  /**
   * Closest point to `at` on the shark's body axis (tail to nose), written to this.sharkPoint.
   * Without a known heading the shark counts as a point at its centre.
   */
  private nearestSharkPoint(at: Vector3, shark: Threat): Vector3 {
    const axis = this.sharkAxis;
    if (shark.forward && shark.forward.lengthSq() > 1e-6) axis.copy(shark.forward).normalize();
    else if (shark.velocity.lengthSq() > 0.01) axis.copy(shark.velocity).normalize();
    else return this.sharkPoint.copy(shark.position);
    const along = this.lateral.subVectors(at, shark.position).dot(axis);
    return this.sharkPoint.copy(shark.position).addScaledVector(axis, MathUtils.clamp(along, -SHARK_TAIL, SHARK_NOSE));
  }

  /** Keep a fleeing fish inside the water, away from the shark's body, columns and the outer wall, above the floor. */
  private constrain(p: Vector3, shark?: Threat) {
    if (shark) {
      // The shark's whole body is solid to a fish: whatever its flight and orbit say, it never swims through it.
      const nearest = this.nearestSharkPoint(p, shark);
      const dx = p.x - nearest.x;
      const dy = p.y - nearest.y;
      const dz = p.z - nearest.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < SHARK_BODY_CLEARANCE) {
        if (distance > 1e-4) {
          const k = SHARK_BODY_CLEARANCE / distance;
          p.set(nearest.x + dx * k, nearest.y + dy * k, nearest.z + dz * k);
        } else {
          // Exactly on the axis: leave sideways.
          this.side.crossVectors(this.sharkAxis, this.worldUp);
          if (this.side.lengthSq() < 1e-6) this.side.set(1, 0, 0);
          p.addScaledVector(this.side.normalize(), SHARK_BODY_CLEARANCE);
        }
      }
    }
    for (const column of COLUMNS) {
      const dx = p.x - column.x;
      const dz = p.z - column.z;
      const distance = Math.hypot(dx, dz);
      const minimum = column.radius + COLUMN_CLEARANCE;
      if (distance < minimum) {
        const scale = distance > 1e-4 ? minimum / distance : 0;
        p.x = column.x + (distance > 1e-4 ? dx * scale : minimum);
        p.z = column.z + dz * scale;
      }
    }
    const radius = Math.hypot(p.x, p.z);
    const wall = ROOM_RADIUS - 1.3;
    if (radius > wall) {
      p.x *= wall / radius;
      p.z *= wall / radius;
    }
    const floor = Math.max(fishFloor(Math.hypot(p.x, p.z)), floorHeight(Math.hypot(p.x, p.z))) + 0.2;
    p.y = MathUtils.clamp(p.y, floor, WATER_HEIGHT - 0.5);
  }

  /**
   * Track how fast the camera moves and how long it has been still: a viewer who holds still is
   * gradually trusted, a moving one spooks the fish from further away.
   */
  private trackCamera(camera: Vector3, dt: number) {
    if (dt <= 0) return;
    if (!this.hasPreviousCamera) {
      this.previousCamera.copy(camera);
      this.hasPreviousCamera = true;
    }
    this.cameraVelocity.subVectors(camera, this.previousCamera).divideScalar(dt).clampLength(0, 8);
    this.previousCamera.copy(camera);
    this.cameraSpeed = this.cameraVelocity.length();
    if (this.cameraSpeed < 0.075) this.cameraStillTime += dt;
    else if (this.cameraSpeed > 0.65) this.cameraStillTime = 0;
    else this.cameraStillTime = Math.max(0, this.cameraStillTime - dt * 2.8);
  }

  /** Add the fear-driven acceleration of fish `i` (currently at `at`) into `this.flee`. */
  private accumulateFear(at: Vector3, camera: Vector3, shark: Threat | undefined, calm: number) {
    this.flee.set(0, 0, 0);

    // Camera: personal space is always respected, wider panic fades as the viewer settles.
    this.offset.subVectors(at, camera);
    const cameraDistance = this.offset.length();
    const notice = CAMERA_NOTICE + Math.min(this.cameraSpeed * 0.45, 2.5);
    if (cameraDistance < notice && cameraDistance > 1e-3) {
      const panic = Math.sqrt(1 - MathUtils.smoothstep(cameraDistance, 0.9, notice));
      const personalSpace = 1 - MathUtils.smoothstep(cameraDistance, 0.6, 1.8);
      const fear = Math.max(personalSpace, panic * (1 - calm * 0.7));
      this.flee.addScaledVector(this.offset, (fear * (9 + Math.min(this.cameraSpeed * 0.9, 4))) / cameraDistance);
      if (this.cameraSpeed > 0.2) this.flee.addScaledVector(this.cameraVelocity, -fear * 0.3);
    }

    // Shark: flee radially, and sideways out of its path when it is bearing down on the fish.
    if (shark) {
      // Distance is measured to the shark's body, not its centre, so a fish beside its tail also bolts.
      this.offset.subVectors(at, this.nearestSharkPoint(at, shark));
      const sharkDistance = this.offset.length();
      if (sharkDistance < SHARK_NOTICE && sharkDistance > 1e-3) {
        const panic = Math.sqrt(1 - MathUtils.smoothstep(sharkDistance, 0.8, SHARK_NOTICE));
        this.offset.multiplyScalar(1 / sharkDistance);
        let threat = 1;
        if (shark.velocity.lengthSq() > 0.01) {
          this.sharkForward.copy(shark.velocity).normalize();
          const headingDot = -this.sharkForward.dot(this.offset);
          if (headingDot > 0.1) {
            threat = 1 + headingDot * 1.8;
            this.lateral.crossVectors(this.worldUp, this.sharkForward).normalize();
            if (this.lateral.dot(this.offset) < 0) this.lateral.negate();
            this.flee.addScaledVector(this.lateral, panic * threat * 7);
          }
        }
        this.flee.addScaledVector(this.offset, panic * threat * 14);
      }
    }
  }

  /**
   * Fish follow their orbits; on top of that each carries a flight offset that springs back to
   * zero and is kicked away from the camera and the shark. Columns, the outer wall, the floor
   * and the water surface are respected, so fleeing fish never leave the water or enter stone.
   */
  update(time: number, dt = 0, camera?: Vector3, shark?: Threat) {
    if (camera) this.trackCamera(camera, dt);
    const calm = MathUtils.smoothstep(this.cameraStillTime, 1.6, 5.2);
    const underwater = !!camera && camera.y < WATER_HEIGHT - 0.1;
    const displacement = this.displacement;
    const velocity = this.displacementVelocity;

    for (let i = 0; i < FISH_COUNT; i++) {
      this.fishPosition(i, time, this.home);
      this.fishPosition(i, time + 0.05, this.ahead);
      this.homeVelocity.subVectors(this.ahead, this.home).multiplyScalar(20);

      const i3 = i * 3;
      // How strongly the fish is steering its body toward an escape direction this frame (0..1).
      let steer = 0;
      let pushStrength = 0;
      this.removed.set(0, 0, 0);
      const startX = displacement[i3];
      const startY = displacement[i3 + 1];
      const startZ = displacement[i3 + 2];
      // Near the edge of its flight range the fish is tethered to its moving orbit point and gets dragged
      // along with it, so the body simply has to follow that real motion.
      const tethered = Math.hypot(startX, startY, startZ) > MAX_DISPLACEMENT * TETHER_START;
      if (dt > 0) {
        const hx = this.headings[i3];
        const hy = this.headings[i3 + 1];
        const hz = this.headings[i3 + 2];
        let ax = -FLEE_SPRING * displacement[i3] - FLEE_DAMPING * velocity[i3];
        let ay = -FLEE_SPRING * displacement[i3 + 1] - FLEE_DAMPING * velocity[i3 + 1];
        let az = -FLEE_SPRING * displacement[i3 + 2] - FLEE_DAMPING * velocity[i3 + 2];
        if (underwater || shark) {
          this.position.set(
            this.home.x + displacement[i3],
            this.home.y + displacement[i3 + 1],
            this.home.z + displacement[i3 + 2]
          );
          this.accumulateFear(this.position, camera && underwater ? camera : this.far, shark, calm);
          // Fish keep to their depth: vertical flight is much weaker than horizontal.
          const fx = this.flee.x;
          const fy = this.flee.y * 0.45;
          const fz = this.flee.z;
          const magnitude = Math.hypot(fx, fy, fz);
          if (magnitude > 1e-3 && (hx !== 0 || hy !== 0 || hz !== 0)) {
            // A fish cannot be shoved sideways: it thrusts along its body, in proportion to how well the
            // body already points away from the threat, and turns toward the escape direction.
            this.intent.set(fx / magnitude, fy / magnitude, fz / magnitude);
            const alignment = hx * this.intent.x + hy * this.intent.y + hz * this.intent.z;
            const thrust = magnitude * FLEE_THRUST_GAIN * MathUtils.clamp((alignment + 0.35) / 1.35, 0, 1);
            const assist = magnitude * FLEE_TURN_ASSIST;
            ax += hx * thrust + this.intent.x * assist;
            ay += hy * thrust + this.intent.y * assist;
            az += hz * thrust + this.intent.z * assist;
            steer = 1;
            pushStrength = magnitude;
          } else {
            ax += fx;
            ay += fy;
            az += fz;
          }
        }
        velocity[i3] += ax * dt;
        velocity[i3 + 1] += ay * dt;
        velocity[i3 + 2] += az * dt;
        if (hx !== 0 || hy !== 0 || hz !== 0) {
          // Remove the sideways part of the motion (relative to the body axis) from the flight velocity.
          this.lateral.set(
            this.homeVelocity.x + velocity[i3],
            this.homeVelocity.y + velocity[i3 + 1],
            this.homeVelocity.z + velocity[i3 + 2]
          );
          const along = this.lateral.x * hx + this.lateral.y * hy + this.lateral.z * hz;
          const keel = 1 - Math.exp(-SLIP_DAMPING * dt);
          velocity[i3] -= (this.lateral.x - along * hx) * keel;
          velocity[i3 + 1] -= (this.lateral.y - along * hy) * keel;
          velocity[i3 + 2] -= (this.lateral.z - along * hz) * keel;
          if (!tethered) this.confineToBody(i3);
        }
        this.offset.set(velocity[i3], velocity[i3 + 1], velocity[i3 + 2]).clampLength(0, MAX_FLEE_SPEED);
        velocity[i3] = this.offset.x;
        velocity[i3 + 1] = this.offset.y;
        velocity[i3 + 2] = this.offset.z;
        displacement[i3] += velocity[i3] * dt;
        displacement[i3 + 1] += velocity[i3 + 1] * dt;
        displacement[i3 + 2] += velocity[i3 + 2] * dt;
        this.offset.set(displacement[i3], displacement[i3 + 1], displacement[i3 + 2]);
        if (this.offset.length() > MAX_DISPLACEMENT) {
          this.offset.setLength(MAX_DISPLACEMENT);
          displacement[i3] = this.offset.x;
          displacement[i3 + 1] = this.offset.y;
          displacement[i3 + 2] = this.offset.z;
          // At the edge of its flight range the fish no longer moves outward, so neither does its velocity.
          this.offset.normalize();
          const outward = velocity[i3] * this.offset.x + velocity[i3 + 1] * this.offset.y + velocity[i3 + 2] * this.offset.z;
          if (outward > 0) {
            velocity[i3] -= outward * this.offset.x;
            velocity[i3 + 1] -= outward * this.offset.y;
            velocity[i3 + 2] -= outward * this.offset.z;
          }
        }
        // The velocity is what the fish really did this frame, whatever the range limit made of its plan.
        velocity[i3] = (displacement[i3] - startX) / dt;
        velocity[i3 + 1] = (displacement[i3 + 1] - startY) / dt;
        velocity[i3 + 2] = (displacement[i3 + 2] - startZ) / dt;
        if (!tethered) this.confineToBody(i3);
      }

      this.position.set(this.home.x + displacement[i3], this.home.y + displacement[i3 + 1], this.home.z + displacement[i3 + 2]);
      this.free.copy(this.position);
      this.constrain(this.position, shark);
      if (dt > 0) {
        // A fish blocked by stone, wall or floor loses the velocity it pushed into the obstacle (it
        // slides along it) instead of straining against it while its body points the wrong way.
        velocity[i3] += (this.position.x - this.free.x) / dt;
        velocity[i3 + 1] += (this.position.y - this.free.y) / dt;
        velocity[i3 + 2] += (this.position.z - this.free.z) / dt;
        // The clamps may have left the fish moving sideways or tail-first; confine it again.
        if (!tethered) this.confineToBody(i3);
      }
      // Keep the stored offset consistent with what the constraints allowed.
      displacement[i3] = this.position.x - this.home.x;
      displacement[i3 + 1] = this.position.y - this.home.y;
      displacement[i3 + 2] = this.position.z - this.home.z;

      // Heading follows the actual motion (orbit plus flight), eased so turns stay smooth.
      this.direction.set(
        this.homeVelocity.x + velocity[i3],
        this.homeVelocity.y + velocity[i3 + 1],
        this.homeVelocity.z + velocity[i3 + 2]
      );
      if (steer > 0) {
        // A fish held back (at the edge of its flight range or against an obstacle) cannot go where it
        // wants to, so its body follows its real motion instead.
        const range = Math.hypot(displacement[i3], displacement[i3 + 1], displacement[i3 + 2]);
        steer *= 1 - MathUtils.smoothstep(range, MAX_DISPLACEMENT * 0.8, MAX_DISPLACEMENT);
        if (this.free.distanceToSquared(this.position) > 1e-8) steer = 0;
      }
      // A fleeing fish aims its body at where the push is about to take it: its motion plus the escape
      // direction scaled by the push strength (a gentle nudge barely turns it, a bolt turns it fully).
      if (steer > 0) this.direction.addScaledVector(this.intent, steer * pushStrength * FLEE_LEAD);
      // Where the fish wants to go includes the motion the body could not follow, so it still turns toward it.
      this.direction.add(this.removed);
      if (this.direction.lengthSq() < 1e-10) this.direction.set(1, 0, 0);
      this.direction.normalize();
      const heading = this.headings;
      if (heading[i3] === 0 && heading[i3 + 1] === 0 && heading[i3 + 2] === 0) {
        heading[i3] = this.direction.x;
        heading[i3 + 1] = this.direction.y;
        heading[i3 + 2] = this.direction.z;
      } else {
        const bolting = MathUtils.smoothstep(Math.hypot(velocity[i3], velocity[i3 + 1], velocity[i3 + 2]), 0.3, 1.6);
        let mix = dt > 0 ? 1 - Math.exp(-MathUtils.lerp(HEADING_RATE, FLEE_HEADING_RATE, bolting) * dt) : 0;
        this.offset.set(heading[i3], heading[i3 + 1], heading[i3 + 2]);
        // A body only turns so fast, however sharp the escape.
        const turn = Math.acos(MathUtils.clamp(this.offset.dot(this.direction), -1, 1));
        if (turn > 1e-4) mix = Math.min(mix, ((tethered ? TETHERED_TURN_RATE : MAX_TURN_RATE) * dt) / turn);
        if (turn > 2.6) {
          // Turning about face: a straight lerp would collapse through zero, so turn about the vertical axis.
          this.side.crossVectors(this.offset, this.worldUp);
          if (this.side.lengthSq() < 1e-6) this.side.set(0, 0, 1);
          this.direction.addScaledVector(this.side.normalize(), 1.2).normalize();
        }
        this.offset.lerp(this.direction, mix);
        if (this.offset.lengthSq() < 1e-4) this.offset.copy(this.direction);
        this.offset.normalize();
        heading[i3] = this.offset.x;
        heading[i3 + 1] = this.offset.y;
        heading[i3 + 2] = this.offset.z;
      }
      this.direction.set(heading[i3], heading[i3 + 1], heading[i3 + 2]);
      this.side.crossVectors(this.direction, this.worldUp);
      if (this.side.lengthSq() < 1e-8) this.side.set(0, 0, 1);
      this.side.normalize();
      this.up.crossVectors(this.side, this.direction).normalize();
      this.basis.makeBasis(this.direction, this.up, this.side);
      this.dummy.position.copy(this.position);
      this.dummy.quaternion.setFromRotationMatrix(this.basis);
      this.dummy.scale.setScalar(this.scales[i]);
      this.dummy.updateMatrix();
      this.fish.setMatrixAt(i, this.dummy.matrix);
    }
    this.fish.instanceMatrix.needsUpdate = true;
  }

  /**
   * A fish only swims head-first: its net motion (orbit plus flight) may not point backwards along its body,
   * and its sideways part may not exceed LATERAL_LIMIT times its forward speed. Whatever is cut off is added
   * to this.removed, so the body still turns toward where the fish wanted to go.
   */
  private confineToBody(i3: number) {
    const hx = this.headings[i3];
    const hy = this.headings[i3 + 1];
    const hz = this.headings[i3 + 2];
    if (hx === 0 && hy === 0 && hz === 0) return;
    const velocity = this.displacementVelocity;
    const nx = this.homeVelocity.x + velocity[i3];
    const ny = this.homeVelocity.y + velocity[i3 + 1];
    const nz = this.homeVelocity.z + velocity[i3 + 2];
    const along = nx * hx + ny * hy + nz * hz;
    const lx = nx - along * hx;
    const ly = ny - along * hy;
    const lz = nz - along * hz;
    const lateral = Math.hypot(lx, ly, lz);
    const forward = Math.max(along, 0);
    const allowed = forward * LATERAL_LIMIT;
    if (along >= 0 && lateral <= allowed) return;
    const k = lateral > allowed && lateral > 1e-9 ? allowed / lateral : 1;
    // New net motion: forward part along the body plus the clipped sideways part.
    const dx = forward * hx + lx * k - nx;
    const dy = forward * hy + ly * k - ny;
    const dz = forward * hz + lz * k - nz;
    velocity[i3] += dx;
    velocity[i3 + 1] += dy;
    velocity[i3 + 2] += dz;
    this.removed.x -= dx;
    this.removed.y -= dy;
    this.removed.z -= dz;
  }

  dispose() {
    this.fishGeometry.dispose();
    this.fishTextures.map.dispose();
    this.fishTextures.normalMap.dispose();
    this.algaeGeometry.dispose();
    (this.fish.material as { dispose(): void }).dispose();
    (this.algae.material as { dispose(): void }).dispose();
    this.fish.dispose();
    this.algae.dispose();
  }
}
