export const skyVertexShader = /* glsl */ `
  varying vec3 vWorldDirection;

  void main() {
    vWorldDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const skyFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform float uSunVisibility;
  uniform sampler2D tNoiseMap;
  varying vec3 vWorldDirection;

  const float NOISE_TEXTURE_SIZE = 512.0;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec2 uv = (i + f + 0.5) / NOISE_TEXTURE_SIZE;
    return texture2D(tNoiseMap, uv, -0.65).r;
  }

  float directionalFbm(vec3 direction, float scale, vec3 offset) {
    vec3 weights = pow(abs(direction), vec3(4.0));
    weights /= max(weights.x + weights.y + weights.z, 0.0001);
    vec3 p = direction * scale + offset;
    float value = 0.0;
    float amplitude = 0.5;

    for (int i = 0; i < 5; i++) {
      vec3 samples = vec3(
        valueNoise(p.yz + vec2(13.7, -4.1)),
        valueNoise(p.xz + vec2(-8.3, 17.2)),
        valueNoise(p.xy + vec2(5.9, 11.4))
      );
      value += dot(samples, weights) * amplitude;
      p = p * 2.03 + vec3(7.1, -9.4, 13.6);
      amplitude *= 0.5;
    }

    return value;
  }

  vec3 atmosphere(vec3 direction) {
    float elevation = max(direction.y, 0.0);
    float horizon = pow(1.0 - elevation, 4.0);
    vec3 horizonColor = vec3(0.075, 0.23, 0.43);
    vec3 midColor = vec3(0.022, 0.115, 0.30);
    vec3 zenithColor = vec3(0.005, 0.030, 0.105);
    vec3 color = mix(horizonColor, midColor, smoothstep(0.0, 0.38, elevation));
    color = mix(color, zenithColor, smoothstep(0.28, 1.0, elevation));
    color += vec3(0.025, 0.040, 0.052) * horizon;

    float sunAmount = max(dot(direction, uSunDirection), 0.0);
    float outerAureole = pow(sunAmount, 86.0);
    float innerAureole = pow(sunAmount, 520.0);
    float sunDisk = smoothstep(0.99994, 0.999985, sunAmount);
    color += vec3(1.0, 0.70, 0.40)
      * outerAureole * 0.065 * uSunVisibility;
    color += vec3(1.0, 0.86, 0.62)
      * innerAureole * 0.20 * uSunVisibility;
    color += vec3(1.0, 0.96, 0.82)
      * sunDisk * 2.55 * uSunVisibility;

    return color;
  }

  void main() {
    vec3 direction = normalize(vWorldDirection);
    vec3 surfaceColor = atmosphere(direction);

    float cloudFade = smoothstep(0.018, 0.12, direction.y) *
      (1.0 - smoothstep(0.84, 0.99, direction.y));
    float cloudAngle = uTime * 0.014;
    mat2 cloudWind = mat2(
      cos(cloudAngle), -sin(cloudAngle),
      sin(cloudAngle), cos(cloudAngle)
    );
    vec3 cloudDirection = direction;
    cloudDirection.xz = cloudWind * cloudDirection.xz;
    vec3 cloudDrift = vec3(uTime * 0.016, uTime * 0.002, uTime * 0.008);
    float broadCloud = directionalFbm(
      cloudDirection,
      3.4,
      vec3(0.0) + cloudDrift * 0.5
    ) * 0.72 + directionalFbm(
      cloudDirection,
      6.8,
      vec3(-8.7, 4.1, 12.8) + cloudDrift * 0.8
    ) * 0.28;
    float cloudErosion = directionalFbm(
      cloudDirection,
      13.5,
      vec3(19.2, -6.4, 3.7) + cloudDrift * 1.2
    );
    float cloudDetail = directionalFbm(
      cloudDirection,
      27.0,
      vec3(-5.3, 16.8, -11.2) + cloudDrift * 1.6
    );
    float cloud = smoothstep(0.510, 0.645, broadCloud);
    cloud *= mix(0.48, 1.0, smoothstep(0.28, 0.68, cloudErosion));
    cloud *= mix(0.72, 1.0, smoothstep(0.25, 0.72, cloudDetail));
    cloud *= cloudFade * 0.86;
    float cloudLight = clamp(
      dot(direction, uSunDirection) * 0.90 + direction.y * 0.55 + 0.42,
      0.0,
      1.0
    );
    vec3 cloudColor = mix(
      vec3(0.18, 0.27, 0.36),
      vec3(0.92, 0.96, 0.98),
      cloudLight
    );
    surfaceColor = mix(surfaceColor, cloudColor, cloud);

    // Low-altitude sunlight spokes
    vec3 sunTangent = normalize(cross(
      vec3(0.0, 1.0, 0.0),
      uSunDirection
    ));
    vec3 sunBitangent = normalize(cross(uSunDirection, sunTangent));
    float sunForward = max(dot(direction, uSunDirection), 0.025);
    vec2 rayPlane = vec2(
      dot(direction, sunTangent),
      dot(direction, sunBitangent)
    ) / sunForward;
    float rayRadius = length(rayPlane);
    vec2 rayHeading = rayPlane / max(rayRadius, 0.001);
    float broadSpokes = valueNoise(
      rayHeading * 4.2 + vec2(uTime * 0.0007, -2.8)
    );
    float fineSpokes = valueNoise(
      rayHeading * 11.3 + vec2(-7.1, uTime * 0.0011)
    );
    float spokePattern = smoothstep(
      0.28,
      0.82,
      broadSpokes * 0.72 + fineSpokes * 0.28
    );
    float rayEnvelope = smoothstep(0.018, 0.065, rayRadius)
      * (1.0 - smoothstep(0.12, 0.44, rayRadius));
    float cloudEdge = smoothstep(0.48, 0.59, broadCloud)
      * (1.0 - smoothstep(0.62, 0.73, broadCloud));
    float cloudGap = mix(1.0, 0.24, cloud);
    float shafts = spokePattern * rayEnvelope * cloudGap
      * (0.035 + cloudEdge * 0.75);
    surfaceColor += vec3(1.0, 0.74, 0.46)
      * shafts * 0.022 * uSunVisibility;

    float grain = hash21(gl_FragCoord.xy + uTime) - 0.5;
    surfaceColor += grain / 420.0;

    gl_FragColor = vec4(surfaceColor, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
