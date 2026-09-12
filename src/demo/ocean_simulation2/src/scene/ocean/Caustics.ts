import * as THREE from 'three';
import { bathymetryGLSL } from './CoastalField';
import { createFloatTarget } from './SpectralCascade';

export interface CausticOptions {
  compact: boolean;
  renderer: THREE.WebGLRenderer;
  simulationCamera: THREE.Camera;
  spectralUniforms: { [key: string]: THREE.IUniform };
  timeUniform: { value: number };
  sunDirection: THREE.Vector3;
  heightMap: THREE.DataTexture;
  terrainSize: number;
  spectrumGLSL: string;
}

export class Caustics {
  causticWide: THREE.WebGLRenderTarget;
  causticDetail: THREE.WebGLRenderTarget;
  uniforms: {
    uCausticWide: { value: THREE.Texture };
    uCausticDetail: { value: THREE.Texture };
    uCausticRegion: { value: THREE.Vector3 };
    uCausticDetailActive: { value: number };
  };
  causticScene: THREE.Scene;
  causticMesh: THREE.Mesh;
  causticGeometry: THREE.PlaneGeometry;
  causticWideGeometry: THREE.PlaneGeometry;
  causticMaterial: THREE.ShaderMaterial;

  private compact: boolean;
  private renderer: THREE.WebGLRenderer;
  private simCamera: THREE.Camera;

  constructor(options: CausticOptions) {
    const { compact, renderer, simulationCamera, spectralUniforms, timeUniform, sunDirection, heightMap, terrainSize, spectrumGLSL } = options;
    this.compact = compact;
    this.renderer = renderer;
    this.simCamera = simulationCamera;

    this.causticWide = createFloatTarget(compact ? 1024 : 1536, compact ? 1024 : 1536, false);
    this.causticDetail = createFloatTarget(1024, 1024, false);

    this.uniforms = {
      uCausticWide: { value: this.causticWide.texture },
      uCausticDetail: { value: this.causticDetail.texture },
      uCausticRegion: { value: new THREE.Vector3(20, 50, 60) },
      uCausticDetailActive: { value: 0 },
    };

    this.causticScene = new THREE.Scene();
    this.causticGeometry = new THREE.PlaneGeometry(1, 1, compact ? 256 : 448, compact ? 256 : 448);
    this.causticWideGeometry = new THREE.PlaneGeometry(1, 1, compact ? 192 : 256, compact ? 192 : 256);

    this.causticMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...spectralUniforms,
        uTime: timeUniform,
        uSunDirection: { value: sunDirection },
        uHeightMap: { value: heightMap },
        uTerrainSize: { value: terrainSize },
        uRegion: { value: new THREE.Vector3(0, 0, 380) },
        uSpacing: { value: 380 / (compact ? 256 : 448) },
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
      vertexShader: /* glsl */ `
        uniform float uTime, uTerrainSize, uSpacing;
        uniform vec3 uRegion, uSunDirection;
        uniform sampler2D uHeightMap;
        varying vec3 vSource, vReceiver;
        varying float vValid;
        ${spectrumGLSL}
        ${bathymetryGLSL}
        void main() {
          vec2 p = uRegion.xy + position.xy * uRegion.z;
          float floorHeight = bedHeight(p);
          if (floorHeight >= 0.1 || floorHeight <= -27.0) {
            vSource = vec3(p.x, 0.0, p.y);
            vReceiver = vec3(p.x, floorHeight, p.y);
            vValid = 0.0;
            gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
            return;
          }
          float attenuation = shoreAttenuation(max(0.0, -floorHeight));
          vec3 displacement = waveDisplacement(p, uSpacing, attenuation);
          vec2 slope = waveSlopeFiltered(p, uSpacing * 0.75, attenuation);
          vec3 surface = vec3(p.x, 0.0, p.y) + displacement;
          vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
          vec3 ray = refract(-uSunDirection, normal, 0.7501875);
          float low = 0.0, high = 0.0;
          vec3 hit = surface;
          if (floorHeight < 0.1 && floorHeight > -32.0) {
            for (int i = 0; i < 11; i++) {
              high += 4.0;
              hit = surface + ray * high;
              if (hit.y <= bedHeight(hit.xz)) break;
              low = high;
            }
            for (int i = 0; i < 5; i++) {
              float midpoint = (low + high) * 0.5;
              vec3 testPoint = surface + ray * midpoint;
              if (testPoint.y > bedHeight(testPoint.xz)) low = midpoint; else high = midpoint;
            }
            hit = surface + ray * ((low + high) * 0.5);
          }
          vSource = surface;
          vReceiver = hit;
          vValid = (1.0 - smoothstep(-0.25, 0.1, floorHeight)) * (1.0 - smoothstep(17.0, 27.0, -floorHeight));
          gl_Position = vec4((hit.xz - uRegion.xy) / uRegion.z * 2.0, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vSource, vReceiver;
        varying float vValid;
        void main() {
          float sourceArea = length(cross(dFdx(vSource), dFdy(vSource)));
          float receivingArea = length(cross(dFdx(vReceiver), dFdy(vReceiver)));
          float concentration = clamp(sourceArea / max(receivingArea, 0.000001), 0.0, 16.0);
          float energy = concentration * clamp(vValid, 0.0, 1.0) * 0.97;
          gl_FragColor = vec4(vec3(energy), 1.0);
        }
      `,
    });

    this.causticMesh = new THREE.Mesh(this.causticGeometry, this.causticMaterial);
    this.causticMesh.frustumCulled = false;
    this.causticScene.add(this.causticMesh);
  }

  update(refreshWide = true, ready = true) {
    this.renderer.setClearColor(0x000000, 0);
    this.causticMaterial.uniforms.uRegion.value.set(0, 0, 380);
    this.causticMaterial.uniforms.uSpacing.value = 380 / (this.compact ? 192 : 256);
    if (refreshWide) {
      this.causticMesh.geometry = this.causticWideGeometry;
      this.renderer.setRenderTarget(this.causticWide);
      this.renderer.render(this.causticScene, this.simCamera);
    }
    if (this.uniforms.uCausticDetailActive.value > 0.001 || !ready) {
      this.causticMesh.geometry = this.causticGeometry;
      this.causticMaterial.uniforms.uRegion.value.copy(this.uniforms.uCausticRegion.value);
      this.causticMaterial.uniforms.uSpacing.value = 60 / (this.compact ? 256 : 448);
      this.renderer.setRenderTarget(this.causticDetail);
      this.renderer.render(this.causticScene, this.simCamera);
    }
    this.renderer.setRenderTarget(null);
  }
}
