import { Mesh, MeshPhongMaterial, Scene, SphereGeometry, TextureLoader, Vector2, Vector3 } from 'three';
import { Body, Material, Sphere } from 'cannon-es';
import PhysicsHandler from '../../physics/PhysicsHandler';
import AudioHandler, { AudioDemo } from '../../audio/AudioHandler';

export class BasketballHelper {
  private scene: Scene;
  private physicsHandler: PhysicsHandler;
  private loader: TextureLoader = new TextureLoader();
  private ballMaterial = new Material("ball");
  private audioHandler = new AudioHandler();
  private ball;

  constructor(scene: Scene, physicsHandler: PhysicsHandler) {
    this.scene = scene;
    this.physicsHandler = physicsHandler;
    this.audioHandler.initAudio(AudioDemo.basketball);
  }

  addBall(): Body {
    const scale = 1;
    const ballRadius = 0.14 * scale;
    let ballSphere = new SphereGeometry( ballRadius, 16, 16 );
    let ballMaterial = new MeshPhongMaterial({
      map: this.loader.load('/textures/ball.png'),
      normalMap: this.loader.load('/textures/ball_normal.png'),
      shininess: 20,
      reflectivity: 2,
      normalScale: new Vector2(0.5, 0.5)
    });
    let ballMesh = new Mesh(ballSphere, ballMaterial);
    ballMesh.castShadow = true;
    this.physicsHandler.addMesh(ballMesh);
    let damping = 0.01;
    let mass = 0.6237;
    let sphereShape = new Sphere(ballRadius);
    this.ball = new Body({ mass: mass, material: this.ballMaterial });
    this.ball.addShape(sphereShape);
    this.ball.linearDamping = damping;
    this.ball.position.set(-1,2,-1);
    this.physicsHandler.addBody(this.ball);
    this.scene.add(ballMesh);
    this.physicsHandler.addContactMaterial(this.ballMaterial, this.physicsHandler.handMaterial, 0.001, 0.1);
    this.physicsHandler.addContactMaterial(this.ballMaterial, this.physicsHandler.groundMaterial, 0.6, 0.7);
    this.physicsHandler.addBodyControlledByHandGesture(this.ball);
    this.ball.addEventListener("collide", (e) => this.handleBallCollision(e));
    return this.ball;
  }

  handleBallCollision(e) {
    let relativeVelocity = e.contact.getImpactVelocityAlongNormal();
    let pos = new Vector3().copy(e.target.position);
    let audioElement = this.audioHandler.audioElement;
    audioElement.loop = false;
    this.audioHandler.setVolume(pos.normalize());
    if (Math.abs(relativeVelocity) > 10) {
      // More energy
      this.audioHandler.setPosition(pos.normalize());
      audioElement.play();
    } else {
      // Less energy
      this.audioHandler.setPosition(pos.normalize());
      audioElement.play();
    }
  }

}
