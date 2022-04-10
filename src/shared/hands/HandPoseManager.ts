import { Body, Box, Vec3 } from 'cannon-es';
import { BoxGeometry, MathUtils, Mesh, Scene, Vector3 } from 'three';
import PhysicsHandler from '../physics/PhysicsHandler';
import BallManager from './BallManager';

export const fingerLookupIndices = {
  thumb: [0, 1, 2, 3, 4],
  indexFinger: [0, 5, 6, 7, 8],
  middleFinger: [0, 9, 10, 11, 12],
  ringFinger: [0, 13, 14, 15, 16],
  pinky: [0, 17, 18, 19, 20]
}

export const VIDEO_WIDTH = 640;
export const VIDEO_HEIGHT = 500;

const handMeshList = Array<Body>();

export default class HandPoseManager {
  private scene: Scene;
  private physicsHandler: PhysicsHandler;
  private readonly meshes = Array<Mesh>()
  private pointsData = null;
  private ballManager: BallManager;

  constructor(scene: Scene, physicsHandler: PhysicsHandler) {
    this.scene = scene;
    this.physicsHandler = physicsHandler;
    this.ballManager = new BallManager(physicsHandler);
  }

  public renderHands(result) {
    const radius = 0.02;
    let meshIndex = 0;
    const centerX = VIDEO_WIDTH / 2;
    const centerY = VIDEO_HEIGHT / 2;
    this.pointsData = this.getPointsData(result, centerX, centerY)
    this.pointsData.map(point => {
      let handBody: Body;
      if (handMeshList[meshIndex]) {
        handBody = handMeshList[meshIndex];
      } else {
        handBody = this.addPoint(radius, meshIndex, handBody);
      }
      handBody.position.x = point[0];
      handBody.position.y = point[1];
      handBody.position.z = point[2];
      meshIndex++;
    });
  }

  private addPoint(radius: number, meshIndex: number, handBody: Body) {
    const sphere_geometry = new BoxGeometry(radius, radius, radius);
    let mesh = new Mesh(sphere_geometry, this.physicsHandler.handMeshMaterial);
    this.scene.add(mesh);
    this.meshes[meshIndex] = mesh;

    handBody = new Body({mass: 0, material: this.physicsHandler.handMaterial});
    handBody.addShape(new Box(new Vec3(radius, radius, radius)));
    handMeshList[meshIndex] = handBody;
    this.physicsHandler.addBody(handBody);
    this.physicsHandler.addMesh(mesh);
    return handBody;
  }

  private getPointsData(result, centerX: number, centerY: number) {
    return result.map(point => {
      let x = point[0];
      x = (x - centerX) / (VIDEO_WIDTH * 2);
      let y = point[1];
      y = (y - centerY) / (VIDEO_HEIGHT * 2);
      let z = point[2] / 275;
      return [-x, -y, z + 0.3];
    });
  }

  openHand() {
    let wristPose = this.pointsData[0];
    let wristPosition = new Vector3(wristPose[0], wristPose[1], wristPose[2]);
    if (this.ballManager.canFixBall) {
      if (wristPose) {
        let pinkTipPose = this.pointsData[20];
        let thumbTipPose = this.pointsData[4];
        if (pinkTipPose && thumbTipPose) {
          let pinkPosition = new Vector3(pinkTipPose[0], pinkTipPose[1], pinkTipPose[2]);
          pinkPosition = pinkPosition.sub(wristPosition);
          let thumbPosition = new Vector3(thumbTipPose[0], thumbTipPose[1], thumbTipPose[2]);
          thumbPosition = thumbPosition.sub(wristPosition);
          let handPosition = new Vec3((pinkTipPose[0] + thumbTipPose[0]) / 2, (pinkTipPose[1] + thumbTipPose[1]) / 2, (pinkTipPose[2] + thumbTipPose[2]) / 2);
          this.ballManager.moveBall(pinkPosition, thumbPosition, handPosition);
        }
      }
    }
    this.ballManager.checkBall(wristPosition);
  }

  isOpenHand(): boolean {
    let wristPose = this.pointsData[0];
    let wristPosition = new Vector3(wristPose[0], wristPose[1], wristPose[2]);
    if (wristPose) {
      let pinkTipPose = this.pointsData[20];
      let thumbTipPose = this.pointsData[4];
      if (pinkTipPose && thumbTipPose) {
        let pinkPosition = new Vector3(pinkTipPose[0], pinkTipPose[1], pinkTipPose[2]);
        pinkPosition = pinkPosition.sub(wristPosition);
        let thumbPosition = new Vector3(thumbTipPose[0], thumbTipPose[1], thumbTipPose[2]);
        thumbPosition = thumbPosition.sub(wristPosition);
        return (MathUtils.radToDeg(pinkPosition.angleTo(thumbPosition)) > 70);
      }
    }
  }

  isStopHand(): boolean {
    let wristPose = this.pointsData[0];
    if (wristPose) {
      let thumbTipPose = this.pointsData[4];
      let pinkyTipPose = this.pointsData[20];
      let pinkyBasePose = this.pointsData[17];
      let thumbSubTipPose = this.pointsData[3];
        let pinkyPosition = new Vector3(pinkyTipPose[0], pinkyTipPose[1], pinkyTipPose[2]);
        let thumbPosition = new Vector3(thumbTipPose[0], thumbTipPose[1], thumbTipPose[2]);
        let thumbSubTipPosition = new Vector3(thumbSubTipPose[0], thumbSubTipPose[1], thumbSubTipPose[2]);
        let pinkyBasePosition = new Vector3(pinkyBasePose[0], pinkyBasePose[1], pinkyBasePose[2]);
        let pinkyDirection = pinkyPosition.sub(pinkyBasePosition).normalize();
        let thumbDirection  = thumbPosition.sub(thumbSubTipPosition).normalize();
        if (pinkyDirection.distanceTo(thumbDirection) < 0.1) {
          return true;
        }
    }
    return false;
  }
}
