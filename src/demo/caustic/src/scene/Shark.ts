import { AnimationAction, AnimationClip, AnimationMixer, Group, MathUtils, Matrix4, Material, Object3D, Quaternion, Vector2, Vector3 } from 'three';
import { CausticField, WATER_HEIGHT } from './CausticField';
import { applyCausticMaterials, createRandom, loadModel, measure, pushOutOfObstacles, steerAround } from './Creatures';
import { floorHeight, ROOM_RADIUS } from './Rotunda';

type Mood = 'patrol' | 'pass' | 'retreat';

const SHARK_LENGTH = 2.8;
const BODY_RADIUS = 0.42;
/** Distance from the body centre to the snout, where the bite is aimed. */
const MOUTH = SHARK_LENGTH * 0.44;
const PATROL_RADIUS = 5.4;
const WALL_RADIUS = ROOM_RADIUS - 1.6;
const NOTICE_RADIUS = 8;
/** How far to the side of the viewer the shark glides by. */
const PASS_OFFSET = 2.6;
/** Inside this distance the shark steers away from the viewer. */
const PERSONAL_SPACE = 2.4;
/** Steepest climb or dive, as the sine of the pitch angle (about 22 degrees). */
const MAX_PITCH_SIN = 0.38;
const BITE_RANGE = 2.9;
const BITE_DURATION = 1.65;
const BITE_TIMESCALE = 0.85;
const UP = new Vector3(0, 1, 0);

/**
 * A curious but gracious shark. It patrols one ring between the dais and the columns; when the
 * camera comes close it glides by at a respectful distance on a long, gentle curve, maybe giving
 * one slow playful chomp as it passes, and then swims on and ignores the viewer for a while. It
 * steers around columns and the plinth and never leaves the water.
 */
export class Shark {
  readonly group = new Group();
  readonly position = new Vector3(PATROL_RADIUS, 3, 0);
  readonly velocity = new Vector3();

  /** Unit vector along the body, tail to nose; the fish use it to keep out of the shark's whole body. */
  readonly forward = new Vector3(0, 0, 1);
  private readonly desired = new Vector3();
  private readonly target = new Vector3();
  private readonly toCamera = new Vector3();
  private readonly mouth = new Vector3();
  private readonly right = new Vector3();
  private readonly upAxis = new Vector3();
  private readonly rolledRight = new Vector3();
  private readonly rolledUp = new Vector3();
  private readonly basis = new Matrix4();
  private readonly orientation = new Quaternion();
  private readonly avoidance = new Vector2();
  private readonly avoidSmooth = new Vector2();
  private readonly heading = new Vector3(0, 0, 1);
  private readonly before = new Vector3();
  private readonly passSide = new Vector3();
  private readonly passAhead = new Vector3();
  private readonly tail = new Vector3();
  private readonly nose = new Vector3();
  private readonly axis = new Vector3();
  private readonly closest = new Vector3();
  private readonly random = createRandom(918273645);
  private readonly materials: Material[] = [];

  private mixer: AnimationMixer | null = null;
  private swim: AnimationAction | null = null;
  private bite: AnimationAction | null = null;

  private mood: Mood = 'patrol';
  private moodTime = 0;
  private cooldown = 6;
  private bitesLeft = 0;
  private biting = false;
  private biteTime = 0;
  private biteWeight = 0;
  private biteRest = 0;
  private speed = 0.9;
  private bank = 0;
  private placed = false;

  constructor(field: CausticField) {
    this.group.name = 'Shark';
    this.group.visible = false;
    loadModel('shark', 'Shark_biting.glb')
      .then((gltf) => this.setup(gltf.scene, gltf.animations, field))
      .catch((error) => console.warn('Shark model could not be loaded', error));
  }

  private setup(model: Object3D, clips: AnimationClip[], field: CausticField) {
    // Fit the model to a room-sized shark, centred on the body so rotations pivot around the middle.
    const box = measure(model);
    const size = box.getSize(new Vector3());
    const scale = SHARK_LENGTH / Math.max(size.z, 1e-3);
    const center = box.getCenter(new Vector3());
    model.scale.setScalar(scale);
    model.position.copy(center).multiplyScalar(-scale);
    this.materials.push(...applyCausticMaterials(model, field));
    this.group.add(model);

    this.mixer = new AnimationMixer(model);
    const swimClip = clips.find((clip) => clip.name === 'ArmatureAction') ?? clips[0];
    const biteClip = clips.find((clip) => clip.name.toLowerCase().includes('bite'));
    if (swimClip) {
      this.swim = this.mixer.clipAction(swimClip);
      this.swim.play();
    }
    if (biteClip) {
      this.bite = this.mixer.clipAction(biteClip);
      this.bite.play();
      this.bite.setEffectiveWeight(0);
    }
    this.group.visible = true;
  }

