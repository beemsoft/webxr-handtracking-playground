import { Body, Box, Vec3 } from 'cannon-es';
import { ArrayCamera, BoxGeometry, MathUtils, Mesh, MeshPhongMaterial, Scene, Vector3 } from 'three/src/Three';
import PhysicsHandler from '../physics/PhysicsHandler';
import {
  XRDevicePose,
  XRFrameOfReference,
  XRInputSource, XRJointPose,
  XRReferenceSpace
} from '../webxr/WebXRDeviceAPI';
import BallManager from './BallManager';
import { GestureType, HandTrackingResult } from '../scene/SceneManagerInterface';

const orderedJoints = [
  ["wrist"],
  ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
  ["index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
  ["middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
  ["ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
  ["pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"]
];

const pinchFingerTip = "index-finger-tip";
const snapFingerTip = "middle-finger-tip";
const ringFingerTip = "ring-finger-tip";
const pinkyFingerTip = "pinky-finger-tip";
const thumbTip = "thumb-tip";
const wristJoint = "wrist";
const pinkyFingerBase = 'pinky-finger-metacarpal';
const thumbFingerBase = 'thumb-phalanx-distal';

const handMeshList = Array<Body>();

const fingerJointMaterial: [string, MeshPhongMaterial][] = [];

export enum HandGesture {
  "None",
  "Open_Hand",
  "Closed_Hand",
  "Index_Thumb",
  "Middle_Thumb",
  "Ring_Thumb",
  "Pinky_Thumb"
}

export default class TrackedHandsManager {
  private scene: Scene;
  private physicsHandler: PhysicsHandler;
  private camera: ArrayCamera;
  material = new MeshPhongMaterial({ color: 0xFF3333 });
  private ballInMotion = false;
  private canFixBall = true;
  private fixHand = "";
  private ballManager: BallManager;
  isPinchingEnabled = true;
  isCameraRotationEnabled = false;
  isOriginRotationEnabled = false;
  public rotationStartVector: Vector3;
  rotationStartPos: Vector3;
  public offsetAngle = 0;
  public rotationPosition: Vector3;
  public handGesture = GestureType.None;

  constructor(scene: Scene, physicsHandler: PhysicsHandler, camera: ArrayCamera) {
    this.scene = scene;
    this.physicsHandler = physicsHandler;
    this.camera = camera;
    this.ballManager = new BallManager(physicsHandler);
  }

  public

  renderHandsAndDetectGesture(frame: XRFrameOfReference, pose: XRDevicePose, xrReferenceSpace: XRReferenceSpace): HandTrackingResult {
    let wristPose;
    for (let inputSource of frame.session.inputSources) {
      if (inputSource.hand) {
        if (inputSource.handedness == "right") {
          this.handGesture = GestureType.None;
          let wrist = inputSource.hand.get(wristJoint);
          if (!wrist) {
            return;
          }
          wristPose = frame.getJointPose(wrist, xrReferenceSpace);
          let thumb = inputSource.hand.get(thumbTip);
          let thumbTipPose = frame.getJointPose(thumb, xrReferenceSpace);
          if (wristPose) {
            if (this.isOpenHand(inputSource, wristPose, thumbTipPose, xrReferenceSpace, frame)) {
              this.handGesture = GestureType.Open_Hand;
            } else {
              if (thumbTipPose.transform.position.y > wristPose.transform.position.y) {
                if (this.isThumbPinchingWithOtherFingerTip(inputSource, pinchFingerTip, thumbTipPose, xrReferenceSpace, frame)) {
                  this.handGesture = GestureType.Index_Thumb;
                } else if (this.isThumbPinchingWithOtherFingerTip(inputSource, snapFingerTip, thumbTipPose, xrReferenceSpace, frame)) {
                  this.handGesture = GestureType.Middle_Thumb;
                } else if (this.isThumbPinchingWithOtherFingerTip(inputSource, ringFingerTip, thumbTipPose, xrReferenceSpace, frame)) {
                  this.handGesture = GestureType.Ring_Thumb;
                } else if (this.isThumbPinchingWithOtherFingerTip(inputSource, pinkyFingerTip, thumbTipPose, xrReferenceSpace, frame)) {
                  this.handGesture = GestureType.Pinky_Thumb;
                } else if (this.isClosedHand(inputSource, wristPose, thumbTipPose, xrReferenceSpace, frame)) {
                  this.handGesture = GestureType.Closed_Hand;
                }
              }
            }
          }
          this.renderHandWithPhysicsEnabled(inputSource, frame, xrReferenceSpace);
          return {
            gestureType: this.handGesture,
            orientation: wristPose ? wristPose.transform.orientation : null,
            position: wristPose ? wristPose.transform.position : null
          }
        }
      }
    }
  }

  private isOpenHand(inputSource: XRInputSource, wristPose: XRJointPose, thumbTipPose: XRJointPose, xrReferenceSpace: XRReferenceSpace, frame: XRFrameOfReference) {
    let wristPosition = new Vector3(wristPose.transform.position.x, wristPose.transform.position.y, wristPose.transform.position.z);
    let pink = inputSource.hand.get(pinkyFingerTip);
    let pinkTipPose = frame.getJointPose(pink, xrReferenceSpace);
    if (pinkTipPose && thumbTipPose) {
      let pinkPosition = new Vector3(pinkTipPose.transform.position.x, pinkTipPose.transform.position.y, pinkTipPose.transform.position.z);
      pinkPosition = pinkPosition.sub(wristPosition);
      let thumbPosition = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
      thumbPosition = thumbPosition.sub(wristPosition);
      if (MathUtils.radToDeg(pinkPosition.angleTo(thumbPosition)) > 70) {
        return true;
      }
    }
    return false;
  }

  isClosedHand(inputSource: XRInputSource, wristPose: XRJointPose, thumbTipPose: XRJointPose, xrReferenceSpace: XRReferenceSpace, frame: XRFrameOfReference): boolean {
    let pinkyTipPose = frame.getJointPose(inputSource.hand.get(pinkyFingerTip), xrReferenceSpace);
    let pinkyBasePose = frame.getJointPose(inputSource.hand.get(pinkyFingerBase), xrReferenceSpace);
    let thumbSubTipPose = frame.getJointPose(inputSource.hand.get(thumbFingerBase), xrReferenceSpace);
    if (pinkyTipPose && thumbTipPose) {
      let pinkyPosition = new Vector3(pinkyTipPose.transform.position.x, pinkyTipPose.transform.position.y, pinkyTipPose.transform.position.z);
      let thumbTipPosition = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
      let pinkyBasePosition = new Vector3(pinkyBasePose.transform.position.x, pinkyBasePose.transform.position.y, pinkyBasePose.transform.position.z);
      let thumbSubTipPosition = new Vector3(thumbSubTipPose.transform.position.x, thumbSubTipPose.transform.position.y, thumbSubTipPose.transform.position.z);
      let pinkyDirection = pinkyPosition.sub(pinkyBasePosition).normalize();
      let thumbDirection = thumbTipPosition.sub(thumbSubTipPosition).normalize();
      if (pinkyDirection.distanceTo(thumbDirection) < 0.3) {
        return true;
      }
    }
    return false;
  }

  private isThumbPinchingWithOtherFingerTip(inputSource: XRInputSource, fingerTip: string, thumbTipPose: XRJointPose, xrReferenceSpace: XRReferenceSpace, frame: XRFrameOfReference) {
    let fingerTipJoint = inputSource.hand.get(fingerTip);
    let fingerTipPose = frame.getJointPose(fingerTipJoint, xrReferenceSpace);
    let wrist = inputSource.hand.get('wrist');
    let wristPose = frame.getJointPose(wrist, xrReferenceSpace);
    if (fingerTipPose && wristPose) {
      if (this.camera.position.distanceTo(wristPose.transform.position) < this.camera.position.distanceTo(fingerTipPose.transform.position)) {
        let vector1 = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
        let vector2 = new Vector3(fingerTipPose.transform.position.x, fingerTipPose.transform.position.y, fingerTipPose.transform.position.z);
        if (vector1.distanceTo(vector2) < thumbTipPose.radius + fingerTipPose.radius + 0.01) {
          return true;
        }
      }
    }
    return false;
  }

  private renderHandWithPhysicsEnabled(inputSource: XRInputSource, frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace) {
    console.log("Gesture: " + this.handGesture);
    let meshIndex = 0;
    for (let finger of orderedJoints) {
      for (let joint1 of finger) {
        let joint = inputSource.hand.get(joint1);
        if (joint) {
          let pose = frame.getJointPose(joint, xrReferenceSpace);
          if (pose) {
            let handBody: Body;
            if (handMeshList[meshIndex]) {
              handBody = handMeshList[meshIndex];
            } else {
              const sphere_geometry = new BoxGeometry(pose.radius, pose.radius, pose.radius);

              let mat = this.material;
              switch (joint1) {
                case "index-finger-tip":
                case "middle-finger-tip":
                case "ring-finger-tip":
                case "pinky-finger-tip":
                case "thumb-tip":
                case "wrist":
                case 'pinky-finger-metacarpal':
                case 'thumb-phalanx-distal':
                  fingerJointMaterial[joint1] = new MeshPhongMaterial({ color: 0xFF3333 });
                  mat = fingerJointMaterial[joint1];
                  break;
                default:
                  mat = this.material;
                  break;
              }
              let mesh = new Mesh(sphere_geometry, mat);
              this.scene.add(mesh);
              handBody = new Body({mass: 0, material: this.physicsHandler.handMaterial});
              handBody.addShape(new Box(new Vec3(pose.radius, pose.radius, pose.radius)));
              handMeshList[meshIndex] = handBody;
              this.physicsHandler.addBody(handBody);
              this.physicsHandler.addMesh(mesh);
            }
            handBody.position.x = pose.transform.position.x;
            handBody.position.y = pose.transform.position.y;
            handBody.position.z = pose.transform.position.z;
            switch (this.handGesture) {
              case GestureType.Open_Hand: {
                if (joint1 == pinkyFingerTip || joint1 == thumbTip || joint1 == wristJoint) {
                  fingerJointMaterial[joint1].color.set(0x33fdff);
                }
                break;
              }
              case GestureType.Index_Thumb: {
                console.log("Check pinch!");
                if (joint1 == pinchFingerTip || joint1 == thumbTip) {
                  fingerJointMaterial[joint1].color.set(0x33fdff);
                }
                break;
              }
              case GestureType.Middle_Thumb: {
                if (joint1 == snapFingerTip || joint1 == thumbTip) {
                  fingerJointMaterial[joint1].color.set(0x33fdff);
                }
                break;
              }
              case GestureType.Ring_Thumb: {
                if (joint1 == ringFingerTip || joint1 == thumbTip) {
                  fingerJointMaterial[joint1].color.set(0x33fdff);
                }
                break;
              }
              case GestureType.Pinky_Thumb: {
                if (joint1 == pinkyFingerTip || joint1 == thumbTip) {
                  fingerJointMaterial[joint1].color.set(0x33fdff);
                }
                break;
              }
              case GestureType.Closed_Hand: {
                if (joint1 == pinkyFingerTip || joint1 == thumbTip || joint1 == thumbFingerBase || joint1 == pinkyFingerBase) {
                  fingerJointMaterial[joint1].color.set(0x33fdff);
                }
                break;
              }
              case GestureType.Middle_and_Ring_on_Thumb: {
                if (joint1 == snapFingerTip || joint1 == thumbTip || joint1 == thumbFingerBase || joint1 == pinkyFingerBase) {
                  fingerJointMaterial[joint1].color.set(0x33fdff);
                }
                break;
              }
              case GestureType.None:
                if (fingerJointMaterial[joint1]) {
                  fingerJointMaterial[joint1].color.set(0xFF3333);
                }
                break;
            }
          }
        }
        meshIndex++;
      }
    }
  }

  checkFixedBall(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace) {
    if (this.fixHand) {
      for (let inputSource of frame.session.inputSources) {
        if (this.fixHand == inputSource.handedness) {
          let wrist = inputSource.hand.get('wrist');
          let wristPose = frame.getJointPose(wrist, xrReferenceSpace);
          if (wristPose) {
            let wristPosition = new Vector3(wristPose.transform.position.x, wristPose.transform.position.y, wristPose.transform.position.z);
          }
        }
      }
    }
  }

  thumbsJoining(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace) {
    let thumbTipLeft;
    let thumbTipRight;
    let distance;
    for (let inputSource of frame.session.inputSources) {
      let wrist = inputSource.hand.get('wrist');
      let wristPose = frame.getJointPose(wrist, xrReferenceSpace);
      if (wristPose) {
        let thumbTip = inputSource.hand.get('thumb-tip');
        let thumbTipPose = frame.getJointPose(thumbTip, xrReferenceSpace);
        if (thumbTipPose) {
          let thumbTipPosition = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
          if (inputSource.handedness == 'left') {
            thumbTipLeft = thumbTipPosition;
          } else {
            thumbTipRight = thumbTipPosition;
          }
          distance = thumbTipPose.radius * 2 + 0.02;
        }
      }
    }
    if (thumbTipLeft && thumbTipRight) {
      if (thumbTipLeft.distanceTo(thumbTipRight) < distance) {
        this.material.color.set(0x3455eb);
        this.canFixBall = true;
      }
    }
  }
}
