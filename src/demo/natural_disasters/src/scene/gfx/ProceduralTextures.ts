import * as THREE from 'three';
import { FullScreenPass, makeRT } from './FullScreenPass';
import { NOISE_GLSL } from './NoiseGLSL';

const FOAM_FRAG = /* glsl */ `
${NOISE_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 oCol;
void main(){
  vec2 p = vUv;
  float w1 = 1.0 - worley2Tiled(p, 6.0);
  float w2 = 1.0 - worley2Tiled(p, 14.0);
  float w3 = 1.0 - worley2Tiled(p, 32.0);
  float w4 = 1.0 - worley2Tiled(p, 72.0);

  float clusters = clamp(w1 * 0.55 + w2 * 0.3 + w3 * 0.18, 0.0, 1.0);
  clusters = pow(clusters, 1.35);

  float bubbles = clamp(w3 * 0.5 + w4 * 0.7, 0.0, 1.0);
  bubbles = smoothstep(0.32, 0.92, bubbles);

  float fbm = fbm2Tiled(p, 8.0, 6);
  float streak = fbm2Tiled(vec2(p.x * 0.35, p.y * 3.0), 8.0, 5);

  float dissolve = clamp(fbm * 0.6 + w2 * 0.4, 0.0, 1.0);

  oCol = vec4(clusters, bubbles, clamp(fbm * 1.15, 0.0, 1.0), dissolve * 0.75 + streak * 0.25);
}
`;

const RIPPLE_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uRes;
uniform float uSlope;
in vec2 vUv;
layout(location = 0) out vec4 oCol;
float h(vec2 p){
  float a = fbm2Tiled(p, 11.0, 5);
  float b = fbm2Tiled(p + vec2(3.71, 1.29), 26.0, 4);
  float c = smoothstep(0.10, 0.95, 1.0 - worley2Tiled(p, 30.0));
  return a * 0.56 + b * 0.30 + c * 0.14;
}
void main(){
  vec2 p = vUv;
  float e = 1.5 / uRes;
  float gx = (h(p + vec2(e, 0.0)) - h(p - vec2(e, 0.0))) / (2.0 * e);
  float gy = (h(p + vec2(0.0, e)) - h(p - vec2(0.0, e))) / (2.0 * e);
  vec3 n = normalize(vec3(-gx * uSlope, 1.0, -gy * uSlope));
  oCol = vec4(n * 0.5 + vec3(0.5), h(p));
}
`;

const CLOUD_SHAPE_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uRes;
uniform float uTilesX;
in vec2 vUv;
layout(location = 0) out vec4 oCol;
void main(){
  vec2 px = floor(vUv * vec2(uRes * uTilesX, uRes));
  float tileX = floor(px.x / uRes);
  float tileY = floor(px.y / uRes);
  float z = tileX + tileY * uTilesX;
  vec3 uvw = vec3((mod(px.x, uRes) + 0.5) / uRes, (mod(px.y, uRes) + 0.5) / uRes, (z + 0.5) / uRes);

  float freq = 4.0;
  float perlin = clamp(perlinFbm3(uvw * freq, freq, 5) * 0.5 + 0.5, 0.0, 1.0);

  float w0 = 1.0 - worleyFbm3(uvw, 4.0);
  float w1 = 1.0 - worleyFbm3(uvw, 8.0);
  float w2 = 1.0 - worleyFbm3(uvw, 14.0);
  float w3 = 1.0 - worleyFbm3(uvw, 22.0);

  float perlinWorley = w0 + perlin * (1.0 - w0);

  oCol = vec4(clamp(perlinWorley, 0.0, 1.0), w1, w2, w3);
}
`;

const CLOUD_DETAIL_FRAG = /* glsl */ `
${NOISE_GLSL}
uniform float uRes;
uniform float uTilesX;
in vec2 vUv;
layout(location = 0) out vec4 oCol;
void main(){
  vec2 px = floor(vUv * vec2(uRes * uTilesX, uRes));
  float tileX = floor(px.x / uRes);
  float tileY = floor(px.y / uRes);
  float z = tileX + tileY * uTilesX;
  vec3 uvw = vec3((mod(px.x, uRes) + 0.5) / uRes, (mod(px.y, uRes) + 0.5) / uRes, (z + 0.5) / uRes);

  float w0 = 1.0 - worleyFbm3(uvw, 2.0);
  float w1 = 1.0 - worleyFbm3(uvw, 4.0);
  float w2 = 1.0 - worleyFbm3(uvw, 8.0);
  float w3 = 1.0 - worleyFbm3(uvw, 16.0);

  oCol = vec4(w0, w1, w2, w3);
}
`;