  /** Where on the patrol ring the shark should be heading, `lead` radians ahead of where it is now. */
  private ringTarget(time: number, lead: number, out: Vector3): Vector3 {
    const angle = Math.atan2(this.position.z, this.position.x) + lead;
    const radius = PATROL_RADIUS + Math.sin(angle * 2 + time * 0.05) * 0.5;
    const height = 2.8 + Math.sin(time * 0.17) * 0.7 + Math.sin(angle * 2) * 0.3;
    return out.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  }

  private startBite() {
    this.biting = true;
    this.biteTime = 0;
    if (this.bite) {
      this.bite.reset();
      this.bite.play();
    }
  }

  private setMood(mood: Mood) {
    this.mood = mood;
    this.moodTime = 0;
  }

  update(dt: number, time: number, camera: Vector3) {
    if (!this.placed) {
      this.group.position.copy(this.position);
      this.group.quaternion.identity();
    }
    if (dt <= 0) return;

    const underwater = camera.y < WATER_HEIGHT - 0.1;
    this.moodTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.biteRest = Math.max(0, this.biteRest - dt);

    this.mouth.copy(this.forward).multiplyScalar(MOUTH).add(this.position);
    this.toCamera.subVectors(camera, this.mouth);
    const mouthDistance = this.toCamera.length();
    const cameraDistance = camera.distanceTo(this.position);

    // Mood transitions.
    if (this.mood === 'patrol' && underwater && cameraDistance < NOTICE_RADIUS && this.cooldown <= 0) {
      this.beginPass(camera);
    } else if (this.mood === 'pass') {
      const along = this.toCamera.subVectors(camera, this.position).dot(this.passAhead);
      if (!underwater || along < -5 || this.moodTime > 16) {
        // Done passing: swim on and leave the viewer alone for a while.
        this.cooldown = 14;
        this.setMood('retreat');
      }
    } else if (this.mood === 'retreat' && this.moodTime > 6) {
      this.setMood('patrol');
    }
    this.toCamera.subVectors(camera, this.mouth);

    // One slow, playful chomp as the snout glides past the viewer.
    if (
      this.mood === 'pass' &&
      !this.biting &&
      this.biteRest <= 0 &&
      this.bitesLeft > 0 &&
      mouthDistance < BITE_RANGE &&
      this.toCamera.dot(this.forward) > 0
    ) {
      this.startBite();
    }
    let targetBite = 0;
    if (this.biting) {
      this.biteTime += dt * BITE_TIMESCALE;
      if (this.biteTime < 0.15) targetBite = MathUtils.smoothstep(this.biteTime, 0, 0.15);
      else if (this.biteTime <= 1.35) targetBite = 1;
      else if (this.biteTime < BITE_DURATION) targetBite = 1 - MathUtils.smoothstep(this.biteTime, 1.35, BITE_DURATION);
      else {
        this.biting = false;
        this.biteRest = 0.5;
        this.bitesLeft--;
      }
    }
    this.biteWeight = MathUtils.damp(this.biteWeight, targetBite, 6, dt);
    if (this.mixer) {
      if (this.swim) {
        this.swim.timeScale = 0.5 + this.speed * 0.3;
        this.swim.setEffectiveWeight(Math.max(0, 1 - this.biteWeight));
      }
      if (this.bite) {
        this.bite.timeScale = BITE_TIMESCALE;
        this.bite.setEffectiveWeight(this.biteWeight);
      }
      this.mixer.update(dt);
    }

    // Where to go and how fast.
    let wantedSpeed = 0.95;
    let turnRate = 0.7;
    if (this.mood === 'pass') {
      // Glide to a spot beside the viewer, then carry straight on past them: a long, gentle curve.
      const along = this.toCamera.subVectors(camera, this.position).dot(this.passAhead);
      this.target.copy(camera).addScaledVector(this.passSide, PASS_OFFSET);
      if (along < 0.5) this.target.addScaledVector(this.passAhead, MathUtils.clamp(0.5 - along, 0, 1) * 8);
      this.target.y = MathUtils.clamp(this.target.y, floorHeight(PATROL_RADIUS) + 1, WATER_HEIGHT - 1.2);
      const reach = Math.hypot(this.target.x, this.target.z);
      if (reach > WALL_RADIUS) {
        this.target.x *= WALL_RADIUS / reach;
        this.target.z *= WALL_RADIUS / reach;
      }
      wantedSpeed = 0.85;
      turnRate = 0.8;
    } else if (this.mood === 'retreat') {
      this.ringTarget(time, 0.9, this.target);
      wantedSpeed = 1.0;
      turnRate = 0.8;
    } else {
      this.ringTarget(time, 0.45, this.target);
    }

    this.desired.subVectors(this.target, this.position);
    if (this.desired.lengthSq() < 1e-4) this.desired.copy(this.forward);
    this.desired.normalize();
    this.desired.y = MathUtils.clamp(this.desired.y, -0.25, 0.25);

    // Avoid the columns, the plinth, the outer wall, the floor and the water surface.
    this.avoidance.set(0, 0);
    steerAround(this.position.x, this.position.z, this.forward.x, this.forward.z, BODY_RADIUS, 3, 0.5, this.avoidance);
    // Give a viewer who wanders close a wide berth: ease sideways, away from them.
    if (cameraDistance < PERSONAL_SPACE && cameraDistance > 1e-3) {
      const closeness = 1 - cameraDistance / PERSONAL_SPACE;
      this.avoidance.x += ((this.position.x - camera.x) / cameraDistance) * closeness * 1.6;
      this.avoidance.y += ((this.position.z - camera.z) / cameraDistance) * closeness * 1.6;
    }
    // Smooth the avoidance so it eases in and out instead of flicking the heading.
    const blend = 1 - Math.exp(-2.5 * dt);
    this.avoidSmooth.lerp(this.avoidance, blend);
    const avoiding = this.avoidSmooth.lengthSq() > 0.01;
    this.desired.x += this.avoidSmooth.x * 2.2;
    this.desired.z += this.avoidSmooth.y * 2.2;
    const radius = Math.hypot(this.position.x, this.position.z);
    if (radius > WALL_RADIUS) {
      const push = (radius - WALL_RADIUS) * 0.9;
      this.desired.x -= (this.position.x / radius) * push;
      this.desired.z -= (this.position.z / radius) * push;
    }
    const aheadX = this.position.x + this.forward.x * 1.5;
    const aheadZ = this.position.z + this.forward.z * 1.5;
    const minY = Math.max(floorHeight(radius), floorHeight(Math.hypot(aheadX, aheadZ))) + 0.65;
    const maxY = WATER_HEIGHT - 0.9;
    if (this.position.y < minY + 0.4) this.desired.y += 0.5;
    if (this.position.y > maxY - 0.4) this.desired.y -= 0.5;
    this.limitPitch(this.desired);
    // Ease the steering goal itself, so a change of mood or target starts a turn gradually.
    this.heading.lerp(this.desired, 1 - Math.exp(-2.2 * dt));
    this.limitPitch(this.heading);

    const previousYaw = Math.atan2(this.forward.x, this.forward.z);
    this.forward.lerp(this.heading, 1 - Math.exp(-turnRate * (avoiding ? 1.4 : 1) * dt));
    if (this.forward.lengthSq() < 1e-3) {
      this.forward.set(this.heading.z, 0, -this.heading.x);
    }
    this.limitPitch(this.forward);
    let yawChange = Math.atan2(this.forward.x, this.forward.z) - previousYaw;
    if (yawChange > Math.PI) yawChange -= Math.PI * 2;
    else if (yawChange < -Math.PI) yawChange += Math.PI * 2;

    this.speed = MathUtils.damp(this.speed, wantedSpeed, 1.2, dt);
    this.velocity.copy(this.forward).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, dt);

