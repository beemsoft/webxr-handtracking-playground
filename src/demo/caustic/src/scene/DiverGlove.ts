import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { CausticField } from './CausticField';
import { createCausticMaterial } from './CausticMaterials';

/** A tracked joint: world position and the joint's radius in metres. */
export interface GloveJoint {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Returns the joint with the given WebXR name, or null while it is not tracked. */
export type GloveJointLookup = (name: string) => GloveJoint | null;

const FINGERS = ['index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'] as const;
const WRIST = 'wrist';
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];
const FINGER_JOINTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];

/** All 25 WebXR hand joints. */
const JOINT_NAMES = [WRIST, ...THUMB, ...FINGERS.flatMap((finger) => FINGER_JOINTS.map((joint) => `${finger}-${joint}`))];

const MAX_LINKS = 48;
const MAX_BALLS = 40;

/** Neoprene is a little thicker than the skin it covers (metres). */
const PAD = 0.0035;
const BODY_COLOR = new Color(0x42586a);
const PAD_COLOR = new Color(0x8a99a3);
const CUFF_COLOR = new Color(0x34485a);
const BAND_COLOR = new Color(0xf2a413);

const UP = new Vector3(0, 1, 0);

/**
 * A diver's glove drawn over a tracked hand: dark neoprene links and knuckle spheres that follow the
 * 25 WebXR joints, grip pads on the fingertips and a loose cuff with a yellow band at the wrist. It
 * is two instanced meshes (links and balls), shaded by the demo's caustic material, so the sun's
 * moving caustic light plays across the glove like it does across everything else underwater.
 */
export class DiverGlove {
  readonly group = new Group();

  private readonly links: InstancedMesh;
  private readonly balls: InstancedMesh;
  private linkCount = 0;
  private ballCount = 0;

  /** Owned copies of this frame's joints; only names in `tracked` are valid. */
  private readonly joints = new Map<string, GloveJoint>(JOINT_NAMES.map((name) => [name, { x: 0, y: 0, z: 0, radius: 0 }]));
  private readonly tracked = new Set<string>();
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly forward = new Vector3();
  private readonly side = new Vector3();
  private readonly thick = new Vector3();

  constructor(field: CausticField) {
    const material = createCausticMaterial(field, { color: 0xffffff });

    // Unit cylinder along +y; every link is scaled and rotated onto the segment between two joints.
    const link = new CylinderGeometry(1, 1, 1, 14, 1, false);
    this.links = new InstancedMesh(link, material, MAX_LINKS);
    this.balls = new InstancedMesh(new SphereGeometry(1, 14, 10), material, MAX_BALLS);
    for (const mesh of [this.links, this.balls]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = 'DiverGlove';
      // Allocates the colour buffer up front; all instances are overwritten every frame.
      mesh.setColorAt(0, BODY_COLOR);
      this.group.add(mesh);
    }
    this.group.visible = false;
  }

  hide() {
    this.group.visible = false;
  }

  /** Re-poses the glove from the current joint positions; hides it when the hand is not tracked. */
  update(lookup: GloveJointLookup) {
    this.tracked.clear();
    for (const name of JOINT_NAMES) {
      const joint = lookup(name);
      if (!joint) continue;
      const own = this.joints.get(name)!;
      own.x = joint.x;
      own.y = joint.y;
      own.z = joint.z;
      own.radius = joint.radius;
      this.tracked.add(name);
    }
    if (!this.tracked.has(WRIST)) {
      this.hide();
      return;
    }
    this.linkCount = 0;
    this.ballCount = 0;

    this.chain([WRIST, ...THUMB], 1, false);
    for (const finger of FINGERS) {
      this.chain(FINGER_JOINTS.map((joint) => `${finger}-${joint}`), 1, true);
      // Palm: thick links from the wrist out to every knuckle fill the back and the heel of the hand.
      this.link(WRIST, `${finger}-metacarpal`, 1.15, BODY_COLOR);
      this.link(WRIST, `${finger}-phalanx-proximal`, 1.55, BODY_COLOR);
    }
    for (let i = 0; i < FINGERS.length - 1; i++) {
      this.link(`${FINGERS[i]}-phalanx-proximal`, `${FINGERS[i + 1]}-phalanx-proximal`, 1.35, BODY_COLOR);
      this.link(`${FINGERS[i]}-metacarpal`, `${FINGERS[i + 1]}-metacarpal`, 1.3, BODY_COLOR);
    }
    // Web between the thumb and the index finger.
    this.link('thumb-phalanx-proximal', 'index-finger-metacarpal', 1.2, BODY_COLOR);
    this.link('thumb-metacarpal', 'index-finger-phalanx-proximal', 1.0, BODY_COLOR);
    // Wide palm across the middle of the hand.
    this.link('index-finger-metacarpal', 'pinky-finger-phalanx-proximal', 1.0, BODY_COLOR);
    this.link('pinky-finger-metacarpal', 'index-finger-phalanx-proximal', 1.0, BODY_COLOR);

    this.cuff();

    this.links.count = this.linkCount;
    this.balls.count = this.ballCount;
    this.links.instanceMatrix.needsUpdate = true;
    this.balls.instanceMatrix.needsUpdate = true;
    if (this.links.instanceColor) this.links.instanceColor.needsUpdate = true;
    if (this.balls.instanceColor) this.balls.instanceColor.needsUpdate = true;
    this.group.visible = true;
  }