const WEATHER_MAP_FRAG = /* glsl */ `
${NOISE_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 oCol;
void main(){
  vec2 p = vUv;
  float f1 = fbm2Tiled(p, 4.0, 5);
  float f2 = fbm2Tiled(p + vec2(3.7, 1.3), 6.0, 5);
  float r = f2 * 2.0 - 1.0;
  float band = 1.0 - sqrt(r * r + 0.035);
  float synoptic = clamp(f1 * 0.62 + band * 0.55 - 0.10, 0.0, 1.0);

  float cells = 1.0 - worley2Tiled(p + vec2(0.41, 0.77), 9.0);
  float meso = clamp(fbm2Tiled(p * 1.0 + vec2(9.1, 4.4), 11.0, 4) * 0.7 + cells * 0.5, 0.0, 1.0);

  float type = clamp(smoothstep(0.42, 0.86, synoptic) * 0.8
                   + fbm2Tiled(p + vec2(6.3, 2.9), 7.0, 3) * 0.5, 0.0, 1.0);

  float core = smoothstep(0.55, 0.95, 1.0 - worley2Tiled(p + vec2(2.2, 8.8), 14.0));
  core *= smoothstep(0.35, 0.8, synoptic);

  oCol = vec4(synoptic, meso, type, core);
}
`;

const CURL_FRAG = /* glsl */ `
${NOISE_GLSL}
in vec2 vUv;
layout(location = 0) out vec4 oCol;
void main(){
  float e = 1.0 / 256.0;
  float n1 = fbm2Tiled(vUv + vec2(0.0, e), 6.0, 4);
  float n2 = fbm2Tiled(vUv - vec2(0.0, e), 6.0, 4);
  float n3 = fbm2Tiled(vUv + vec2(e, 0.0), 6.0, 4);
  float n4 = fbm2Tiled(vUv - vec2(e, 0.0), 6.0, 4);
  vec2 curl = vec2(n1 - n2, n4 - n3) / (2.0 * e);
  curl = normalize(curl + vec2(1e-6)) * 0.5 + vec2(0.5);
  oCol = vec4(curl, fbm2Tiled(vUv, 12.0, 5), fbm2Tiled(vUv, 3.0, 4));
}
`;

function bake(renderer: THREE.WebGLRenderer, frag: string, w: number, h: number, uniforms: Record<string, any> = {}, type = THREE.UnsignedByteType): THREE.WebGLRenderTarget {
  const rt = makeRT(w, h, { type, wrap: THREE.RepeatWrapping, name: 'bake' });
  const pass = new FullScreenPass(frag, uniforms, { name: 'bake' });
  pass.render(renderer, rt);
  pass.dispose();
  return rt;
}

function channelPercentiles(buf: Uint8Array, count: number, p = 0.02) {
  const lo: number[] = [], hi: number[] = [];
  for (let c = 0; c < 4; c++) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < count; i++) hist[buf[i * 4 + c]]++;
    let acc = 0, l = 0, hgh = 255;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= count * p) { l = i; break; } }
    acc = 0;
    for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= count * p) { hgh = i; break; } }
    if (hgh <= l) hgh = Math.min(255, l + 1);
    lo.push(l / 255); hi.push(hgh / 255);
  }
  return { lo, hi };
}

function atlasTo3D(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget, res: number, tilesX: number, tilesY: number): THREE.Data3DTexture {
  const w = res * tilesX, h = res * tilesY;
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  const stats = channelPercentiles(buf, w * h);
  const out = new Uint8Array(res * res * res * 4);
  for (let z = 0; z < res; z++) {
    const tx = z % tilesX, ty = Math.floor(z / tilesX);
    for (let y = 0; y < res; y++) {
      const srcRow = ((ty * res + y) * w + tx * res) * 4;
      const dstRow = ((z * res + y) * res) * 4;
      out.set(buf.subarray(srcRow, srcRow + res * 4), dstRow);
    }
  }
  const tex = new THREE.Data3DTexture(out, res, res, res);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  tex.userData.percentiles = stats;
  return tex;
}

