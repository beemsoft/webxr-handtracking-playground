import {
  FloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  WebGLRenderTarget,
  WebGLRenderer
} from 'three';

const simVertexShader = /* glsl */ `
  varying vec2 coord;
  void main() {
    coord = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const dropFragmentShader = /* glsl */ `
  precision highp float;
  precision highp int;

  const float PI = 3.141592653589793;
  uniform sampler2D texture2;
  uniform vec2 center;
  uniform float radius;
  uniform float strength;
  varying vec2 coord;

  void main() {
    vec4 info = texture2D(texture2, coord);
    float drop = max(0.0, 1.0 - length(center * 0.5 + 0.5 - coord) / radius);
    drop = 0.5 - cos(drop * PI) * 0.5;
    info.r += drop * strength;
    gl_FragColor = info;
  }
`;

const updateFragmentShader = /* glsl */ `
  precision highp float;
  precision highp int;

  uniform sampler2D texture2;
  uniform vec2 delta;
  varying vec2 coord;

  void main() {
    vec4 info = texture2D(texture2, coord);

    vec2 dx = vec2(delta.x, 0.0);
    vec2 dy = vec2(0.0, delta.y);
    float average = (
      texture2D(texture2, coord - dx).r +
      texture2D(texture2, coord - dy).r +
      texture2D(texture2, coord + dx).r +
      texture2D(texture2, coord + dy).r
    ) * 0.25;

    info.g += (average - info.r) * 2.0;
    info.g *= 0.994; // slight wave attenuation
    info.r += info.g;

    gl_FragColor = info;
  }
`;

const normalFragmentShader = /* glsl */ `
  precision highp float;
  precision highp int;

  uniform sampler2D texture2;
  uniform vec2 delta;
  varying vec2 coord;

  void main() {
    vec4 info = texture2D(texture2, coord);

    vec3 dx = vec3(delta.x, texture2D(texture2, vec2(coord.x + delta.x, coord.y)).r - info.r, 0.0);
    vec3 dy = vec3(0.0, texture2D(texture2, vec2(coord.x, coord.y + delta.y)).r - info.r, delta.y);
    info.ba = normalize(cross(dy, dx)).xz;

    gl_FragColor = info;
  }
`;

export class WaterSimulation {
  private _camera: OrthographicCamera;
  private _geometry: PlaneGeometry;
  private _textureA: WebGLRenderTarget;
  private _textureB: WebGLRenderTarget;

  texture: WebGLRenderTarget;
  _dropMesh: Mesh<PlaneGeometry, ShaderMaterial>;
  _normalMesh: Mesh<PlaneGeometry, ShaderMaterial>;
  _updateMesh: Mesh<PlaneGeometry, ShaderMaterial>;

  constructor() {
    this._camera = new OrthographicCamera(0, 1, 1, 0, 0, 2000);
    this._geometry = new PlaneGeometry(2, 2);

    this._textureA = new WebGLRenderTarget(256, 256, { type: FloatType, depthBuffer: false });
    this._textureB = new WebGLRenderTarget(256, 256, { type: FloatType, depthBuffer: false });
    this.texture = this._textureA;

    const dropMaterial = new ShaderMaterial({
      uniforms: {
        center: { value: [0, 0] },
        radius: { value: 0 },
        strength: { value: 0 },
        texture2: { value: null },
      },
      vertexShader: simVertexShader,
      fragmentShader: dropFragmentShader,
      depthWrite: false,
      depthTest: false,
    });

    const normalMaterial = new ShaderMaterial({
      uniforms: {
        delta: { value: [1 / 256, 1 / 256] },
        texture2: { value: null },
      },
      vertexShader: simVertexShader,
      fragmentShader: normalFragmentShader,
      depthWrite: false,
      depthTest: false,
    });

    const updateMaterial = new ShaderMaterial({
      uniforms: {
        delta: { value: [1 / 256, 1 / 256] },
        texture2: { value: null },
      },
      vertexShader: simVertexShader,
      fragmentShader: updateFragmentShader,
      depthWrite: false,
      depthTest: false,
    });

    this._dropMesh = new Mesh(this._geometry, dropMaterial);
    this._normalMesh = new Mesh(this._geometry, normalMaterial);
    this._updateMesh = new Mesh(this._geometry, updateMaterial);
  }

  addDrop(renderer: WebGLRenderer, x: number, y: number, radius: number, strength: number) {
    if (!this._dropMesh || !this._dropMesh.material) return;
    this._dropMesh.material.uniforms['center'].value = [x, y];
    this._dropMesh.material.uniforms['radius'].value = radius;
    this._dropMesh.material.uniforms['strength'].value = strength;

    this._render(renderer, this._dropMesh);
  }

  stepSimulation(renderer: WebGLRenderer) {
    if (!this._updateMesh || !this._updateMesh.material) return;
    this._render(renderer, this._updateMesh);
  }

  updateNormals(renderer: WebGLRenderer) {
    if (!this._normalMesh || !this._normalMesh.material) return;
    this._render(renderer, this._normalMesh);
  }

  private _render(renderer: WebGLRenderer, mesh: Mesh<PlaneGeometry, ShaderMaterial>) {
    if (!mesh || !mesh.material || !mesh.material.uniforms || !mesh.material.uniforms['texture2']) return;
    const oldTexture = this.texture;
    const newTexture = this.texture === this._textureA ? this._textureB : this._textureA;

    mesh.material.uniforms['texture2'].value = oldTexture.texture;
    renderer.setRenderTarget(newTexture);
    renderer.render(mesh, this._camera);
    this.texture = newTexture;
    renderer.setRenderTarget(null);
  }
}
