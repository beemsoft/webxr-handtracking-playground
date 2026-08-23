import {
  Camera,
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { Refractor } from 'three/examples/jsm/objects/Refractor.js';
// import { Reflector } from '../../../../shared/scene/water/Reflector2';
// import { Refractor } from '../../../../shared/scene/water/Refractor2';
import { waterFragmentShader, waterVertexShader } from '../shaders/water';
import { createNoiseTexture } from './noise-texture';
import { SkyController } from './sky';

export interface OceanOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  sunDirection: Vector3;
  sky: SkyController;
  sun: Object3D;
  captureResolution?: number;
  surfaceSegments?: number;
}

export interface OceanController {
  mesh: Mesh;
  uniforms: { [uniform: string]: { value: any } };
  usesManualCaptures: boolean;
  compileCaptures(hiddenObjects?: Object3D[]): Promise<any>;
  renderReflectionCapture(hiddenObjects?: Object3D[]): void;
  renderRefractionCapture(hiddenObjects?: Object3D[]): void;
  renderCaptures(hiddenObjects?: Object3D[]): void;
  setCaptureResolution(resolution: number): void;
  getDiagnostics(): any;
  update(time: number, underwaterMix: number): void;
}

export function createOcean({
  renderer,
  scene,
  camera,
  sunDirection,
  sky,
  sun,
  captureResolution = 512,
  surfaceSegments = 80,
}: OceanOptions): OceanController {
  const noiseTexture = createNoiseTexture();
  const uniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: sunDirection },
    uDeepColor: { value: new Color('#021725') },
    uShallowColor: { value: new Color('#08b4b8') },
    uHorizonColor: { value: new Color('#0b344c') },
    uWaterDepth: { value: 3.55 },
    uUnderwater: { value: 0 },
    uReflectionTextureMatrix: { value: new Matrix4() },
    uRefractionTextureMatrix: { value: new Matrix4() },
    tReflectionMap: { value: null as any },
    tRefractionMap: { value: null as any },
    tNoiseMap: { value: noiseTexture },
  };

  const material = new ShaderMaterial({
    uniforms,
    side: DoubleSide,
    transparent: false,
    depthWrite: true,
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
  });

  const geometry = new PlaneGeometry(
    210,
    210,
    surfaceSegments,
    surfaceSegments,
  );
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'Ocean';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  scene.add(mesh);

  const captureGeometry = new PlaneGeometry(210, 210);
  const reflector = new (Reflector as any)(captureGeometry, {
    textureWidth: captureResolution,
    textureHeight: captureResolution,
    clipBias: 0.0025,
    multisample: 0,
  });
  const refractor = new (Refractor as any)(captureGeometry, {
    textureWidth: captureResolution,
    textureHeight: captureResolution,
    clipBias: 0.0025,
    multisample: 0,
  });
  reflector.getRenderTarget().samples = 0;
  refractor.getRenderTarget().samples = 0;
  reflector.rotation.x = -Math.PI / 2;
  refractor.rotation.x = -Math.PI / 2;
  reflector.updateMatrixWorld(true);
  refractor.updateMatrixWorld(true);
  uniforms.tReflectionMap.value = reflector.getRenderTarget().texture;
  uniforms.tRefractionMap.value = refractor.getRenderTarget().texture;

  const reflectionCaptureInverse = new Matrix4();
  const refractionCaptureInverse = new Matrix4();
  let currentCaptureResolution = captureResolution;
  const captureCamera = new PerspectiveCamera(60, 1, 0.1, 1000);

  function getEffectiveCamera(cam: Camera): Camera {
    if ((cam as any).isArrayCamera && (cam as any).cameras && (cam as any).cameras.length > 0) {
      const subCam = (cam as any).cameras[0];
      captureCamera.position.copy(cam.position);
      captureCamera.quaternion.copy(cam.quaternion);
      captureCamera.matrixWorld.copy(cam.matrixWorld);
      captureCamera.matrixWorldInverse.copy(cam.matrixWorldInverse);
      if (subCam && subCam.projectionMatrix) {
        captureCamera.projectionMatrix.copy(subCam.projectionMatrix);
        captureCamera.near = subCam.near || 0.1;
        captureCamera.far = subCam.far || 500;
      }
      return captureCamera;
    }
    return cam;
  }

  function updateReflectionTextureMatrix() {
    reflectionCaptureInverse.copy(reflector.matrixWorld).invert();
    uniforms.uReflectionTextureMatrix.value
      .copy(reflector.material.uniforms.textureMatrix.value)
      .multiply(reflectionCaptureInverse);
  }

  function updateRefractionTextureMatrix() {
    refractionCaptureInverse.copy(refractor.matrixWorld).invert();
    uniforms.uRefractionTextureMatrix.value
      .copy(refractor.material.uniforms.textureMatrix.value)
      .multiply(refractionCaptureInverse);
  }

  function hideCaptureScene(hiddenObjects: Object3D[] = []) {
    camera.updateMatrixWorld();
    mesh.updateMatrixWorld();

    const oceanWasVisible = mesh.visible;
    const sunWasVisible = sun.visible;
    const sunVisibility = sky.uniforms.uSunVisibility.value;
    const hiddenVisibilities = hiddenObjects.map((object) => object.visible);

    mesh.visible = false;
    sun.visible = false;
    sky.uniforms.uSunVisibility.value = 0;
    hiddenObjects.forEach((object) => { object.visible = false; });

    return () => {
      mesh.visible = oceanWasVisible;
      sun.visible = sunWasVisible;
      sky.uniforms.uSunVisibility.value = sunVisibility;
      hiddenObjects.forEach((object, index) => {
        object.visible = hiddenVisibilities[index];
      });
    };
  }

  function withCaptureScene(hiddenObjects: Object3D[], renderCapture: () => void) {
    const restoreScene = hideCaptureScene(hiddenObjects);
    const prevShadowEnabled = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    try {
      renderCapture();
    } finally {
      renderer.shadowMap.enabled = prevShadowEnabled;
      restoreScene();
    }
  }

  function compileCaptures(hiddenObjects: Object3D[] = []): Promise<any> {
    const restoreScene = hideCaptureScene(hiddenObjects);
    const previousRenderTarget = renderer.getRenderTarget();
    const prevShadowEnabled = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;

    try {
      renderer.setRenderTarget(reflector.getRenderTarget());
      const effectiveCamera = getEffectiveCamera(camera);
      if (typeof (renderer as any).compileAsync === 'function' && typeof reflector.getReflectionCamera === 'function') {
        return (renderer as any).compileAsync(scene, reflector.getReflectionCamera(effectiveCamera));
      }
      return Promise.resolve();
    } finally {
      renderer.shadowMap.enabled = prevShadowEnabled;
      renderer.setRenderTarget(previousRenderTarget);
      restoreScene();
    }
  }

  function renderReflectionCapture(hiddenObjects: Object3D[] = []) {
    withCaptureScene(hiddenObjects, () => {
      const effectiveCamera = getEffectiveCamera(camera);
      if (typeof reflector.onBeforeRender === 'function') {
        reflector.onBeforeRender(renderer, scene, effectiveCamera);
      }
      updateReflectionTextureMatrix();
    });
  }

  function renderRefractionCapture(hiddenObjects: Object3D[] = []) {
    withCaptureScene(hiddenObjects, () => {
      const effectiveCamera = getEffectiveCamera(camera);
      if (typeof refractor.onBeforeRender === 'function') {
        refractor.onBeforeRender(renderer, scene, effectiveCamera);
      }
      updateRefractionTextureMatrix();
    });
  }

  function renderCaptures(hiddenObjects: Object3D[] = []) {
    withCaptureScene(hiddenObjects, () => {
      const effectiveCamera = getEffectiveCamera(camera);
      if (typeof reflector.onBeforeRender === 'function') {
        reflector.onBeforeRender(renderer, scene, effectiveCamera);
      }
      updateReflectionTextureMatrix();
      if (typeof refractor.onBeforeRender === 'function') {
        refractor.onBeforeRender(renderer, scene, effectiveCamera);
      }
      updateRefractionTextureMatrix();
    });
  }

  return {
    mesh,
    uniforms,
    usesManualCaptures: true,
    compileCaptures,
    renderReflectionCapture,
    renderRefractionCapture,
    renderCaptures,
    setCaptureResolution(resolution: number) {
      const nextResolution = Math.max(256, Math.round(resolution));
      if (nextResolution === currentCaptureResolution) return;
      currentCaptureResolution = nextResolution;
      reflector.getRenderTarget().setSize(nextResolution, nextResolution);
      refractor.getRenderTarget().setSize(nextResolution, nextResolution);
      reflector.getRenderTarget().samples = 0;
      refractor.getRenderTarget().samples = 0;
    },
    getDiagnostics() {
      const reflectionTarget = reflector.getRenderTarget();
      const refractionTarget = refractor.getRenderTarget();
      return {
        captureResolution: currentCaptureResolution,
        reflectionSize: [reflectionTarget.width, reflectionTarget.height],
        refractionSize: [refractionTarget.width, refractionTarget.height],
        surfaceSegments,
        captureStrategy: 'reflector-refractor',
      };
    },
    update(time: number, underwaterMix: number) {
      uniforms.uTime.value = time;
      uniforms.uUnderwater.value = underwaterMix;
    },
  };
}
