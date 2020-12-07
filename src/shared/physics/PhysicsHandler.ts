import { Body, ContactMaterial, Material as CannonMaterial, NaiveBroadphase, Quaternion, Shape, World } from "cannon";
import { Material as ThreeMaterial, Mesh, Object3D, Scene } from "three";
import { BodyToMeshConverter } from './BodyToMeshConverter';

export default class PhysicsHandler {
  dt: number;
  protected readonly meshes: Object3D[];
  protected readonly bodies: Body[];
  world: World;
  public handMaterial = new CannonMaterial("hand");
  private bodyToMeshConverter = new BodyToMeshConverter();

  constructor() {
    this.dt = 1 / 60;
    this.meshes = [];
    this.bodies = [];
    this.addWorld();
  }

  addContactMaterial(material1: CannonMaterial, material2: CannonMaterial, friction, restitution) {
    let contactMaterial = new ContactMaterial(material1, material2, { friction: friction, restitution: restitution });
    this.world.addContactMaterial(contactMaterial);
  }

  private addWorld() {
    let world = new World();
    world.quatNormalizeSkip = 0;
    world.quatNormalizeFast = false;
    world.gravity.set(0, 0, 0);
    world.broadphase = new NaiveBroadphase();
    this.world = world;
  }

  updatePhysics() {
    this.world.step(this.dt);
    for (let i = 0; i !== this.meshes.length; i++) {
      if (this.meshes[i] && this.bodies[i]) {
        this.meshes[i].position.x = this.bodies[i].position.x;
        this.meshes[i].position.y = this.bodies[i].position.y;
        this.meshes[i].position.z = this.bodies[i].position.z;
        this.meshes[i].quaternion.x = this.bodies[i].quaternion.x;
        this.meshes[i].quaternion.y = this.bodies[i].quaternion.y;
        this.meshes[i].quaternion.z = this.bodies[i].quaternion.z;
        this.meshes[i].quaternion.w = this.bodies[i].quaternion.w;
      }
    }
  }

  addMesh(mesh: Mesh) {
    this.meshes.push(mesh);
  }

  addBody(body: Body) {
    this.bodies.push(body);
    this.world.addBody(body);
  }

  addToScene(body: Body, shape: Shape, shapeOrientation: Quaternion, material: ThreeMaterial, scene: Scene) {
    if (shape != null) {
      body.addShape(shape);
    }
    this.world.addBody(body);
    this.bodyToMeshConverter.shape2mesh(body, shape, material)
      .then(mesh => {
        this.bodies.push(body);
        this.meshes.push(mesh);
        scene.add(mesh);
      });
  }
}
