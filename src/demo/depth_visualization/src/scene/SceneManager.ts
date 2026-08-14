import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  TorusKnotGeometry
} from 'three';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';

export default class SceneManager extends SceneManagerParent {
  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);
    scene.background = new Color('#000000');

    camera.near = 0.01;
    camera.far = 25;
    camera.updateProjectionMatrix();
    if ((camera as any).cameras && Array.isArray((camera as any).cameras)) {
      for (const c of (camera as any).cameras) {
        c.near = 0.01;
        c.far = 25;
        c.updateProjectionMatrix();
      }
    }

    // Torus-knot field matching the depth texture demo
    const geometry = new TorusKnotGeometry(1, 0.3, 128, 64);
    // Torus knots use smooth view-space depth shader
    const torusMaterial = this.createTorusMaterial();

    // Add lights so tracked hands (MeshPhongMaterial) in WebXR render normally
    const ambientLight = new AmbientLight(0xffffff, 1.0);
    ambientLight.name = 'AmbientLight';
    scene.add(ambientLight);

    const dirLight = new DirectionalLight(0xffffff, 1.5);
    dirLight.name = 'DirLight';
    dirLight.position.set(2, 4, 3);
    scene.add(dirLight);

    const count = 50;
    const scale = 5;
    for (let i = 0; i < count; i++) {
      const r = Math.random() * 2.0 * Math.PI;
      const z = (Math.random() * 2.0) - 1.0;
      const zScale = Math.sqrt(1.0 - z * z) * scale;

      const mesh = new Mesh(geometry, torusMaterial);
      mesh.position.set(
        Math.cos(r) * zScale,
        Math.sin(r) * zScale,
        z * scale
      );
      mesh.rotation.set(Math.random(), Math.random(), Math.random());
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  // Material for the torus meshes in the main scene pass: computes exact view-space depth smoothly
  private createTorusMaterial(): ShaderMaterial {
    const mat = new ShaderMaterial({
      name: 'DepthTorusMaterial',
      uniforms: {
        uCameraNear: { value: 0.01 },
        uCameraFar: { value: 25.0 }
      },
      vertexShader: `
        precision highp float;
        varying vec3 vViewPosition;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vViewPosition;

        uniform float uCameraNear;
        uniform float uCameraFar;

        void main() {
          float viewZ = vViewPosition.z;
          float linearDepth = (viewZ + uCameraNear) / (uCameraNear - uCameraFar);
          linearDepth = clamp(linearDepth, 0.0, 1.0);

          float grayDepth = 1.0 - linearDepth;
          gl_FragColor = vec4(vec3(grayDepth), 1.0);
        }
      `
    });

    mat.onBeforeRender = (renderer, scene, camera) => {
      if (camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera) {
        mat.uniforms.uCameraNear.value = camera.near || 0.01;
        mat.uniforms.uCameraFar.value = (camera.far && camera.far <= 30) ? camera.far : 25.0;
      }
    };

    return mat;
  }

  update() {
    if (this.scene) {
      for (let i = 0; i < this.scene.children.length; i++) {
        const child = this.scene.children[i];
        if (child instanceof Mesh && child.name !== 'AmbientLight' && child.name !== 'DirLight') {
          child.rotation.x += 0.005;
          child.rotation.y += 0.01;
        }
      }
    }
  }

  isDepthEnabled(): boolean {
    return false;
  }

  isShadowEnabled(): boolean {
    return false;
  }

  getInitialCameraAngle(): number {
    return 0;
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 0, -4);
  }

}
