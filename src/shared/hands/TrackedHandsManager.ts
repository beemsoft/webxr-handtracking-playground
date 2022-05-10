import { Body, Box, Vec3 } from 'cannon-es';
import { ArrayCamera, BoxGeometry, MathUtils, Mesh, MeshPhongMaterial, Scene, Vector3 } from 'three/src/Three';
import PhysicsHandler from '../physics/PhysicsHandler';
import { XRDevicePose, XRFrameOfReference, XRReferenceSpace } from '../webxr/WebXRDeviceAPI';
import BallManager from './BallManager';

const orderedJoints = [
  ["wrist"],
  ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
  ["index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
  ["middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
  ["ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
  ["pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"]
];

const pinchFingerTip = ["index-finger-tip"];
const snapFingerTip = ["middle-finger-tip"];
const ringFingerTip = ["ring-finger-tip"];
const pinkyFingerTip = ["pinky-finger-tip"];

const handMeshList = Array<Body>();

export default class TrackedHandsManager {
  private scene: Scene;
  private physicsHandler: PhysicsHandler;
  private camera: ArrayCamera;
  private material = new MeshPhongMaterial({ color: 0xFF3333 });
  private ballInMotion = false;
  private canFixBall = true;
  private fixHand = "";
  private ballManager: BallManager;
  private isPinchingEnabled = true;
  isCameraRotationEnabled = false;
  isOriginRotationEnabled = false;
  public rotationStartVector: Vector3;
  private rotationStartPos: Vector3;
  public rotationStopVector: Vector3;
  public offsetAngle = 0;
  public rotationPosition: Vector3;

  constructor(scene: Scene, physicsHandler: PhysicsHandler, camera: ArrayCamera) {
    this.scene = scene;
    this.physicsHandler = physicsHandler;
    this.camera = camera;
    this.ballManager = new BallManager(physicsHandler);
  }

  public isTrackedHandAvailable(frame: XRFrameOfReference) {
    for (let inputSource of frame.session.inputSources) {
      if (inputSource.hand) {
        let wrist = inputSource.hand.get('wrist');
        if (wrist) {
          return true;
        }
      }
    }
    return false;
  }

  public renderHands(frame: XRFrameOfReference, pose: XRDevicePose, xrReferenceSpace: XRReferenceSpace) {
    let meshIndex = 0;
    for (let inputSource of frame.session.inputSources) {
      if (inputSource.hand) {
        let wrist = inputSource.hand.get('wrist');
        if (!wrist) {
          // this code is written to assume that the wrist joint is exposed
          return;
        }
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
                  let mesh = new Mesh(sphere_geometry, this.material);
                  this.scene.add(mesh);
                  handBody = new Body({ mass: 0, material: this.physicsHandler.handMaterial });
                  handBody.addShape(new Box(new Vec3(pose.radius, pose.radius, pose.radius)));
                  handMeshList[meshIndex] = handBody;
                  this.physicsHandler.addBody(handBody);
                  this.physicsHandler.addMesh(mesh);
                }
                handBody.position.x = pose.transform.position.x;
                handBody.position.y = pose.transform.position.y;
                handBody.position.z = pose.transform.position.z;
              }
            }
            meshIndex++;
          }
        }
      }
    }
  }

  pinchFinger(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace): Vector3 {
    if (this.isPinchingEnabled) {
      for (let inputSource of frame.session.inputSources) {
        let thumbTip = inputSource.hand.get('thumb-tip');
        let thumbTipPose = frame.getJointPose(thumbTip, xrReferenceSpace);
        if (thumbTipPose) {
          for (let fingerTip of pinchFingerTip) {
            let fingerTipJoint = inputSource.hand.get(fingerTip);
            let fingerTipPose = frame.getJointPose(fingerTipJoint, xrReferenceSpace);
            if (fingerTipPose) {
              let vector1 = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
              let vector2 = new Vector3(fingerTipPose.transform.position.x, fingerTipPose.transform.position.y, fingerTipPose.transform.position.z);
              if (vector1.distanceTo(vector2) < thumbTipPose.radius + fingerTipPose.radius + 0.01) {
                this.material.color.set(0x33fdff);
                return fingerTipPose.transform.position;
              }
            }
          }
        }
      }
      this.material.color.set(0xFF3333);
    }
    return null;
  }

  snapFinger(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace) {
    for (let inputSource of frame.session.inputSources) {
      let thumbTip = inputSource.hand.get('thumb-tip');
      let thumbTipPose = frame.getJointPose(thumbTip, xrReferenceSpace);
      if (thumbTipPose) {
        for (let fingerTip of snapFingerTip) {
          let fingerTipJoint = inputSource.hand.get(fingerTip);
          let fingerTipPose = frame.getJointPose(fingerTipJoint, xrReferenceSpace);
          if (fingerTipPose) {
            let vector1 = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
            let vector2 = new Vector3(fingerTipPose.transform.position.x, fingerTipPose.transform.position.y, fingerTipPose.transform.position.z);
            if (vector1.distanceTo(vector2) < thumbTipPose.radius + fingerTipPose.radius + 0.01) {
              if (this.isPinchingEnabled) {
                this.material.color.set(0xdd00cc);
                this.isPinchingEnabled = false;
              } else {
                this.material.color.set(0xFF3333);
                this.isPinchingEnabled = true;
              }
            }
          }
        }
      }
    }
  }

  ringFinger(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace) {
    if (!this.isPinchingEnabled) {
      for (let inputSource of frame.session.inputSources) {
        let thumbTip = inputSource.hand.get('thumb-tip');
        let thumbTipPose = frame.getJointPose(thumbTip, xrReferenceSpace);
        if (thumbTipPose && inputSource.handedness == 'right') {
          for (let fingerTip of ringFingerTip) {
            let fingerTipJoint = inputSource.hand.get(fingerTip);
            let fingerTipPose = frame.getJointPose(fingerTipJoint, xrReferenceSpace);
            if (fingerTipPose) {
              let vector1 = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
              let vector2 = new Vector3(fingerTipPose.transform.position.x, fingerTipPose.transform.position.y, fingerTipPose.transform.position.z);
              if (vector1.distanceTo(vector2) < thumbTipPose.radius + fingerTipPose.radius + 0.02) {
                if (!this.isCameraRotationEnabled) {
                  this.rotationStartPos = new Vector3(this.camera.position.x, 0, this.camera.position.z);
                  this.rotationStartVector = vector1.sub(this.rotationStartPos);
                  this.rotationPosition = new Vector3(this.camera.position.x, 0, this.camera.position.z)
                  console.log('Start rotating');
                } else {
                  this.offsetAngle = Math.PI/140;
                }
                this.isCameraRotationEnabled = true;
                vector1.y = 0;

              } else {
                if (this.isCameraRotationEnabled && inputSource.handedness == 'right') {
                  this.rotationStopVector = vector1.sub(this.rotationStartPos);
                  console.log('Stop rotating');
                }
                this.isCameraRotationEnabled = false;
              }
            }
          }
        }
      }
    }
  }

  pinkyFinger(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace) {
    if (!this.isPinchingEnabled) {
      for (let inputSource of frame.session.inputSources) {
        let thumbTip = inputSource.hand.get('thumb-tip');
        let thumbTipPose = frame.getJointPose(thumbTip, xrReferenceSpace);
        if (thumbTipPose && inputSource.handedness == 'right') {
          for (let fingerTip of pinkyFingerTip) {
            let fingerTipJoint = inputSource.hand.get(fingerTip);
            let fingerTipPose = frame.getJointPose(fingerTipJoint, xrReferenceSpace);
            if (fingerTipPose) {
              let vector1 = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
              let vector2 = new Vector3(fingerTipPose.transform.position.x, fingerTipPose.transform.position.y, fingerTipPose.transform.position.z);
              if (vector1.distanceTo(vector2) < thumbTipPose.radius + fingerTipPose.radius + 0.02) {
                if (!this.isOriginRotationEnabled) {
                  console.log('Start rotating');
                } else {
                  this.offsetAngle = Math.PI/140;
                  console.log('Offset angle (degrees): ' + MathUtils.radToDeg(this.offsetAngle));
                }
                this.isOriginRotationEnabled = true;
                vector1.y = 0;

              } else {
                if (this.isOriginRotationEnabled && inputSource.handedness == 'right') {
                  console.log('Stop rotating');
                }
                this.isOriginRotationEnabled = false;
              }
            }
          }
        }
      }
    }
  }

  openHand(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace) {
    if (this.canFixBall) {
      for (let inputSource of frame.session.inputSources) {
        let wrist = inputSource.hand.get('wrist');
        let wristPose = frame.getJointPose(wrist, xrReferenceSpace);
        if (wristPose) {

          if (this.physicsHandler.bodyControlledByHandGesture && (isNaN(this.physicsHandler.bodyControlledByHandGesture.position.x) || isNaN(this.physicsHandler.bodyControlledByHandGesture.position.y) || isNaN(this.physicsHandler.bodyControlledByHandGesture.position.z))) {
            this.physicsHandler.bodyControlledByHandGesture.position = new Vec3(0, 3, 0);
            this.canFixBall = true;
            this.ballInMotion = true;
          }
          let wristPosition = new Vector3(wristPose.transform.position.x, wristPose.transform.position.y, wristPose.transform.position.z);
          let pink = inputSource.hand.get('pinky-finger-tip');
          let pinkTipPose = frame.getJointPose(pink, xrReferenceSpace);
          let thumb = inputSource.hand.get('thumb-tip');
          let thumbTipPose = frame.getJointPose(thumb, xrReferenceSpace);
          if (pinkTipPose && thumbTipPose) {
            let pinkPosition = new Vector3(pinkTipPose.transform.position.x, pinkTipPose.transform.position.y, pinkTipPose.transform.position.z);
            pinkPosition = pinkPosition.sub(wristPosition);
            let thumbPosition = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
            thumbPosition = thumbPosition.sub(wristPosition);
            let handPosition = new Vec3((pinkTipPose.transform.position.x + thumbTipPose.transform.position.x) / 2, (pinkTipPose.transform.position.y + thumbTipPose.transform.position.y) / 2, (pinkTipPose.transform.position.z + thumbTipPose.transform.position.z) / 2);
            this.ballManager.moveBall(pinkPosition, thumbPosition, handPosition);
            this.ballManager.checkBall(wristPosition);
          }
        }
      }
    }
  }

  isOpenHand(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace): boolean {
      for (let inputSource of frame.session.inputSources) {
        let wrist = inputSource.hand.get('wrist');
        let wristPose = frame.getJointPose(wrist, xrReferenceSpace);
        if (wristPose) {
          let wristPosition = new Vector3(wristPose.transform.position.x, wristPose.transform.position.y, wristPose.transform.position.z);
          let pink = inputSource.hand.get('pinky-finger-tip');
          let pinkTipPose = frame.getJointPose(pink, xrReferenceSpace);
          let thumb = inputSource.hand.get('thumb-tip');
          let thumbTipPose = frame.getJointPose(thumb, xrReferenceSpace);
          if (pinkTipPose && thumbTipPose) {
            let pinkPosition = new Vector3(pinkTipPose.transform.position.x, pinkTipPose.transform.position.y, pinkTipPose.transform.position.z);
            pinkPosition = pinkPosition.sub(wristPosition);
            let thumbPosition = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
            thumbPosition = thumbPosition.sub(wristPosition);
            return (MathUtils.radToDeg(pinkPosition.angleTo(thumbPosition)) > 70);
          }
        }
      }
  }

  isStopHand(frame: XRFrameOfReference, xrReferenceSpace: XRReferenceSpace): boolean {
    for (let inputSource of frame.session.inputSources) {
      let wrist = inputSource.hand.get('wrist');
      let wristPose = frame.getJointPose(wrist, xrReferenceSpace);
      if (wristPose) {
        let thumbTipPose = frame.getJointPose(inputSource.hand.get('thumb-tip'), xrReferenceSpace);
        let pinkyTipPose = frame.getJointPose(inputSource.hand.get('pinky-finger-tip'), xrReferenceSpace);
        let pinkyBasePose = frame.getJointPose(inputSource.hand.get('pinky-finger-metacarpal'), xrReferenceSpace);
        let thumbSubTipPose = frame.getJointPose(inputSource.hand.get('thumb-phalanx-distal'), xrReferenceSpace);
        if (pinkyTipPose && thumbTipPose) {
          let pinkyPosition = new Vector3(pinkyTipPose.transform.position.x, pinkyTipPose.transform.position.y, pinkyTipPose.transform.position.z);
          let thumbTipPosition = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
          let pinkyBasePosition = new Vector3(pinkyBasePose.transform.position.x, pinkyBasePose.transform.position.y, pinkyBasePose.transform.position.z);
          let thumbSubTipPosition = new Vector3(thumbSubTipPose.transform.position.x, thumbSubTipPose.transform.position.y, thumbSubTipPose.transform.position.z);
          let pinkyDirection = pinkyPosition.sub(pinkyBasePosition).normalize();
          let thumbDirection  = thumbTipPosition.sub(thumbSubTipPosition).normalize();
          if (pinkyDirection.distanceTo(thumbDirection) < 0.1) {
            return true;
          }
        }
      }
    }
    return false;
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
