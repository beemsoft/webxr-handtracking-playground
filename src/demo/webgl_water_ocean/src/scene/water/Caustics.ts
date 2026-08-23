import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer
} from 'three';

const causticVertexShader = /* glsl */ `
  precision highp float;
  precision highp int;

  const float IOR_AIR = 1.0;
  const float IOR_WATER = 1.333;

  uniform vec3 light;
  uniform sampler2D water;

  varying vec3 oldPos;
  varying vec3 newPos;
  varying vec3 ray;

  vec3 project(vec3 origin, vec3 rayDir, vec3 refractedLight) {
    float tplane = (-origin.y - 1.0) / max(refractedLight.y, 0.001);
    return origin + refractedLight * tplane;
  }

  void main() {
    vec4 info = texture2D(water, position.xy * 0.5 + 0.5);
    info.ba *= 0.5;
    vec3 normal = vec3(info.b, sqrt(max(0.001, 1.0 - dot(info.ba, info.ba))), info.a);

    vec3 normLight = normalize(light);
    vec3 refractedLight = refract(-normLight, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
    ray = refract(-normLight, normal, IOR_AIR / IOR_WATER);
    oldPos = project(position.xzy, refractedLight, refractedLight);
    newPos = project(position.xzy + vec3(0.0, info.r, 0.0), ray, refractedLight);

    gl_Position = vec4(0.75 * (newPos.xz + refractedLight.xz / max(refractedLight.y, 0.001)), 0.0, 1.0);
  }
`;

const causticFragmentShader = /* glsl */ `
  precision highp float;
  precision highp int;

  varying vec3 oldPos;
  varying vec3 newPos;
  varying vec3 ray;

  void main() {
    float oldArea = length(dFdx(oldPos)) * length(dFdy(oldPos));
    float newArea = length(dFdx(newPos)) * length(dFdy(newPos));
    float intensity = oldArea / max(newArea, 0.00001) * 0.25;
    gl_FragColor = vec4(clamp(intensity, 0.0, 1.0), 1.0, 0.0, 1.0);
  }
`;

export class Caustics {
  private _camera: OrthographicCamera;
  private _geometry: PlaneGeometry;
  private _causticMesh: Mesh<PlaneGeometry, ShaderMaterial>;
  texture: WebGLRenderTarget;

  constructor(resolution = 128) {
    this._camera = new OrthographicCamera(0, 1, 1, 0, 0, 2000);
    this._geometry = new PlaneGeometry(2, 2, resolution, resolution);
    this.texture = new WebGLRenderTarget(512, 512, {
      type: UnsignedByteType,
      depthBuffer: false,
    });

    const material = new ShaderMaterial({
      uniforms: {
        light: { value: new Vector3(0.58, 0.75, 0.45).normalize() },
        water: { value: null },
      },
      vertexShader: causticVertexShader,
      fragmentShader: causticFragmentShader,
      depthWrite: false,
      depthTest: false,
    });

    this._causticMesh = new Mesh(this._geometry, material);
  }

  update(renderer: WebGLRenderer, waterTexture: any, sunDirection?: Vector3) {
    if (!this._causticMesh || !this._causticMesh.material) return;
    this._causticMesh.material.uniforms['water'].value = waterTexture;
    if (sunDirection) {
      this._causticMesh.material.uniforms['light'].value.copy(sunDirection);
    }

    renderer.setRenderTarget(this.texture);
    renderer.render(this._causticMesh, this._camera);
    renderer.setRenderTarget(null);
  }
}
