export const abyssDomeVertexShader = /* glsl */ `
  varying vec3 vWorldDirection;
  varying vec3 vWorldPosition;

  void main() {
    vWorldDirection = position;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const abyssDomeFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform float uUnderwater;
  uniform vec3 uFogColor;
  uniform vec3 uShallowColor;
  uniform vec3 uDeepColor;
  varying vec3 vWorldDirection;
  varying vec3 vWorldPosition;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 dir = normalize(vWorldDirection);

    // Thick oceanic fog gradient (Ship in the fog style)
    // At horizon (dir.y = 0.0), color matches uFogColor exactly for seamless blending with distant terrain & water
    float upFactor = pow(clamp(dir.y, 0.0, 1.0), 1.25);
    float downFactor = pow(clamp(-dir.y, 0.0, 1.0), 1.15);
    
    vec3 backdropColor = uFogColor;
    backdropColor = mix(backdropColor, uShallowColor, upFactor);
    backdropColor = mix(backdropColor, uDeepColor, downFactor);

    // Soft volumetric oceanic mist density variation (thick fog style)
    float mistA = sin(dir.x * 4.5 + dir.z * 3.8 + uTime * 0.08) * cos(dir.y * 5.2 - uTime * 0.05);
    float mistB = sin(dir.z * 7.2 - dir.x * 5.4 + uTime * 0.12 + 1.7);
    float softMist = (mistA * 0.62 + mistB * 0.38) * 0.028 * smoothstep(-0.4, 0.7, dir.y);
    backdropColor += vec3(0.015, 0.055, 0.075) * softMist;

    // Refract the sun direction through the water-air interface (Snell's Law)
    const float eta = 1.0 / 1.333;
    vec2 refractedHorizontal = uSunDirection.xz * eta;
    float refractedVertical = sqrt(max(
      1.0 - dot(refractedHorizontal, refractedHorizontal),
      0.001
    ));
    vec3 refractedSun = normalize(vec3(
      refractedHorizontal.x,
      refractedVertical,
      refractedHorizontal.y
    ));

    // Underwater sunlight forward scattering halo in thick oceanic fog
    float sunScatter = max(0.0, dot(dir, refractedSun));
    float halo = (pow(sunScatter, 5.0) * 0.28 + pow(sunScatter, 22.0) * 0.52) * smoothstep(-0.15, 0.80, dir.y);
    vec3 sunGlow = vec3(0.20, 0.72, 0.85) * halo;

    // Soft, diffused light rays through water mist
    vec3 rayTangent = normalize(cross(refractedSun, vec3(0.0, 1.0, 0.0)));
    vec3 rayBitangent = normalize(cross(rayTangent, refractedSun));
    float alongRay = max(dot(dir, refractedSun), 0.001);
    vec2 rayUv = vec2(
      dot(dir, rayTangent),
      dot(dir, rayBitangent)
    ) / alongRay;
    float rayCone = pow(max(dot(dir, refractedSun), 0.0), 8.0);
    float rayBands = pow(
      0.5 + 0.5 * sin(rayUv.x * 12.0 + sin(rayUv.y * 2.5 + uTime * 0.35) * 1.8 + uTime * 0.04),
      3.0
    );
    float shafts = rayCone * (0.20 + 0.80 * rayBands) * smoothstep(-0.10, 0.75, dir.y);
    vec3 shaftColor = vec3(0.04, 0.22, 0.26) * shafts * 0.65;

    vec3 finalColor = backdropColor + sunGlow + shaftColor;

    // Subtle temporal dither
    float grain = hash21(gl_FragCoord.xy + uTime) - 0.5;
    finalColor += grain / 420.0;

    gl_FragColor = vec4(finalColor, uUnderwater);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
