import * as THREE from 'three';

const _geom = new THREE.BufferGeometry();
_geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
_geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
_geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);

const _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

export const FS_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

export interface FullScreenPassOptions {
  defines?: Record<string, any>;
  name?: string;
  blending?: THREE.Blending;
  depthTest?: boolean;
}

export class FullScreenPass {
  material: THREE.RawShaderMaterial;
  mesh: THREE.Mesh;
  scene: THREE.Scene;

  constructor(fragment: string, uniforms: Record<string, any> = {}, opts: FullScreenPassOptions = {}) {
    this.material = new THREE.RawShaderMaterial({
      name: opts.name || 'FullScreenPass',
      glslVersion: THREE.GLSL3,
      vertexShader: `precision highp float;\nprecision highp int;\nin vec3 position;\nin vec2 uv;\n${FS_VERT}`,
      fragmentShader: `precision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler3D;\nprecision highp sampler2DArray;\n${fragment}`,
      uniforms,
      defines: opts.defines || {},
      depthTest: false,
      depthWrite: false,
      blending: opts.blending !== undefined ? opts.blending : THREE.NoBlending,
      transparent: opts.blending !== undefined && opts.blending !== THREE.NoBlending,
    });
    this.mesh = new THREE.Mesh(_geom, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
  }

  get uniforms() { return this.material.uniforms; }

  set(name: string, value: any): this {
    const u = this.material.uniforms[name];
    if (u) u.value = value;
    return this;
  }

  define(name: string, value: any): this {
    if (this.material.defines[name] !== value) {
      this.material.defines[name] = value;
      this.material.needsUpdate = true;
    }
    return this;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null = null, clear = false) {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = clear;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, _cam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
  }

  dispose() { this.material.dispose(); }
}

export interface MakeRTOptions {
  type?: THREE.TextureDataType;
  format?: THREE.PixelFormat;
  minFilter?: THREE.TextureFilter;
  magFilter?: THREE.MagnificationTextureFilter;
  wrap?: THREE.Wrapping;
  wrapS?: THREE.Wrapping;
  wrapT?: THREE.Wrapping;
  depthBuffer?: boolean;
  mipmaps?: boolean;
  count?: number;
  name?: string;
  anisotropy?: number;
}

export function makeRT(w: number, h: number, opts: MakeRTOptions = {}): THREE.WebGLRenderTarget {
  const count = opts.count || 1;
  const rt = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: opts.type || THREE.HalfFloatType,
    format: opts.format || THREE.RGBAFormat,
    minFilter: opts.minFilter || THREE.LinearFilter,
    magFilter: opts.magFilter || THREE.LinearFilter,
    wrapS: opts.wrapS || opts.wrap || THREE.ClampToEdgeWrapping,
    wrapT: opts.wrapT || opts.wrap || THREE.ClampToEdgeWrapping,
    depthBuffer: !!opts.depthBuffer,
    stencilBuffer: false,
    generateMipmaps: !!opts.mipmaps,
    count: count,
  });
  rt.texture.name = opts.name || 'rt';
  if (opts.anisotropy) rt.texture.anisotropy = opts.anisotropy;
  if (count > 1 && rt.textures) {
    for (let i = 0; i < count; i++) {
      rt.textures[i].name = `${opts.name || 'rt'}[${i}]`;
      rt.textures[i].minFilter = opts.minFilter || THREE.LinearFilter;
      rt.textures[i].magFilter = opts.magFilter || THREE.LinearFilter;
      rt.textures[i].wrapS = opts.wrapS || opts.wrap || THREE.ClampToEdgeWrapping;
      rt.textures[i].wrapT = opts.wrapT || opts.wrap || THREE.ClampToEdgeWrapping;
      rt.textures[i].generateMipmaps = !!opts.mipmaps;
      if (opts.anisotropy) rt.textures[i].anisotropy = opts.anisotropy;
    }
  }
  return rt;
}

export class PingPong {
  a: THREE.WebGLRenderTarget;
  b: THREE.WebGLRenderTarget;

  constructor(w: number, h: number, opts: MakeRTOptions = {}) {
    this.a = makeRT(w, h, { ...opts, name: (opts.name || 'pp') + 'A' });
    this.b = makeRT(w, h, { ...opts, name: (opts.name || 'pp') + 'B' });
  }

  swap() { const t = this.a; this.a = this.b; this.b = t; }
  get read() { return this.a; }
  get write() { return this.b; }
  setSize(w: number, h: number) { this.a.setSize(w, h); this.b.setSize(w, h); }
  dispose() { this.a.dispose(); this.b.dispose(); }
}
