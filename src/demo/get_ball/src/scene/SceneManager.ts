import {
  BackSide,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three';
// @ts-ignore
import { Body, Box, Plane, Quaternion, Vec3 } from 'cannon-es';
import PhysicsHandler from '../../../../shared/physics/PhysicsHandler';
import { SceneHelper } from '../../../../shared/scene/SceneHelper';
import { GestureType, SceneManagerInterface } from '../../../../shared/scene/SceneManagerInterface';
import { BasketballHelper } from '../../../../shared/scene/sport/BasketballHelper';
import HandPoseManager from '../../../../shared/hands/HandPoseManager';

export default class SceneManager implements SceneManagerInterface {
  private scene: Scene;
  private sceneHelper: SceneHelper;
  private camera: PerspectiveCamera;
  private physicsHandler: PhysicsHandler;
  private basketballHelper: BasketballHelper;
  private loader: TextureLoader = new TextureLoader();
  private ball: Body;
  private handPoseManager: HandPoseManager;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler)  {
    this.scene = scene;
    this.sceneHelper = new SceneHelper(scene);
    this.camera = camera;
    this.physicsHandler = physicsHandler;
    this.physicsHandler.world.gravity.set(0, -9.8,0);
    this.basketballHelper = new BasketballHelper(scene, physicsHandler);
    this.handPoseManager = new HandPoseManager(scene, physicsHandler);
    this.sceneHelper.addLight(true);
    this.addFloor();
    this.addHall();
    this.ball = this.basketballHelper.addBall();

  };

  addWall(length, height, positionX, positionZ, rotationY) {
    let wallMesh = new Mesh(
      new BoxGeometry( length, height, 0.1, 8, 8, 1 ),
      new MeshBasicMaterial( { color: 0xffffff, transparent: true, wireframe: false, opacity: 0 } )
    );
    wallMesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), rotationY);
    this.scene.add(wallMesh);
    this.physicsHandler.addMesh(wallMesh);
    let wallShape = new Box(new Vec3(length, height, 0.1));
    let wall = new Body({ mass: 0 });
    wall.addShape(wallShape);
    wall.position.x = positionX;
    wall.position.z = positionZ;
    wall.quaternion.setFromAxisAngle(new Vec3(0, 1, 0), rotationY);
    this.physicsHandler.addBody(wall);
  }

  addHall() {
    let texture = this.loader.load('/textures/basketball/equirectangular_court.jpg');
    let sphere = new Mesh(
      new SphereGeometry(16, 32, 32),
      new MeshBasicMaterial({
        map: texture,
        side: BackSide,
      })
    );
    sphere.rotateY(-Math.PI/5.5);
    this.scene.add(sphere);
    this.addWall(28, 20, 0, 7.5, 0);
    this.addWall(28, 20, 0, -7.5, 0);
    this.addWall(15, 20, 14, 0, Math.PI / 2);
    this.addWall(15, 20, -14, 0, Math.PI / 2);
  }

  addFloor() {
    let geometry = new PlaneGeometry(28, 15, 1, 1);
    let texture = this.loader.load('/textures/basketball-court-tiles-396756-free-texture-wall-pine-construction-tile.jpg', function (texture) {
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.offset.set(0, 0);
      texture.repeat.set(5, 5);
    });
    let material = new MeshBasicMaterial({ map: texture });
    let mesh = new Mesh(geometry, material);
    mesh.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    let groundShape = new Plane();
    let groundBody = new Body({ mass: 0, material: this.physicsHandler.groundMaterial });
    groundBody.addShape(groundShape);
    groundBody.quaternion.setFromAxisAngle(new Vec3(1,0,0),-Math.PI/2);
    groundBody.position.y -= 1.5;
    this.physicsHandler.addBody(groundBody);
    this.physicsHandler.addMesh(mesh);
  }

  update() {
    if (isNaN(this.ball.position.y) || this.ball.position.y> 10 || this.ball.position.y < -2) {
      this.ball.velocity = new Vec3(0,0,0);
      this.ball.angularVelocity = new Vec3(0,0,0);
      this.ball.position.set(0,5,0);
    }
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);

      // this.trackedHandsManager.checkFixedBall(frame, this.xrReferenceSpace);
      this.handPoseManager.openHand();
      // this.trackedHandsManager.thumbsJoining(frame, this.xrReferenceSpace);
    }
  }

  handleGesture(gesture: GestureType) {
  }

  getInitialCameraAngle(): number {
    return 0;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
