import {BoxGeometry, MathUtils, Mesh, MeshNormalMaterial, Scene, Vector3} from 'three/src/Three';

export const fingerLookupIndices = {
  thumb: [0, 1, 2, 3, 4],
  indexFinger: [0, 5, 6, 7, 8],
  middleFinger: [0, 9, 10, 11, 12],
  ringFinger: [0, 13, 14, 15, 16],
  pinky: [0, 17, 18, 19, 20]
}

export const VIDEO_WIDTH = 640;
export const VIDEO_HEIGHT = 500;

const handMeshList = Array<Mesh>();

export default class HandPoseWithoutPhysicsManager {
  private scene: Scene;
  private readonly meshes = Array<Mesh>()
  private pointsData = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  public renderHands(result, offset: Vector3) {
    const radius = 0.02;
    let meshIndex = 0;
    const centerX = VIDEO_WIDTH / 2;
    const centerY = VIDEO_HEIGHT / 2;
    this.pointsData = this.getPointsData(result, centerX, centerY)
    this.pointsData.map(point => {
      let handBody: Mesh;
      if (handMeshList[meshIndex]) {
        handBody = handMeshList[meshIndex];
      } else {
        handBody = this.addPoint(radius, meshIndex, handBody);
      }
      handBody.position.x = point[0] + offset.x;
      handBody.position.y = point[1] + offset.y;
      handBody.position.z = point[2] + offset.z;
      meshIndex++;
    });
  }

  private addPoint(radius: number, meshIndex: number, handBody: Mesh) {
    const sphere_geometry = new BoxGeometry(radius, radius, radius);

    const material = new MeshNormalMaterial();
    handBody = new Mesh(sphere_geometry, material);
    this.scene.add(handBody);
    this.meshes[meshIndex] = handBody;
    this.scene.add(handBody);
    handMeshList[meshIndex] = handBody;
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