  private chain(names: string[], thickness: number, padTip: boolean) {
    for (let i = 0; i < names.length - 1; i++) this.link(names[i], names[i + 1], thickness, BODY_COLOR);
    for (let i = 1; i < names.length; i++) {
      const tip = i === names.length - 1;
      this.ball(names[i], thickness * (tip ? 1.18 : 1.05), tip && padTip ? PAD_COLOR : BODY_COLOR);
    }
    // Thumb tip gets a grip pad too.
    if (!padTip) this.ball(names[names.length - 1], thickness * 1.2, PAD_COLOR);
  }

  /** This frame's joint, or undefined when it is not tracked. */
  private get(name: string): GloveJoint | undefined {
    return this.tracked.has(name) ? this.joints.get(name) : undefined;
  }

  private link(from: string, to: string, thickness: number, color: Color) {
    const j1 = this.get(from);
    const j2 = this.get(to);
    if (!j1 || !j2 || this.linkCount >= MAX_LINKS) return;
    this.a.set(j1.x, j1.y, j1.z);
    this.b.set(j2.x, j2.y, j2.z);
    const length = this.a.distanceTo(this.b);
    if (length < 1e-5) return;
    const radius = ((j1.radius + j2.radius) * 0.5 + PAD) * thickness;
    this.position.copy(this.a).add(this.b).multiplyScalar(0.5);
    this.forward.copy(this.b).sub(this.a).divideScalar(length);
    this.quaternion.setFromUnitVectors(UP, this.forward);
    this.scale.set(radius, length, radius);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.links.setMatrixAt(this.linkCount, this.matrix);
    this.links.setColorAt(this.linkCount, color);
    this.linkCount++;
  }

  private ball(name: string, thickness: number, color: Color) {
    const joint = this.get(name);
    if (!joint || this.ballCount >= MAX_BALLS) return;
    const radius = (joint.radius + PAD) * thickness;
    this.position.set(joint.x, joint.y, joint.z);
    this.quaternion.identity();
    this.scale.set(radius, radius, radius);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.balls.setMatrixAt(this.ballCount, this.matrix);
    this.balls.setColorAt(this.ballCount, color);
    this.ballCount++;
  }

  /** Loose neoprene cuff with a coloured band, extending from the wrist back along the forearm. */
  private cuff() {
    const wrist = this.get(WRIST);
    const middle = this.get('middle-finger-metacarpal') ?? this.get('middle-finger-phalanx-proximal');
    const indexBase = this.get('index-finger-metacarpal');
    const pinkyBase = this.get('pinky-finger-metacarpal');
    if (!wrist || !middle || !indexBase || !pinkyBase) return;

    // Forearm direction: from the middle knuckle back through the wrist.
    this.forward.set(wrist.x - middle.x, wrist.y - middle.y, wrist.z - middle.z).normalize();
    this.side.set(pinkyBase.x - indexBase.x, pinkyBase.y - indexBase.y, pinkyBase.z - indexBase.z);
    // Make the side axis exactly perpendicular to the forearm axis.
    this.side.addScaledVector(this.forward, -this.side.dot(this.forward)).normalize();
    this.thick.crossVectors(this.side, this.forward).normalize();

    const halfWidth = Math.max(this.a.set(pinkyBase.x - indexBase.x, pinkyBase.y - indexBase.y, pinkyBase.z - indexBase.z).length() * 0.5, 0.03) + 0.014;
    const halfThick = halfWidth * 0.78;

    this.cuffRing(wrist, halfWidth, halfThick, 0.012, 0.075, CUFF_COLOR);
    this.cuffRing(wrist, halfWidth * 1.02, halfThick * 1.02, 0.047, 0.016, BAND_COLOR);
  }

  /** One elliptical cylinder `offset` metres behind the wrist along the forearm, `length` long. */
  private cuffRing(wrist: GloveJoint, halfWidth: number, halfThick: number, offset: number, length: number, color: Color) {
    if (this.linkCount >= MAX_LINKS) return;
    this.position.set(wrist.x, wrist.y, wrist.z).addScaledVector(this.forward, offset + length * 0.5 - 0.02);
    // Columns of the basis: x = side * halfWidth, y = forearm * length, z = thickness * halfThick.
    this.matrix.makeBasis(
      this.a.copy(this.side).multiplyScalar(halfWidth),
      this.b.copy(this.forward).multiplyScalar(length),
      this.scale.copy(this.thick).multiplyScalar(halfThick)
    );
    this.matrix.setPosition(this.position);
    this.links.setMatrixAt(this.linkCount, this.matrix);
    this.links.setColorAt(this.linkCount, color);
    this.linkCount++;
  }
}
