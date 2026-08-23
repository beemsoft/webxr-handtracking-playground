import {
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3
} from 'three';

const waterVertexShader = /* glsl */ `
  uniform sampler2D water;
  uniform float uSimScale;
  uniform float uTime;

  varying vec3 vWorldPos;
  varying vec3 vEyeVec;
  varying vec3 vViewPosition;
  varying vec2 vSimCoord;
  varying vec2 vUv;

  // Basic ocean swell & wave displacement
  float computeWaveHeight(vec2 xz, float t) {
    float h = 0.0;
    // Primary ocean swell
    h += sin(xz.x * 0.32 + xz.y * 0.20 + t * 1.2) * 0.075;
    // Secondary cross swell
    h += sin(xz.x * -0.25 + xz.y * 0.38 + t * 1.5) * 0.045;
    // Capillary waves
    h += sin(xz.x * 0.85 - xz.y * 0.70 + t * 2.2) * 0.020;
    h += cos(xz.x * 1.25 + xz.y * 1.05 + t * 2.6) * 0.012;
    return h;
  }

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec2 simCoord = worldPos.xz / uSimScale + 0.5;
    vSimCoord = simCoord;

    vec4 info = vec4(0.0);
    float edgeFade = 0.0;
    if (simCoord.x >= 0.0 && simCoord.x <= 1.0 && simCoord.y >= 0.0 && simCoord.y <= 1.0) {
      edgeFade = smoothstep(0.0, 0.06, simCoord.x) * smoothstep(1.0, 0.94, simCoord.x) *
                 smoothstep(0.0, 0.06, simCoord.y) * smoothstep(1.0, 0.94, simCoord.y);
      info = texture2D(water, simCoord);
    }
    
    vec3 transformedPos = position;
    float waveH = computeWaveHeight(worldPos.xz, uTime);
    // Displace height with ocean waves + simulation drops/ripples
    transformedPos.y += waveH + info.r * 0.45 * edgeFade;

    worldPos = modelMatrix * vec4(transformedPos, 1.0);
    vWorldPos = worldPos.xyz;

    vEyeVec = cameraPosition - worldPos.xyz;
    vec4 mvPosition = viewMatrix * worldPos;
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const waterFragmentShader = /* glsl */ `
  precision highp float;

  const float IOR_AIR = 1.0;
  const float IOR_WATER = 1.333;

  uniform sampler2D water;
  uniform sampler2D causticTex;
  uniform vec3 uSunDirection;
  uniform float uTime;
  uniform float uUnderwater;
  uniform vec3 uFogColor;
  uniform float uSimScale;

  varying vec3 vWorldPos;
  varying vec3 vEyeVec;
  varying vec3 vViewPosition;
  varying vec2 vSimCoord;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // Oceanic swell & wave normal derivatives
  vec2 computeWaveDerivatives(vec2 xz, float t) {
    vec2 d = vec2(0.0);
    // Primary swell
    float ph1 = xz.x * 0.32 + xz.y * 0.20 + t * 1.2;
    d += vec2(0.32, 0.20) * (cos(ph1) * 0.075);
    // Secondary cross swell
    float ph2 = xz.x * -0.25 + xz.y * 0.38 + t * 1.5;
    d += vec2(-0.25, 0.38) * (cos(ph2) * 0.045);
    // Capillary waves
    float ph3 = xz.x * 0.85 - xz.y * 0.70 + t * 2.2;
    d += vec2(0.85, -0.70) * (cos(ph3) * 0.020);
    float ph4 = xz.x * 1.25 + xz.y * 1.05 + t * 2.6;
    d += vec2(1.25, 1.05) * (-sin(ph4) * 0.012);
    return d;
  }

  void main() {
    vec2 simCoord = vSimCoord;
    vec4 info = vec4(0.0);
    float edgeFade = 0.0;
    if (simCoord.x >= 0.0 && simCoord.x <= 1.0 && simCoord.y >= 0.0 && simCoord.y <= 1.0) {
      edgeFade = smoothstep(0.0, 0.06, simCoord.x) * smoothstep(1.0, 0.94, simCoord.x) *
                 smoothstep(0.0, 0.06, simCoord.y) * smoothstep(1.0, 0.94, simCoord.y);
      info = texture2D(water, simCoord);
      // Multi-tap sample for sharper wave crests
      for (int i = 0; i < 3; i++) {
        simCoord += info.ba * 0.003;
        info = texture2D(water, clamp(simCoord, 0.0, 1.0));
      }
    }

    vec2 waveD = computeWaveDerivatives(vWorldPos.xz, uTime);
    vec2 simGrad = vec2(info.b, info.a) * edgeFade * 1.5;
    vec3 normal = normalize(vec3(-waveD.x + simGrad.x, 1.0, -waveD.y + simGrad.y));
    vec3 incomingRay = -normalize(vEyeVec);

    vec3 sunNorm = normalize(uSunDirection);

    // Dynamic sky reflection approximation
    float skyGradient = clamp(dot(reflect(incomingRay, normal), vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyHorizon = vec3(0.12, 0.38, 0.58);
    vec3 skyZenith = vec3(0.04, 0.16, 0.38);
    vec3 reflectedSky = mix(skyHorizon, skyZenith, pow(skyGradient, 1.5));

    if (dot(normal, incomingRay) > 0.0) {
      // Under water looking up at the water surface (Total Internal Reflection & Snell window)
      vec3 underwaterNormal = -normal;
      vec3 reflectedRay = reflect(incomingRay, underwaterNormal);
      vec3 refractedRay = refract(incomingRay, underwaterNormal, IOR_WATER / IOR_AIR);
      float fresnel = mix(0.40, 1.0, pow(1.0 - max(0.0, dot(underwaterNormal, -incomingRay)), 3.0));

      vec3 skyCol = (length(refractedRay) > 0.0) ? reflectedSky : vec3(0.03, 0.22, 0.30);
      vec3 color = mix(vec3(0.02, 0.18, 0.25), skyCol, (1.0 - fresnel) * length(refractedRay));

      // Depth-based visibility & tropical sea water extinction
      float viewDepth = length(vViewPosition);
      vec3 extinctionCoeffs = vec3(0.20, 0.075, 0.038);
      vec3 extinction = exp(-viewDepth * extinctionCoeffs);
      float maxViewDistance = 22.0;
      float visibilityFade = clamp(1.0 - smoothstep(13.0, maxViewDistance, viewDepth), 0.0, 1.0);
      vec3 effectiveExtinction = extinction * visibilityFade;
      color = mix(uFogColor, color, effectiveExtinction.y);

      gl_FragColor = vec4(color, 0.52);
    } else {
      // Above water looking down at the surface
      vec3 reflectedRay = reflect(incomingRay, normal);
      float fresnel = mix(0.08, 0.95, pow(1.0 - max(0.0, dot(normal, -incomingRay)), 3.5));

      // Specular sun highlight
      float specular = pow(max(0.0, dot(reflectedRay, sunNorm)), 48.0) * 2.2;
      reflectedSky += specular * vec3(1.0, 0.95, 0.85);

      // Tropical ocean surface color
      vec3 waterTint = vec3(0.03, 0.28, 0.36);
      vec3 surfaceColor = mix(waterTint, reflectedSky, fresnel) + specular * 0.7;

      // Distance fog on surface
      float dist = length(vEyeVec);
      float fogFactor = 1.0 - exp(-dist * 0.018);
      surfaceColor = mix(surfaceColor, uFogColor, fogFactor);

      // Semi-transparent so seabed, fish and shark are clearly visible beneath
      float alpha = mix(0.38, 0.92, fresnel);
      gl_FragColor = vec4(surfaceColor, alpha);
    }

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface WaterMeshController {
  mesh: Mesh;
  uniforms: { [uniform: string]: { value: any } };
  update(
    waterTexture: any,
    causticTexture: any,
    sunDirection: Vector3,
    time: number,
    underwaterMix: number,
    fogColor?: Color
  ): void;
}

export function createWaterMesh(size = 80, segments = 128, simScale = 20.0): WaterMeshController {
  const geometry = new PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const uniforms = {
    water: { value: null },
    causticTex: { value: null },
    uSunDirection: { value: new Vector3(0.58, 0.75, 0.45).normalize() },
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uFogColor: { value: new Color(0x063542) },
    uWaterScale: { value: size },
    uSimScale: { value: simScale },
  };

  const material = new ShaderMaterial({
    uniforms,
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'WaterSurface';
  mesh.renderOrder = 10;

  return {
    mesh,
    uniforms,
    update(
      waterTexture: any,
      causticTexture: any,
      sunDirection: Vector3,
      time: number,
      underwaterMix: number,
      fogColor?: Color
    ) {
      uniforms.water.value = waterTexture;
      uniforms.causticTex.value = causticTexture;
      uniforms.uSunDirection.value.copy(sunDirection);
      uniforms.uTime.value = time;
      uniforms.uUnderwater.value = underwaterMix;
      if (fogColor) {
        uniforms.uFogColor.value.copy(fogColor);
      }
    },
  };
}
