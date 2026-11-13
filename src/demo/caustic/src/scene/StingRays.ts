import { AnimationAction, AnimationClip, AnimationMixer, Euler, Group, MathUtils, Material, Object3D, Vector2, Vector3 } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';
import { CausticField } from './CausticField';
import { applyCausticMaterials, createRandom, loadModel, measure, OBSTACLES, pushOutOfObstacles, steerAround } from './Creatures';
import { floorHeight, ROOM_RADIUS } from './Rotunda';

const WINGSPAN = 1.5;
const WALL_RADIUS = ROOM_RADIUS - 1.4;
const ROAM_MIN = 3.0;
const ROAM_MAX = WALL_RADIUS - 0.4;
const CAMERA_SHY = 2.6;
const SHARK_SHY = 3.6;
/** Offsets along the heading at which the floor is sampled to decide how high to glide. */
const FOOTPRINT = [-0.5, 0, 0.4, 0.8, 1.2];

interface RayConfig {
  scale: number;
  hover: number;
  speed: number;
  angle: number;
  radius: number;
}

const CONFIGS: RayConfig[] = [
  { scale: 1.0, hover: 0.14, speed: 0.72, angle: 0.5, radius: 5.8 },
  { scale: 0.82, hover: 0.2, speed: 0.82, angle: 2.1, radius: 6.4 },
  { scale: 1.18, hover: 0.12, speed: 0.62, angle: 3.7, radius: 5.5 },
  { scale: 0.9, hover: 0.18, speed: 0.78, angle: 5.2, radius: 6.1 },
];

interface Ray {
  root: Group;
  mixer: AnimationMixer | null;
  action: AnimationAction | null;
  position: Vector3;
  heading: Vector2;
  target: Vector2;
  config: RayConfig;
  bodyRadius: number;
  speed: number;
  yaw: number;
  yawRate: number;
  push: Vector2;
  climb: number;
  bank: number;
  pitch: number;
  phase: number;
  targetAge: number;
}

/**
 * Sting rays gliding just above the stone floor. Each wanders between random spots of the terraces
 * and the dais, steering around columns, the plinth and one another, following the stepped floor,
 * and flaring away when the camera or the shark comes close.
 */
export class StingRays {
  readonly group = new Group();

  private readonly rays: Ray[] = [];
  private readonly random = createRandom(55120417);
  private readonly materials: Material[] = [];
  private readonly steer = new Vector2();
  private readonly desired = new Vector2();
  private readonly flee = new Vector2();
  private readonly push = new Vector2();
  private readonly euler = new Euler();
  private readonly offset = new Vector3();

  constructor(field: CausticField) {
    this.group.name = 'Sting rays';
    this.group.visible = false;
    for (const config of CONFIGS) {
      const x = Math.cos(config.angle) * config.radius;
      const z = Math.sin(config.angle) * config.radius;
      const ray: Ray = {
        root: new Group(),
        mixer: null,
        action: null,
        position: new Vector3(x, floorHeight(config.radius) + config.hover, z),
        heading: new Vector2(-Math.sin(config.angle), Math.cos(config.angle)),
        target: new Vector2(x, z),
        config,
        // Half the wingspan, so the wingtips clear columns as well as the body.
        bodyRadius: (WINGSPAN / 2) * config.scale * 0.92,
        speed: config.speed,
        yaw: config.angle + Math.PI / 2,
        yawRate: 0,
        push: new Vector2(),
        climb: 0,
        bank: 0,
        pitch: 0,
        phase: this.random() * Math.PI * 2,
        targetAge: 0,
      };
      this.pickTarget(ray);
      this.rays.push(ray);
    }
    loadModel('sting_ray', 'sting_ray_swimming.glb')
      .then((gltf) => this.setup(gltf.scene, gltf.animations, field))
      .catch((error) => console.warn('Sting ray model could not be loaded', error));
  }

