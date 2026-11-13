import { Color, MeshLambertMaterial, MeshLambertMaterialParameters, ShaderChunk, Texture } from 'three';
import { CausticField, causticCommonGLSL, causticReceiverGLSL, causticSunGLSL } from './CausticField';

export interface CausticMaterialOptions extends MeshLambertMaterialParameters {
  /** Triplanar limestone grain; when omitted the albedo is used as is. */
  stoneMap?: Texture;
  stoneTint?: Color;
  /** Offset brick-like tile seams on horizontal surfaces (world space, 1.5 m tiles). */
  floorTiles?: boolean;
  /** Bend vertices sideways in proportion to local height squared (algae). */
  sway?: boolean;
  /** Fish tail undulation driven by the per-instance `aPhase` attribute (nose along +x). */
  wag?: boolean;
  /**
   * Fish shading. Needs the FishGeometry attributes plus instanced `aTint` (rgb + glow), `aAccent`
   * and `aBelly`: scale albedo and fin rays come from this tile, schools get a stripe and belly
   * colour, eyes are glossy and the scales carry a faint iridescent sheen.
   */
  fishMap?: Texture;
}

/** Tail-beat amplitude; the same value bends positions and normals. */
const FISH_SWIM = '0.9';

const fishVarying = /* glsl */ `
  varying vec2 vFishUV;
  varying float vFishSkin;
  varying vec3 vFishPos;
  varying vec4 vFTint;
  varying vec3 vFAccent;
  varying vec3 vFBelly;
`;

const fishVertexPars = /* glsl */ `
  attribute vec4 aTint;
  attribute vec3 aAccent;
  attribute vec3 aBelly;
  attribute float aSkin;
  ${fishVarying}
`;

const fishVertexBody = /* glsl */ `
  vFishUV = uv;
  vFishSkin = aSkin;
  vFishPos = position;
  vFTint = aTint;
  vFAccent = aAccent;
  vFBelly = aBelly;
`;

const fishFragmentPars = /* glsl */ `
  uniform sampler2D uFishMap;
  ${fishVarying}
  float fishSkinW = 0.0;
  float fishEyeW = 0.0;
  float fishFinW = 0.0;
  vec4 fishSc = vec4(1.0);
`;

/** Body colouring as in the original: back tint with accent stripe, belly blend, scale and fin-ray detail. */
const fishFragmentColor = /* glsl */ `
  {
    vec3 p = vFishPos;
    fishSc = texture2D(uFishMap, vFishUV);
    fishEyeW = 1.0 - step(0.5, abs(vFishSkin));
    fishFinW = step(vFishSkin, -0.5);
    fishSkinW = step(0.5, vFishSkin) * (1.0 - smoothstep(0.11, 0.19, p.x));
    float stripe = smoothstep(-0.075, 0.085, p.y) * smoothstep(-0.2, -0.1, p.x) * 0.4;
    vec3 upper = mix(vFTint.rgb, vFAccent, stripe);
    float under = smoothstep(-0.075, 0.085, -p.y) * 0.75;
    vec3 albedo = mix(upper, vFBelly, under) * mix(1.0, fishSc.r, fishSkinW) * mix(1.0, fishSc.g, fishFinW);
    diffuseColor.rgb *= mix(albedo, vec3(1.0), fishEyeW);
  }
`;

const fishFragmentEmissive = /* glsl */ `
  totalEmissiveRadiance += diffuseColor.rgb * (0.1 + vFTint.w * mix(0.45, 1.0, fishSkinW));
`;

/** Cheap glint of the sun on scales and eyes plus a thin-film fresnel sheen, both scaled by the caustic light. */
const fishFragmentSheen = /* glsl */ `
  {
    vec3 V = normalize(vViewPosition);
    vec3 L = normalize((viewMatrix * vec4(-uMeanRay, 0.0)).xyz);
    vec3 H = normalize(L + V);
    float nh = saturate(dot(normal, H));
    float specK = fishEyeW * 1.6 + fishSkinW * (0.3 + 0.9 * fishSc.a);
    float spec = pow(nh, 24.0 + fishEyeW * 120.0) * specK * saturate(dot(normal, L) * 4.0);
    float fres = pow(1.0 - saturate(dot(normal, V)), 3.0);
    vec3 irid = 0.5 + 0.5 * cos(6.2831853 * (fishSc.b * 1.5 + fres * 0.6 + vec3(0.0, 0.33, 0.67)));
    float lum = dot(cLight, vec3(0.3, 0.5, 0.2));
    reflectedLight.directDiffuse += (vec3(spec) + irid * fres * fishSkinW * 0.35) * (lum + 0.03) * 0.6;
  }
`;

/**
 * Lambert material that receives the sun only through the caustic map: the direct sun contribution
 * is the caustic irradiance, so light and shadow patterns on stone, plants and fish all come from
 * the same refracted-photon pass. There is no punctual light, no alpha test and no discard.
 */
