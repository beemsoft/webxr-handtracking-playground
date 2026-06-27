import {
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  MeshStandardMaterial,
  Mesh,
  AmbientLight,
  Color,
  CylinderGeometry,
  SphereGeometry
} from 'three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import { Sky } from '../../../../shared/scene/sky/Sky';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import { OceanSurf } from '../../../../shared/scene/water/OceanSurf';
import { PostProcessingConfig, PostProcessingType } from '../../../../shared/scene/SceneManagerInterface';

export default class SceneManager extends SceneManagerParent {
  private ocean: OceanSurf;
  private sky: Sky;
  private sun: Vector3 = new Vector3();

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    this.scene.background = new Color(0x87ceeb);

    const ambientLight = new AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const dirLight = new DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(10, 10, 10);
    this.scene.add(dirLight);
    this.sun.copy(dirLight.position).normalize();

    this.addOcean();
    this.addSky();
    this.addIslands();
  }

  private addOcean() {
    this.ocean = new OceanSurf();
    this.ocean.name = 'OceanSurf';
    this.ocean.position.y = 0;
    this.scene.add(this.ocean);
  }

  private addSky() {
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    this.scene.add(this.sky);
    this.sky.material.uniforms['sunPosition'].value.copy(this.sun);
  }

  private addIslands() {
    // Use a more natural-looking material for the island and rocks
    const islandMat = new MeshStandardMaterial({ color: 0xd2b48c, roughness: 0.8, metalness: 0.2 });
    const rockMat = new MeshStandardMaterial({ color: 0x808080, roughness: 0.9, metalness: 0.1 });

    // Add some random boulders to intersect with the water for foam effects
    for (let i = 0; i < 10; i++) {
      const radius = 2 + Math.random() * 4;
      // Low segment count gives a rocky, faceted look
      const rockGeom = new SphereGeometry(radius, 6, 5);
      const rock = new Mesh(rockGeom, rockMat);

      // Distort the sphere to make it look like a boulder
      rock.scale.set(
        1 + Math.random() * 0.5,
        0.5 + Math.random() * 0.5,
        1 + Math.random() * 0.5
      );
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );

      rock.position.set(
        Math.random() * 80 - 40,
        -radius * 0.2, // Slightly less submerged
        Math.random() * 80 - 40
      );
      this.scene.add(rock);
    }

    // A large main island with a gentle underwater slope
    // Truncated cone (cylinder with smaller top) creates a beach slope
    // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments)
    const islandGeom = new CylinderGeometry(15, 80, 12, 32);
    const island = new Mesh(islandGeom, islandMat);

    // Position it so the top is slightly above water (y=0) and the base is wide underwater
    // y=-5 with height 12 means top is at -5 + 6 = 1.0, and base is at -5 - 6 = -11
    island.position.set(0, -5, -25);
    this.scene.add(island);
  }

  update() {
    super.update();
    const time = this.timer.getElapsed();
    if (this.ocean) {
      this.ocean.update(time);
      (this.ocean.material as any).uniforms.uSunDirection.value.copy(this.sun);
    }
  }

  getPostProcessingConfig(): PostProcessingConfig {
    return {
      postProcessingType: PostProcessingType.None,
      toneMapping: 0,
      threshold: 0.9,
      strength: 0,
      radius: 0.5,
      exposure: 1.0
    };
  }

  isDepthEnabled(): boolean {
    return true;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 5, 15);
  }

  getInitialCameraTarget(): Vector3 {
    return new Vector3(0, 0, 0);
  }
}