export interface BakedTextures {
  foam: THREE.Texture;
  ripple: THREE.Texture;
  weatherMap: THREE.Texture;
  curl: THREE.Texture;
  cloudShape: THREE.Data3DTexture;
  cloudDetail: THREE.Data3DTexture;
  _foamRT?: THREE.WebGLRenderTarget;
  _rippleRT?: THREE.WebGLRenderTarget;
  _weatherRT?: THREE.WebGLRenderTarget;
  _curlRT?: THREE.WebGLRenderTarget;
}

export async function bakeProceduralTextures(renderer: THREE.WebGLRenderer, onProgress: (msg: string) => void = () => {}): Promise<BakedTextures> {
  const out: Partial<BakedTextures> = {};
  const yieldFrame = () => new Promise(r => setTimeout(r, 0));

  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());

  onProgress('baking foam & bubble rafts');
  await yieldFrame();
  const foamRT = bake(renderer, FOAM_FRAG, 2048, 2048);
  foamRT.texture.wrapS = foamRT.texture.wrapT = THREE.RepeatWrapping;
  foamRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
  foamRT.texture.generateMipmaps = true;
  foamRT.texture.anisotropy = aniso;
  foamRT.texture.needsUpdate = true;
  out.foam = foamRT.texture;
  out._foamRT = foamRT;

  onProgress('baking micro-ripple normals');
  await yieldFrame();
  const RIPPLE_RES = 1024;
  const rippleRT = bake(renderer, RIPPLE_FRAG, RIPPLE_RES, RIPPLE_RES, {
    uRes: { value: RIPPLE_RES },
    uSlope: { value: 0.12 },
  });
  rippleRT.texture.wrapS = rippleRT.texture.wrapT = THREE.RepeatWrapping;
  rippleRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
  rippleRT.texture.generateMipmaps = true;
  rippleRT.texture.anisotropy = aniso;
  rippleRT.texture.needsUpdate = true;
  out.ripple = rippleRT.texture;
  out._rippleRT = rippleRT;

  onProgress('baking weather map');
  await yieldFrame();
  const weatherRT = bake(renderer, WEATHER_MAP_FRAG, 1024, 1024);
  weatherRT.texture.wrapS = weatherRT.texture.wrapT = THREE.RepeatWrapping;
  weatherRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
  weatherRT.texture.generateMipmaps = true;
  weatherRT.texture.anisotropy = aniso;
  weatherRT.texture.needsUpdate = true;
  out.weatherMap = weatherRT.texture;
  out._weatherRT = weatherRT;

  onProgress('baking curl turbulence');
  await yieldFrame();
  const curlRT = bake(renderer, CURL_FRAG, 512, 512);
  curlRT.texture.wrapS = curlRT.texture.wrapT = THREE.RepeatWrapping;
  curlRT.texture.minFilter = THREE.LinearMipmapLinearFilter;
  curlRT.texture.generateMipmaps = true;
  curlRT.texture.anisotropy = aniso;
  curlRT.texture.needsUpdate = true;
  out.curl = curlRT.texture;
  out._curlRT = curlRT;

  onProgress('baking 3D cloud shape volume (128³)');
  await yieldFrame();
  const SHAPE_RES = 128;
  const shapeAtlasRT = bake(renderer, CLOUD_SHAPE_FRAG, SHAPE_RES * 16, SHAPE_RES * 8, {
    uRes: { value: SHAPE_RES },
    uTilesX: { value: 16 },
  });
  out.cloudShape = atlasTo3D(renderer, shapeAtlasRT, SHAPE_RES, 16, 8);
  shapeAtlasRT.dispose();

  onProgress('baking 3D cloud detail volume (32³)');
  await yieldFrame();
  const DETAIL_RES = 32;
  const detailAtlasRT = bake(renderer, CLOUD_DETAIL_FRAG, DETAIL_RES * 8, DETAIL_RES * 4, {
    uRes: { value: DETAIL_RES },
    uTilesX: { value: 8 },
  });
  out.cloudDetail = atlasTo3D(renderer, detailAtlasRT, DETAIL_RES, 8, 4);
  detailAtlasRT.dispose();

  return out as BakedTextures;
}
