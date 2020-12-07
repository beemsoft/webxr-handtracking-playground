import { Body, Box, Vec3 } from 'cannon';
import { BoxGeometry, Mesh, MeshPhongMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import PhysicsHandler from '../physics/physicsHandler';
import {
  XRDevicePose,
  XRFrameOfReference,
  XRHandEnum,
  XRInputSource,
  XRJointSpace,
  XRReferenceSpace,
  XRRigidTransform
} from '../../webxr/WebXRDeviceAPI';

const orderedJoints = [
  [XRHandEnum.WRIST],
  [XRHandEnum.THUMB_METACARPAL, XRHandEnum.THUMB_PHALANX_PROXIMAL, XRHandEnum.THUMB_PHALANX_DISTAL, XRHandEnum.THUMB_PHALANX_TIP],
  [XRHandEnum.INDEX_METACARPAL, XRHandEnum.INDEX_PHALANX_PROXIMAL, XRHandEnum.INDEX_PHALANX_INTERMEDIATE, XRHandEnum.INDEX_PHALANX_DISTAL, XRHandEnum.INDEX_PHALANX_TIP],
  [XRHandEnum.MIDDLE_METACARPAL, XRHandEnum.MIDDLE_PHALANX_PROXIMAL, XRHandEnum.MIDDLE_PHALANX_INTERMEDIATE, XRHandEnum.MIDDLE_PHALANX_DISTAL, XRHandEnum.MIDDLE_PHALANX_TIP],
  [XRHandEnum.RING_METACARPAL, XRHandEnum.RING_PHALANX_PROXIMAL, XRHandEnum.RING_PHALANX_INTERMEDIATE, XRHandEnum.RING_PHALANX_DISTAL, XRHandEnum.RING_PHALANX_TIP],
  [XRHandEnum.LITTLE_METACARPAL, XRHandEnum.LITTLE_PHALANX_PROXIMAL, XRHandEnum.LITTLE_PHALANX_INTERMEDIATE, XRHandEnum.LITTLE_PHALANX_DISTAL, XRHandEnum.LITTLE_PHALANX_TIP]
];

const fingerTipsWithoutThumb = [XRHandEnum.INDEX_PHALANX_TIP, XRHandEnum.MIDDLE_PHALANX_TIP, XRHandEnum.RING_PHALANX_TIP, XRHandEnum.LITTLE_PHALANX_TIP];

const handMeshList = Array<Body>();

export default class TrackedHandsManager {
  private scene: Scene;
  private physicsHandler: PhysicsHandler;
  private camera: PerspectiveCamera;
  private readonly meshes = Array<Mesh>()
  private material = new MeshPhongMaterial({ color: 0xFF3333 });

  constructor(scene: Scene, physicsHandler: PhysicsHandler, camera: PerspectiveCamera) {
    this.scene = scene;
    this.physicsHandler = physicsHandler;
    this.camera = camera;
  }

  public isTrackedHandAvailable(frame: XRFrameOfReference) {
    for (let inputSource of frame.session.inputSources) {
      if (inputSource.hand) {
        let wrist = inputSource.hand[XRHandEnum.WRIST];
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
        let wrist = inputSource.hand[XRHandEnum.WRIST];
        if (!wrist) {
          // this code is written to assume that the wrist joint is exposed
          return;
        }
        for (let finger of orderedJoints) {
          for (let joint1 of finger) {
            let joint = inputSource.hand[joint1];
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
                  let fingerType = this.getFingerType(inputSource, joint);
                  if (fingerType) {
                    if (inputSource.handedness == 'right') {
                      fingerType += 25;
                    }
                    this.meshes[fingerType] = mesh;
                  }

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
    for (let inputSource of frame.session.inputSources) {
      let thumbTip = inputSource.hand[XRHandEnum.THUMB_PHALANX_TIP];
      let thumbTipPose = frame.getJointPose(thumbTip, xrReferenceSpace);
      if (thumbTipPose) {
        for (let fingerTip of fingerTipsWithoutThumb) {
          let fingerTipJoint = inputSource.hand[fingerTip];
          let fingerTipPose = frame.getJointPose(fingerTipJoint, xrReferenceSpace);
          if (fingerTipPose) {
            let vector1 = new Vector3(thumbTipPose.transform.position.x, thumbTipPose.transform.position.y, thumbTipPose.transform.position.z);
            let vector2 = new Vector3(fingerTipPose.transform.position.x, fingerTipPose.transform.position.y, fingerTipPose.transform.position.z);
            if (vector1.distanceTo(vector2) < thumbTipPose.radius + fingerTipPose.radius + 0.01) {
              let fingerType = this.getFingerType(inputSource, fingerTipJoint);
              if (inputSource.handedness == 'right') {
                fingerType += 25;
              }
              let mesh: Mesh = this.meshes[fingerType]
              if (mesh) {
                console.log("Change color of fingertype " + fingerType);
                this.material.color.set(0x33fdff);
                this.moveTowardsThePinchPosition(fingerTipPose.transform.position, xrReferenceSpace)
              }
              return fingerTipPose.transform.position;
            }
          }
        }
      }
    }
    this.material.color.set(0xFF3333);
    return null;
  }

  private getFingerType(inputSource: XRInputSource, joint: XRJointSpace): XRHandEnum {
    for (let fingerTip of fingerTipsWithoutThumb) {
      let fingerTipJoint = inputSource.hand[fingerTip];
      if (fingerTipJoint == joint) {
        return fingerTip;
      }
    }
    return null;
  }

  public moveTowardsThePinchPosition(position: Vector3, xrReferenceSpace: XRReferenceSpace) {
    let direction = new Vector3(position.x - this.camera.position.x, -1.5, position.z - this.camera.position.z);
    this.moveInDirection(direction, xrReferenceSpace);
  }

  private moveInDirection(direction: Vector3, xrReferenceSpace: XRReferenceSpace) {
      // @ts-ignore
      xrReferenceSpace.getOffsetReferenceSpace(new XRRigidTransform({x: -direction.x, y: 0, z: -direction.z}));
  }
}