    // Hard limits: never inside a column or plinth, never through the floor, wall or surface.
    // The correction is eased in over a few frames so a graze never shows up as a jolt.
    this.before.copy(this.position);
    pushOutOfObstacles(this.position, BODY_RADIUS + 0.2);
    this.position.lerpVectors(this.before, this.position, Math.min(1, dt * 8));
    const rim = Math.hypot(this.position.x, this.position.z);
    if (rim > WALL_RADIUS + 0.8) {
      this.position.x *= (WALL_RADIUS + 0.8) / rim;
      this.position.z *= (WALL_RADIUS + 0.8) / rim;
    }
    this.position.y = MathUtils.clamp(this.position.y, floorHeight(Math.hypot(this.position.x, this.position.z)) + 0.55, maxY);
    this.keepClearOfCamera(camera, dt);

    // Orientation: heading plus a soft bank into turns.
    this.right.crossVectors(UP, this.forward).normalize();
    this.upAxis.crossVectors(this.forward, this.right).normalize();
    this.bank = MathUtils.damp(this.bank, MathUtils.clamp((yawChange / dt) * 0.6, -0.25, 0.25), 1.5, dt);
    const cos = Math.cos(this.bank);
    const sin = Math.sin(this.bank);
    this.rolledRight.copy(this.right).multiplyScalar(cos).addScaledVector(this.upAxis, -sin);
    this.rolledUp.copy(this.upAxis).multiplyScalar(cos).addScaledVector(this.right, sin);
    this.basis.makeBasis(this.rolledRight, this.rolledUp, this.forward);
    this.orientation.setFromRotationMatrix(this.basis);
    if (this.placed) this.group.quaternion.slerp(this.orientation, 1 - Math.exp(-3 * dt));
    else this.group.quaternion.copy(this.orientation);
    this.placed = true;
    this.group.position.copy(this.position);
  }

  /** Normalise `v` and keep it within a shallow climb/dive angle, so the heading never points steeply up or down. */
  private limitPitch(v: Vector3) {
    if (Math.hypot(v.x, v.z) < 1e-4) {
      // Degenerate: fall back to the current horizontal heading.
      v.x = this.forward.x;
      v.z = this.forward.z;
      if (Math.hypot(v.x, v.z) < 1e-4) v.z = 1;
    }
    v.normalize();
    const y = MathUtils.clamp(v.y, -MAX_PITCH_SIN, MAX_PITCH_SIN);
    const scale = Math.sqrt(1 - y * y) / (Math.hypot(v.x, v.z) || 1);
    v.set(v.x * scale, y, v.z * scale);
  }

  /** Choose the side the shark glides by on, so it never has to cross the viewer's line. */
  private beginPass(camera: Vector3) {
    this.setMood('pass');
    this.bitesLeft = this.random() < 0.6 ? 1 : 0;
    this.passAhead.set(this.forward.x, 0, this.forward.z);
    if (this.passAhead.lengthSq() < 1e-4) this.passAhead.set(0, 0, 1);
    this.passAhead.normalize();
    this.passSide.set(this.passAhead.z, 0, -this.passAhead.x);
    const side = this.passSide.dot(this.tail.subVectors(this.position, camera));
    if (side < 0) this.passSide.negate();
  }

  /** The viewer's head is never allowed inside the body: ease the shark away from the camera. */
  private keepClearOfCamera(camera: Vector3, dt: number) {
    const tail = this.tail.copy(this.forward).multiplyScalar(-SHARK_LENGTH * 0.5).add(this.position);
    const nose = this.nose.copy(this.forward).multiplyScalar(MOUTH * 1.1).add(this.position);
    // Closest point on the tail-to-nose segment to the camera.
    const axis = this.axis.subVectors(nose, tail);
    const t = MathUtils.clamp(this.closest.subVectors(camera, tail).dot(axis) / axis.lengthSq(), 0, 1);
    const closest = this.closest.copy(tail).addScaledVector(axis, t);
    const gap = closest.distanceTo(camera);
    const minimum = 0.55;
    if (gap < minimum) {
      closest.sub(camera);
      if (closest.lengthSq() < 1e-6) closest.set(this.forward.z, 0, -this.forward.x);
      this.position.addScaledVector(closest.normalize(), (minimum - gap) * Math.min(1, dt * 6));
    }
  }

  dispose() {
    this.materials.forEach((material) => material.dispose());
    this.mixer?.stopAllAction();
  }
}