  private setup(template: Object3D, clips: AnimationClip[], field: CausticField) {
    // Normalise the model to a fixed wingspan with its underside on the group's origin.
    const box = measure(template);
    const size = box.getSize(new Vector3());
    const unit = WINGSPAN / Math.max(size.x, size.z, 1e-3);
    const clip = clips[0] ?? null;
    this.materials.push(...applyCausticMaterials(template, field));

    for (const ray of this.rays) {
      const model = SkeletonUtils.clone(template);
      const scale = unit * ray.config.scale;
      const center = box.getCenter(new Vector3());
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      ray.root.add(model);
      this.group.add(ray.root);
      if (clip) {
        ray.mixer = new AnimationMixer(model);
        ray.action = ray.mixer.clipAction(clip);
        ray.action.play();
        ray.action.time = this.random() * clip.duration;
      }
    }
    this.group.visible = true;
  }

  /** A random roaming spot that is clear of every column and the plinth. */
  private pickTarget(ray: Ray) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const radius = ROAM_MIN + this.random() * (ROAM_MAX - ROAM_MIN);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const clear = OBSTACLES.every((o) => Math.hypot(o.x - x, o.z - z) > o.radius + ray.bodyRadius + 0.6);
      if (clear || attempt === 15) {
        ray.target.set(x, z);
        break;
      }
    }
    ray.targetAge = 0;
  }

  update(dt: number, time: number, camera: Vector3, shark: Vector3 | null) {
    if (dt <= 0) return;
    for (let i = 0; i < this.rays.length; i++) {
      const ray = this.rays[i];
      const position = ray.position;
      ray.targetAge += dt;
      if (Math.hypot(ray.target.x - position.x, ray.target.y - position.z) < 0.9 || ray.targetAge > 18) {
        this.pickTarget(ray);
      }

      // Desired heading: towards the roaming spot.
      this.desired.set(ray.target.x - position.x, ray.target.y - position.z);
      if (this.desired.lengthSq() < 1e-6) this.desired.copy(ray.heading);
      this.desired.normalize();

      // Obstacle avoidance: columns, plinth, the outer wall and each other.
      this.steer.set(0, 0);
      steerAround(position.x, position.z, ray.heading.x, ray.heading.y, ray.bodyRadius, 2.4, 0.35, this.steer);
      const radius = Math.hypot(position.x, position.z);
      if (radius > WALL_RADIUS) {
        const push = (radius - WALL_RADIUS) * 1.2;
        this.steer.x -= (position.x / radius) * push;
        this.steer.y -= (position.z / radius) * push;
      }
      for (let j = 0; j < this.rays.length; j++) {
        if (j === i) continue;
        const other = this.rays[j].position;
        const dx = position.x - other.x;
        const dz = position.z - other.z;
        const distance = Math.hypot(dx, dz);
        const comfort = 2.2 + ray.bodyRadius + this.rays[j].bodyRadius;
        if (distance < comfort && distance > 1e-3) {
          const closeness = 1 - distance / comfort;
          const strength = closeness * closeness * 2;
          this.steer.x += (dx / distance) * strength;
          this.steer.y += (dz / distance) * strength;
        }
      }

      // Shyness: flare away from the camera and from the shark.
      let alarm = 0;
      this.flee.set(0, 0);
      const threats: Array<[Vector3, number]> = shark ? [[camera, CAMERA_SHY], [shark, SHARK_SHY]] : [[camera, CAMERA_SHY]];
      for (const [threat, range] of threats) {
        this.offset.subVectors(position, threat);
        const distance = this.offset.length();
        if (distance < range && distance > 1e-3) {
          const fear = 1 - distance / range;
          alarm = Math.max(alarm, fear);
          this.flee.x += (this.offset.x / distance) * fear * 2.2;
          this.flee.y += (this.offset.z / distance) * fear * 2.2;
        }
      }

      // All avoidance is blended into one smoothed push, so it eases in and out instead of flicking the heading.
      this.push.set(this.steer.x * 2.2 + this.flee.x, this.steer.y * 2.2 + this.flee.y);
      ray.push.lerp(this.push, 1 - Math.exp(-2.2 * dt));
      this.desired.add(ray.push);
      if (this.desired.lengthSq() < 1e-6) this.desired.copy(ray.heading);
      this.desired.normalize();

      // Turn through a smoothed yaw rate: it ramps up and down, with no sudden starts or stops.
      let difference = Math.atan2(this.desired.x, this.desired.y) - ray.yaw;
      if (difference > Math.PI) difference -= Math.PI * 2;
      else if (difference < -Math.PI) difference += Math.PI * 2;
      const urgent = ray.push.lengthSq() > 0.09 || alarm > 0.1;
      const maxRate = urgent ? 1.0 : 0.55;
      ray.yawRate = MathUtils.damp(ray.yawRate, MathUtils.clamp(difference * 1.4, -maxRate, maxRate), 2.2, dt);
      ray.yaw += ray.yawRate * dt;
      const yaw = ray.yaw;
      ray.heading.set(Math.sin(yaw), Math.cos(yaw));

      ray.speed = MathUtils.damp(ray.speed, ray.config.speed * (1 + alarm * 0.6), 1.5, dt);
      position.x += ray.heading.x * ray.speed * dt;
      position.z += ray.heading.y * ray.speed * dt;
      pushOutOfObstacles(position, ray.bodyRadius);
      // Rays never overlap: a hard minimum spacing on top of the soft steering above.
      for (let j = 0; j < this.rays.length; j++) {
        if (j === i) continue;
        const other = this.rays[j];
        const dx = position.x - other.position.x;
        const dz = position.z - other.position.z;
        const distance = Math.hypot(dx, dz);
        const minimum = (ray.bodyRadius + other.bodyRadius) * 0.9;
        if (distance < minimum && distance > 1e-4) {
          const ease = Math.min(1, dt * 6) * 0.5;
          position.x += (dx / distance) * (minimum - distance) * ease;
          position.z += (dz / distance) * (minimum - distance) * ease;
        }
      }
      pushOutOfObstacles(position, ray.bodyRadius);

      // Follow the stepped floor: the highest tread under the whole footprint, from just behind to well
      // ahead, is the goal height. The ray glides there on a smoothed climb rate, so stairs become a ramp.
      let ground = 0;
      for (let k = 0; k < FOOTPRINT.length; k++) {
        const sx = position.x + ray.heading.x * FOOTPRINT[k];
        const sz = position.z + ray.heading.y * FOOTPRINT[k];
        ground = Math.max(ground, floorHeight(Math.hypot(sx, sz)));
      }
      const wanted = ground + ray.config.hover + Math.sin(time * 1.3 + ray.phase) * 0.03;
      const climbRate = MathUtils.clamp((wanted - position.y) * 1.6, -0.25, 0.25);
      ray.climb = MathUtils.damp(ray.climb, climbRate, 2.5, dt);
      position.y += ray.climb * dt;
      const floorY = floorHeight(Math.hypot(position.x, position.z)) + 0.03;
      // Never sink into the tread, but ease back up instead of snapping.
      if (position.y < floorY) position.y += (floorY - position.y) * Math.min(1, dt * 10);
      ray.pitch = MathUtils.damp(ray.pitch, MathUtils.clamp(-Math.atan2(ray.climb, Math.max(ray.speed, 0.2)), -0.3, 0.3), 3, dt);
      ray.bank = MathUtils.damp(ray.bank, MathUtils.clamp(ray.yawRate * -0.45, -0.35, 0.35), 2, dt);

      ray.root.position.copy(position);
      this.euler.set(ray.pitch, yaw, ray.bank, 'YXZ');
      ray.root.quaternion.setFromEuler(this.euler);
      if (ray.mixer && ray.action) {
        ray.action.timeScale = 0.8 + ray.speed * 0.6;
        ray.mixer.update(dt);
      }
    }
  }

  dispose() {
    this.materials.forEach((material) => material.dispose());
    this.rays.forEach((ray) => ray.mixer?.stopAllAction());
  }
}
