import {
  AdditiveBlending,
  BackSide,
  Camera,
  CanvasTexture,
  MathUtils,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3
} from 'three';
import { skyFragmentShader, skyVertexShader } from '../shaders/sky';
import { createNoiseTexture } from './noise-texture';

const SUN_DISTANCE = 180;

function createSunTexture(): CanvasTexture {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 256;
  textureCanvas.height = 256;

  const context = textureCanvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 2, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,253,238,1)');
    gradient.addColorStop(0.08, 'rgba(255,248,220,1)');
    gradient.addColorStop(0.20, 'rgba(255,221,154,0.50)');
    gradient.addColorStop(0.50, 'rgba(255,181,92,0.12)');
    gradient.addColorStop(1, 'rgba(255,160,65,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }

  const texture = new CanvasTexture(textureCanvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export interface SkyController {
  sky: Mesh;
  sun: Sprite;
  uniforms: { [uniform: string]: { value: any } };
  update(time: number, camera: Camera): void;
}

export function createSky(scene: Scene, sunDirection: Vector3): SkyController {
  const noiseTexture = createNoiseTexture();
  const uniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: sunDirection },
    uSunVisibility: { value: 1 },
    tNoiseMap: { value: noiseTexture },
  };

  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
  });

  const sky = new Mesh(new SphereGeometry(200, 64, 32), material);
  sky.name = 'Sky';
  sky.renderOrder = -10;
  scene.add(sky);

  const sunMaterial = new SpriteMaterial({
    map: createSunTexture(),
    color: 0xfff1cf,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const sun = new Sprite(sunMaterial);
  sun.scale.set(14, 14, 1);
  sun.renderOrder = -5;
  scene.add(sun);

  return {
    sky,
    sun,
    uniforms,
    update(time: number, camera: Camera) {
      uniforms.uTime.value = time;
      sky.position.copy(camera.position);
      sun.position.copy(camera.position).addScaledVector(sunDirection, SUN_DISTANCE);
    },
  };
}
