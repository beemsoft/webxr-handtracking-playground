import {
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import { Body, Material, Sphere, Vec3 } from 'cannon-es';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';

export default class SceneManager extends SceneManagerParent {
  private loader: TextureLoader = new TextureLoader();
  private ball: Body;
  private ballMaterial: Material;
  private handSettings = { handRadius: .15 };

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    this.physicsHandler.world.gravity.set(0, -9.8,0);
    this.sceneHelper.addLight(true);
    this.addBall();
    this.addCatcher();
    this.sceneHelper.addMessage('Catch the ball and throw it!', renderer.capabilities.getMaxAnisotropy());
  }

  addBall(){
    const scale = 1;
    const ballRadius = 0.15 * scale;
    let ballSphere = new SphereGeometry( ballRadius, 16, 16 );
    let ballMaterial = new MeshPhongMaterial({
      map: this.loader.load('/textures/ball.png'),
      normalMap: this.loader.load('/textures/ball_normal.png'),
      shininess: 20,
      reflectivity: 2,
      normalScale: new Vector2(0.5, 0.5)
    });
    let ballMesh = new Mesh(ballSphere, ballMaterial);
    this.physicsHandler.addMesh(ballMesh);
    let damping = 0.01;
    let mass = 0.1;
    let sphereShape = new Sphere(ballRadius);
    this.ballMaterial = new Material("ball");
    let ball = new Body({ mass: mass, material: this.ballMaterial });
    ball.addShape(sphereShape);
    ball.linearDamping = damping;
    ball.position.set(0,5,0);
    this.physicsHandler.addBody(ball);
    this.ball = ball;
    this.scene.add(ballMesh);
    this.physicsHandler.addContactMaterial(this.ballMaterial, this.physicsHandler.handMaterial, 0.01, 0.2);
  }

  addCatcher() {
    let hand_material = new MeshBasicMaterial({
      color: 0x6e736f,
      wireframe: true
    });
    const Ncols = 5;
    const angle = 360 / Ncols;
    let body = new Body({
      mass: 0,
      material: this.physicsHandler.handMaterial
    });
    for(let i=0; i<Ncols; i++){
      let radians = this.toRadians(angle * i);
      let rowRadius = this.handSettings.handRadius;

      let relativePosition = new Vec3(
        rowRadius * Math.sin(radians),
        0,
        rowRadius * Math.cos(radians)
      );

      body.addShape(new Sphere(0.05), relativePosition);
    }
    this.physicsHandler.addToScene(body, null, null, hand_material, this.scene);
  }

  toRadians(angle) {
    return angle * (Math.PI / 180);
  }

  update() {
    if (this.ball.position.y < -0.75) {
      this.ball.velocity = new Vec3(0,0,0);
      this.ball.angularVelocity = new Vec3(0,0,0);
      this.ball.position.set(0,5,0);
    }
  }

  updateHandPose(result) {
    if (this.handPoseManager) {
      this.handPoseManager.renderHands(result);
    }
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(-0.5, 1.75, 4);
  }
}
