import { Body, Box, Vec3 } from 'cannon-es';
import { BoxGeometry, Mesh, MeshPhongMaterial, Scene } from 'three';
import PhysicsHandler from '../physics/physicsHandler';

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
  private material = new MeshPhongMaterial({ color: 0xFF3333 });

  constructor(scene: Scene, physicsHandler: PhysicsHandler) {
    this.scene = scene;
    this.physicsHandler = physicsHandler;
  }

  public renderHands(result) {
    const radius = 0.02;
    let meshIndex = 0;
    const centerX = VIDEO_WIDTH / 2;
    const centerY = VIDEO_HEIGHT / 2;
    const pointsData = result.map(point => {
      let x = point[0];
      x = (x - centerX) / (VIDEO_WIDTH * 2);
      let y = point[1];
      y = (y - centerY) / (VIDEO_HEIGHT * 2);
      let z = point[2] / 250;
      return [-x, -y, z + 0.3];
    })
    pointsData.map(point => {
      let handBody: Body;
      if (handMeshList[meshIndex]) {
        handBody = handMeshList[meshIndex];
      } else {
        const sphere_geometry = new BoxGeometry(radius, radius, radius);
        let mesh = new Mesh(sphere_geometry, this.material);
        this.scene.add(mesh);
        this.meshes[meshIndex] = mesh;

        handBody = new Body({mass: 0, material: this.physicsHandler.handMaterial});
        handBody.addShape(new Box(new Vec3(radius, radius, radius)));
        handMeshList[meshIndex] = handBody;
        this.physicsHandler.addBody(handBody);
        this.physicsHandler.addMesh(mesh);
      }
      handBody.position.x = point[0];
      handBody.position.y = point[1];
      handBody.position.z = point[2];
      meshIndex++;
    });
  }
}