export function createCausticMaterial(field: CausticField, options: CausticMaterialOptions): MeshLambertMaterial {
  const { stoneMap, stoneTint, floorTiles, sway, wag, fishMap, ...params } = options;
  const material = new MeshLambertMaterial(params);
  const key = `caustic-${stoneMap ? 'stone' : 'plain'}-${floorTiles ? 'tiles' : 'flat'}-${sway ? 'sway' : 'rigid'}-${wag ? 'wag' : 'stiff'}-${fishMap ? 'fish' : 'inert'}`;
  material.customProgramCacheKey = () => key;

  material.onBeforeCompile = (shader) => {
    const u = field.uniforms;
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uWaveAmp = u.uWaveAmp;
    shader.uniforms.uRipples = u.uRipples;
    shader.uniforms.uCausticMap = u.uCausticMap;
    shader.uniforms.uMeanRay = u.uMeanRay;
    shader.uniforms.uRippleProj = u.uRippleProj;
    shader.uniforms.uCausticStrength = u.uCausticStrength;
    shader.uniforms.uSunColor = u.uSunColor;
    shader.uniforms.uStoneMap = { value: stoneMap ?? null };
    shader.uniforms.uStoneTint = { value: stoneTint ?? new Color(1, 1, 1) };
    if (fishMap) shader.uniforms.uFishMap = { value: fishMap };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vCWorld;
         varying vec3 vCNormal;
         ${sway || wag ? 'uniform float uTime;' : ''}
         ${wag ? 'attribute float aPhase;' : ''}
         ${fishMap ? fishVertexPars : ''}`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         ${
           wag
             ? `{
           float tail = max(0.11 - position.x, 0.0);
           float ph = uTime * 10.0 + aPhase + position.x * 17.0;
           float amp = tail * tail * 0.43 * ${FISH_SWIM};
           float slope = cos(ph) * 17.0 * amp - sin(ph) * tail * 0.86 * ${FISH_SWIM};
           objectNormal.x -= slope * objectNormal.z;
           objectNormal = normalize(objectNormal);
         }`
             : ''
         }`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         ${
           sway
             ? `{
           float h = max(transformed.y, 0.0);
           vec3 ip = vec3(0.0);
           #ifdef USE_INSTANCING
             ip = instanceMatrix[3].xyz;
           #endif
           float bend = sin(uTime * 1.3 + ip.x * 1.7 + ip.z * 2.3 + h * 2.0) * 0.12 * h * h;
           transformed.x += bend;
           transformed.z += bend * 0.6;
         }`
             : ''
         }
         ${
           wag
             ? `{
           float tail = max(0.11 - transformed.x, 0.0);
           float amp = tail * tail * 0.43 * ${FISH_SWIM};
           transformed.z += sin(uTime * 10.0 + aPhase + transformed.x * 17.0) * amp;
         }`
             : ''
         }
         ${fishMap ? fishVertexBody : ''}`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vec4 cWP = vec4(transformed, 1.0);
         vec3 cN = objectNormal;
         #ifdef USE_INSTANCING
           cWP = instanceMatrix * cWP;
           cN = mat3(instanceMatrix) * cN;
         #endif
         vCWorld = (modelMatrix * cWP).xyz;
         vCNormal = normalize(mat3(modelMatrix) * cN);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vCWorld;
         varying vec3 vCNormal;
         uniform sampler2D uStoneMap;
         uniform vec3 uStoneTint;
         ${fishMap ? fishFragmentPars : ''}
         ${causticCommonGLSL}
         ${causticSunGLSL}
         ${causticReceiverGLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         ${
           stoneMap
             ? `{
           vec3 an = abs(vCNormal);
           an /= (an.x + an.y + an.z + 1e-5);
           vec3 sp = vCWorld * 0.85;
           float grain = texture2D(uStoneMap, sp.xz).r * an.y
             + texture2D(uStoneMap, sp.xy).r * an.z
             + texture2D(uStoneMap, sp.zy).r * an.x;
           diffuseColor.rgb *= uStoneTint * (0.45 + 0.9 * grain);
         }`
             : ''
         }
         ${
           floorTiles
             ? `{
           vec2 tiles = vCWorld.xz / 1.5;
           float tileX = tiles.x + mod(floor(tiles.y), 2.0) * 0.5;
           vec2 edge = abs(fract(vec2(tileX, tiles.y)) - 0.5);
           float seam = smoothstep(0.493, 0.499, max(edge.x, edge.y));
           float near = 1.0 - smoothstep(6.0, 16.0, length(vViewPosition));
           diffuseColor.rgb *= 1.0 - seam * 0.2 * near;
         }`
             : ''
         }`
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fishMap ? fishFragmentColor : ''}`)
      .replace(
        '#include <normal_fragment_maps>',
        fishMap
          ? ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * fishSkinW;')
          : '#include <normal_fragment_maps>'
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${fishMap ? fishFragmentEmissive : ''}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         vec3 cLight = causticLight(vCWorld, normalize(vCNormal));
         reflectedLight.directDiffuse += diffuseColor.rgb * cLight * RECIPROCAL_PI;
         ${fishMap ? fishFragmentSheen : ''}`
      );
  };
  return material;
}
