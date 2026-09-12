import * as THREE from 'three';
import { noiseGLSL } from './NoiseGLSL';
import { createFloatTarget, createSimulationMaterial, runSimulationPass } from './SpectralCascade';

export interface SurfaceSprayOptions {
  compact: boolean;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  simulationScene: THREE.Scene;
  simulationCamera: THREE.Camera;
  simulationQuad: THREE.Mesh;
  uniforms: { [key: string]: THREE.IUniform };
  spectrumGLSL: string;
}

export class SurfaceSpray {
  points: THREE.Points;
  private origins: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private velocities: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private shared: { [key: string]: THREE.IUniform };
  private updateMaterial: THREE.ShaderMaterial;
  private particleMaterial: THREE.ShaderMaterial;
  private index = 0;
  private forward = new THREE.Vector3();
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.Camera;
  private simScene: THREE.Scene;
  private simCamera: THREE.Camera;
  private simQuad: THREE.Mesh;

  constructor(options: SurfaceSprayOptions) {
    const { compact, renderer, scene, camera, simulationScene, simulationCamera, simulationQuad, uniforms, spectrumGLSL } = options;
    this.renderer = renderer;
    this.camera = camera;
    this.simScene = simulationScene;
    this.simCamera = simulationCamera;
    this.simQuad = simulationQuad;

    const count = compact ? 384 : 768;
    this.origins = [createFloatTarget(count, 1), createFloatTarget(count, 1)];
    this.velocities = [createFloatTarget(count, 1), createFloatTarget(count, 1)];

    const clear = createSimulationMaterial({}, 'void main(){gl_FragColor=vec4(0,0,0,-100);}', 'SurfaceSpray_Clear');
    [...this.origins, ...this.velocities].forEach((target) =>
      runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, clear, target)
    );

    this.shared = {
      ...uniforms,
      uParticles: { value: this.origins[0].texture },
      uVelocities: { value: this.velocities[0].texture },
      uCount: { value: count },
      uDelta: { value: 0.016 },
      uEffectQuality: { value: 1.0 },
      uEmitter: { value: new THREE.Vector3() },
      uOutputVelocity: { value: 0 },
    };

    this.updateMaterial = createSimulationMaterial(
      this.shared,
      /* glsl */ `
        uniform sampler2D uParticles, uVelocities, uHeightMap;
        uniform float uTime, uCount, uDelta, uEffectQuality, uOutputVelocity, uStorm;
        uniform vec3 uEmitter;
        ${noiseGLSL}
        ${spectrumGLSL}
        void main() {
          vec2 uv = vec2(gl_FragCoord.x / uCount, 0.5);
          vec4 origin = texture2D(uParticles, uv);
          vec4 velocity = texture2D(uVelocities, uv);
          float age = uTime - origin.a;
          if (age < velocity.a) {
            gl_FragColor = uOutputVelocity > 0.5 ? velocity : origin;
            return;
          }
          float id = gl_FragCoord.x;
          float tick = floor(uTime * 12.0);
          vec2 random = vec2(hash12(vec2(id, tick)), hash12(vec2(tick, id + 7.1)));
          vec2 p = uEmitter.xz + (random - vec2(0.5)) * 75.0;
          vec4 bed = texture2D(uHeightMap, p / 550.0 + vec2(0.5));
          vec3 wave = waveDisplacement(p, 0.35, 1.0);
          vec2 slope = waveSlopeFiltered(p, 0.25, 1.0);
          float compression = smoothstep(0.32, 0.7, length(slope)) * smoothstep(0.1, 0.7, wave.y);
          float breaking = breakerPotential(p, wave.y, compression);
          float impact = bed.b * compression * smoothstep(-1.4, 0.2, bed.r);
          float energy = clamp(breaking * 0.7 + impact + compression * uStorm * 0.6, 0.0, 1.0);
          float probability = energy * uDelta * mix(0.8, 2.4, uStorm) * uEffectQuality;
          if (bed.r > wave.y || hash12(vec2(id + 43.0, tick * 1.31)) > probability) {
            gl_FragColor = uOutputVelocity > 0.5 ? velocity : origin;
            return;
          }
          vec2 direction = coastField(p).yz;
          float life = 0.6 + random.x * 1.15 + uStorm * 0.5;
          vec3 launch = vec3(direction.x * (0.4 + energy), 1.0 + energy * 2.3, direction.y * (0.4 + energy));
          launch.xz += uWindDirection * uSurfaceWind * 1.4;
          origin = vec4(p.x + wave.x, wave.y + 0.05, p.y + wave.z, uTime);
          velocity = vec4(launch, life);
          gl_FragColor = uOutputVelocity > 0.5 ? velocity : origin;
        }
      `,
      'SurfaceSpray_Update'
    );

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute(
      'particleIndex',
      new THREE.BufferAttribute(Float32Array.from({ length: count }, (_, i) => (i + 0.5) / count), 1)
    );

    this.particleMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...this.shared,
        uPixelHeight: { value: window.innerHeight || 800 },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        #include <common>
        attribute float particleIndex;
        uniform sampler2D uParticles, uVelocities;
        uniform float uTime, uPixelHeight;
        varying float vAlpha;
        void main() {
          vec4 origin = texture2D(uParticles, vec2(particleIndex, 0.5));
          vec4 velocity = texture2D(uVelocities, vec2(particleIndex, 0.5));
          float age = max(0.0, uTime - origin.a);
          float life = max(0.01, velocity.a);
          if (age >= life) {
            vAlpha = 0.0;
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 1.0;
            return;
          }
          vec3 world = origin.xyz + velocity.xyz * age - vec3(0.0, 2.5 * age * age, 0.0);
          vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(life * 0.4, life, age)) * 0.26;
          if (age > life) vAlpha = 0.0;
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = clamp((0.035 + age * 0.075) * uPixelHeight / max(1.0, -mvPosition.z), 1.0, 10.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        uniform float uGolden, uStorm, uFlash;
        varying float vAlpha;
        void main() {
          float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
          float alpha = exp(-r * r * 4.5) * vAlpha;
          if (alpha < 0.003) discard;
          vec3 tint = mix(vec3(0.83, 0.91, 0.94), vec3(1.0, 0.80, 0.49), uGolden * 0.7);
          gl_FragColor = vec4(tint * (1.0 - uStorm * 0.35 + uFlash), alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.points = new THREE.Points(geometry, this.particleMaterial);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  update(delta: number, quality: number) {
    this.points.visible = this.camera.position.y < 65;
    if (!this.points.visible) return;

    this.camera.getWorldDirection(this.forward);
    (this.shared.uEmitter.value as THREE.Vector3).copy(this.camera.position).addScaledVector(this.forward, 35);
    this.shared.uDelta.value = delta;
    this.shared.uEffectQuality.value = quality;
    this.particleMaterial.uniforms.uPixelHeight.value = this.renderer.domElement.height || window.innerHeight;

    const next = 1 - this.index;
    this.shared.uOutputVelocity.value = 0;
    runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, this.updateMaterial, this.origins[next]);
    this.shared.uOutputVelocity.value = 1;
    runSimulationPass(this.renderer, this.simScene, this.simCamera, this.simQuad, this.updateMaterial, this.velocities[next]);
    this.index = next;
    this.shared.uParticles.value = this.origins[this.index].texture;
    this.shared.uVelocities.value = this.velocities[this.index].texture;
    this.renderer.setRenderTarget(null);
  }
}
