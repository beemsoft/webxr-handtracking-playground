import * as THREE from 'three';
import { createFloatTarget, createSimulationMaterial, runSimulationPass } from './SpectralCascade';

export interface SurfaceProbeOptions {
  renderer: THREE.WebGLRenderer;
  simulationScene: THREE.Scene;
  simulationCamera: THREE.Camera;
  simulationQuad: THREE.Mesh;
  uniforms: { [key: string]: THREE.IUniform };
  spectrumGLSL: string;
}

export class SurfaceProbe {
  height = 0;
  mean = 0;
  ceiling = 0;
  slopeX = 0;
  slopeZ = 0;
  pending = false;

  private renderer: THREE.WebGLRenderer;
  private simScene: THREE.Scene;
  private simCamera: THREE.Camera;
  private simQuad: THREE.Mesh;
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private timer = 0;

  constructor(options: SurfaceProbeOptions) {
    const { renderer, simulationScene, simulationCamera, simulationQuad, uniforms, spectrumGLSL } = options;
    this.renderer = renderer;
    this.simScene = simulationScene;
    this.simCamera = simulationCamera;
    this.simQuad = simulationQuad;

    this.target = createFloatTarget(4, 1);
    this.material = createSimulationMaterial(
      {
        ...uniforms,
        uProbe: { value: new THREE.Vector2() },
      },
      /* glsl */ `
        uniform float uTime;
        uniform vec2 uProbe;
        uniform sampler2D uHeightMap;
        ${spectrumGLSL}
        void main() {
          float i = floor(gl_FragCoord.x);
          vec2 offset = i < 0.5 ? vec2(0.0) : i < 1.5 ? vec2(-4.0, 2.0) : i < 2.5 ? vec2(4.0, 2.0) : vec2(0.0, -4.0);
          vec2 p = uProbe + offset;
          p -= waveDisplacement(p, 0.3, 1.0).xz;
          vec3 wave = waveDisplacement(p, 0.3, 1.0);
          vec2 slope = waveSlopeFiltered(p, 1.0, 1.0);
          float tide = 0.07 * sin(uTime * 0.29) + 0.035 * sin(uTime * 0.47 + 1.7);
          gl_FragColor = vec4(wave.y + tide, slope, 1.0);
        }
      `,
      'SurfaceProbe_Sim'
    );
  }

  update(delta: number, position: THREE.Vector3) {
    this.ceiling = Math.max(this.height, this.ceiling - delta * 0.35);
    this.timer += delta;
    if (this.timer < 0.1 || this.pending) return;
    this.timer = 0;
    this.pending = true;

    this.material.uniforms.uProbe.value.set(position.x, position.z);
    runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, this.material, this.target);
    this.renderer.setRenderTarget(null);

    const buffer = new Uint16Array(16);
    this.renderer
      .readRenderTargetPixelsAsync(this.target, 0, 0, 4, 1, buffer)
      .then(() => {
        const h = Array.from({ length: 4 }, (_, i) => THREE.DataUtils.fromHalfFloat(buffer[i * 4]));
        const sx = THREE.DataUtils.fromHalfFloat(buffer[1]);
        const sz = THREE.DataUtils.fromHalfFloat(buffer[2]);
        if (h.every(Number.isFinite) && Number.isFinite(sx) && Number.isFinite(sz)) {
          this.height = h[0];
          this.mean = h.reduce((a, b) => a + b, 0) / 4;
          this.ceiling = Math.max(this.ceiling, ...h);
          this.slopeX = sx;
          this.slopeZ = sz;
        }
      })
      .catch(() => {})
      .finally(() => {
        this.pending = false;
      });
  }
}
