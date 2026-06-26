import {
  BoxGeometry,
  Material,
  Mesh,
  Object3D,
  PlaneGeometry,
  SphereGeometry
} from 'three';
import {Body, Shape} from 'cannon-es';

const particleGeo = new SphereGeometry( 0.5, 16, 8 );
const settings = {
  stepFrequency: 60,
  quatNormalizeSkip: 2,
  quatNormalizeFast: true,
  gx: 0,
  gy: 0,
  gz: 0,
  iterations: 3,
  tolerance: 0.0001,
  k: 1e6,
  d: 3,
  scene: 0,
  paused: false,
  rendermode: "solid",
  constraints: false,
  contacts: false,  // Contact points
  cm2contact: false, // center of mass to contact points
  normals: false, // contact normals
  axes: false, // "local" frame axes
  particleSize: 0.1,
  netRadius: 0.6,
  netHeightDiff: 0.12,
  netRadiusDiff: 0.11,
  shadows: false,
  aabbs: false,
  profiling: false,
  maxSubSteps: 20,
  dist: 0.5
};

export class BodyToMeshConverter {

  private createMeshFromShape(shape: Shape, material: Material): Mesh {
    let mesh;
    switch (shape.type) {
      case Shape.types.SPHERE:
        // @ts-ignore
        const sphere_geometry = new SphereGeometry(shape.radius, 8, 8);
        mesh = new Mesh(sphere_geometry, material);
        break;
      case Shape.types.PARTICLE:
        mesh = new Mesh(particleGeo, material);
        mesh.scale.set(settings.particleSize, settings.particleSize, settings.particleSize);
        break;

      case Shape.types.PLANE:
        let geometry = new PlaneGeometry(10, 10, 4, 4);
        mesh = new Object3D();
        const submesh = new Object3D();
        const ground = new Mesh(geometry, material);
        ground.scale.set(100, 100, 100);
        submesh.add(ground);

        ground.castShadow = true;
        ground.receiveShadow = true;

        mesh.add(submesh);
        break;

      case Shape.types.BOX:
        // @ts-ignore
        const box_geometry = new BoxGeometry(shape.halfExtents.x * 2,
          // @ts-ignore
          shape.halfExtents.y * 2,
          // @ts-ignore
          shape.halfExtents.z * 2);
        mesh = new Mesh(box_geometry, material);
        break;

      case Shape.types.CYLINDER:
        console.log('Cylinder!');
        break;

      default:
        throw "Visual type not recognized: " + shape.type;
    }

    return mesh;
  }

  public shape2mesh(body: Body, shape: Shape, material): Promise<Object3D> {
    return new Promise(resolve => {
      let obj = new Object3D();
      for (let l = 0; l < body.shapes.length; l++) {
        let shape = body.shapes[l];
        let mesh = this.createMeshFromShape(shape, material);
        const o = body.shapeOffsets[l];
        const q = body.shapeOrientations[l];
        mesh.position.set(o.x, o.y, o.z);
        mesh.quaternion.set(q.x, q.y, q.z, q.w);
        obj.add(mesh);
      }
      return resolve(obj);
    })
  };
}
