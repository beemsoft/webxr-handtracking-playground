export const waterFragmentFunctions = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec2 hash22(vec2 p) {
    return vec2(
      hash21(p + vec2(17.1, 3.7)),
      hash21(p + vec2(5.3, 29.9))
    );
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    // The texture stores deterministic random lattice values. Warping the
    // fractional coordinate before hardware bilinear filtering reproduces
    // smooth value noise without inlining four hash evaluations at every one
    // of the shader's many noise call sites.
    vec2 uv = (i + f + 0.5) / NOISE_TEXTURE_SIZE;
    // A small negative bias retains resolved foam/glitter filaments while the
    // mip chain still removes sub-pixel shimmer in distant views.
    return texture2D(tNoiseMap, uv, -0.65).r;
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.80, -0.60, 0.60, 0.80);

    for (int i = 0; i < 3; i++) {
      value += amplitude * valueNoise(p);
      p = rotation * p * 2.04 + 9.2;
      amplitude *= 0.5;
    }

    return value;
  }

  float directionalFbm(vec3 direction, float scale, vec3 offset) {
    vec3 weights = pow(abs(direction), vec3(4.0));
    weights /= max(weights.x + weights.y + weights.z, 0.0001);
    vec3 p = direction * scale + offset;
    float value = 0.0;
    float amplitude = 0.5;

    for (int i = 0; i < 4; i++) {
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

  float distributionGGX(float alpha, float normalDotHalf) {
    float alphaSquared = alpha * alpha;
    float denominator = normalDotHalf * normalDotHalf * (alphaSquared - 1.0) + 1.0;
    return alphaSquared / max(WATER_PI * denominator * denominator, 0.00001);
  }

  float visibilitySmithGGXCorrelated(
    float alpha,
    float normalDotView,
    float normalDotLight
  ) {
    float alphaSquared = alpha * alpha;
    float viewTerm = normalDotLight * sqrt(
      alphaSquared + (1.0 - alphaSquared) * normalDotView * normalDotView
    );
    float lightTerm = normalDotView * sqrt(
      alphaSquared + (1.0 - alphaSquared) * normalDotLight * normalDotLight
    );
    return 0.5 / max(viewTerm + lightTerm, 0.00001);
  }

  float fresnelSchlick(float viewDotHalf) {
    const float waterF0 = 0.02037;
    float grazing = pow(1.0 - viewDotHalf, 5.0);
    return waterF0 + (1.0 - waterF0) * grazing;
  }

  void addRipple(
    vec2 p,
    vec2 direction,
    float frequency,
    float amplitude,
    float speed,
    inout vec2 gradient
  ) {
    direction = normalize(direction);
    float phase = dot(p, direction) * frequency + uTime * speed;
    gradient += direction * (amplitude * frequency * cos(phase));
  }

  float microHeight(vec2 p) {
    mat2 turn = mat2(0.78, -0.63, 0.63, 0.78);
    vec2 drift = vec2(uTime * 0.068, -uTime * 0.047);
    float broad = valueNoise(p * 1.65 + drift);
    float middle = valueNoise(turn * p * 3.7 - drift * 1.37 + 13.7);
    float detail = valueNoise(turn * p * 7.9 + drift * 1.74 - 8.4);
    mat2 counterTurn = mat2(0.58, 0.81, -0.81, 0.58);
    float fine = valueNoise(counterTurn * p * 15.8 - drift * 2.1 + 31.6);
    float sparkle = valueNoise(turn * p * 31.0 + drift * 2.8 - 21.9);
    return broad * 0.030 + middle * 0.015 + detail * 0.0065
      + fine * 0.0026 + sparkle * 0.0009;
  }

  vec2 microGradient(vec2 p, float distanceToCamera) {
    vec2 warp = vec2(
      fbm(p * 0.16 + vec2(uTime * 0.018, -uTime * 0.011)),
      fbm(p * 0.16 + vec2(17.4, -9.2) + vec2(-uTime * 0.013, uTime * 0.016))
    ) - 0.5;
    p += warp * 1.55;

    vec2 coarseGradient = vec2(0.0);
    vec2 mediumGradient = vec2(0.0);
    vec2 fineGradient = vec2(0.0);
    addRipple(p, vec2(0.86, 0.51), 1.15, 0.0240, -0.78, coarseGradient);
    addRipple(p, vec2(-0.52, 0.85), 1.78, 0.0155, 1.02, coarseGradient);
    addRipple(p, vec2(0.97, -0.24), 2.75, 0.0095, -1.46, mediumGradient);
    addRipple(p, vec2(-0.31, 0.95), 4.65, 0.0053, 1.88, mediumGradient);
    addRipple(p, vec2(0.18, -0.98), 7.9, 0.00225, -2.43, fineGradient);
    addRipple(p, vec2(0.68, 0.73), 13.2, 0.00082, 3.10, fineGradient);

    // Each spatial band has a different distance cutoff. This preserves
    // irregular chop in wide views without shrinking capillary waves into
    // repeating screen-space stripes near the horizon.
    float coarseFade = 1.0 - smoothstep(120.0, 285.0, distanceToCamera);
    float mediumFade = 1.0 - smoothstep(55.0, 175.0, distanceToCamera);
    float fineDistanceFade = 1.0 - smoothstep(20.0, 92.0, distanceToCamera);
    float footprint = max(length(dFdx(p)), length(dFdy(p)));
    float fineFootprintFade = 1.0 - smoothstep(0.025, 0.19, footprint);
    float epsilon = 0.028;
    vec2 noiseGradient = vec2(
      microHeight(p + vec2(epsilon, 0.0)) - microHeight(p - vec2(epsilon, 0.0)),
      microHeight(p + vec2(0.0, epsilon)) - microHeight(p - vec2(0.0, epsilon))
    ) / (2.0 * epsilon);
    return coarseGradient * coarseFade
      + mediumGradient * mediumFade
      + fineGradient * fineDistanceFade * fineFootprintFade
      + noiseGradient * mediumFade * fineFootprintFade;
  }

  vec3 skyReflection(vec3 direction) {
    float elevation = max(direction.y, 0.0);
    vec3 horizonColor = vec3(0.075, 0.23, 0.43);
    vec3 zenithColor = vec3(0.007, 0.045, 0.16);
    vec3 color = mix(horizonColor, zenithColor, smoothstep(0.0, 0.82, elevation));

    float cloudAngle = uTime * 0.014;
    mat2 cloudWind = mat2(
      cos(cloudAngle), -sin(cloudAngle),
      sin(cloudAngle), cos(cloudAngle)
    );
    vec3 cloudDirection = direction;
    cloudDirection.xz = cloudWind * cloudDirection.xz;
    vec3 cloudDrift = vec3(uTime * 0.016, uTime * 0.002, uTime * 0.008);
    float cloudBody = directionalFbm(
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
    float cloud = smoothstep(0.510, 0.645, cloudBody);
    cloud *= mix(0.48, 1.0, smoothstep(0.28, 0.68, cloudErosion));
    cloud *= mix(0.72, 1.0, smoothstep(0.25, 0.72, cloudDetail));
    cloud *= smoothstep(0.02, 0.16, direction.y)
      * (1.0 - smoothstep(0.88, 0.99, direction.y)) * 0.82;
    float cloudLight = clamp(dot(direction, uSunDirection) * 0.9 + 0.55, 0.0, 1.0);
    vec3 cloudColor = mix(vec3(0.20, 0.30, 0.40), vec3(0.88, 0.93, 0.96), cloudLight);
    color = mix(color, cloudColor, cloud);

    return color;
  }

  float cloudShadowMask(vec2 surfacePosition) {
    vec2 shadowUv = surfacePosition * 0.018
      + vec2(uTime * 0.012, uTime * 0.006);
    float broad = fbm(shadowUv) * 0.77
      + fbm(shadowUv * 2.17 - 14.3) * 0.23;
    float edge = fbm(shadowUv * 4.3 + 7.9);
    float body = smoothstep(0.50, 0.66, broad);
    return body * mix(0.64, 1.0, smoothstep(0.27, 0.68, edge));
  }

  // A low-frequency stream function produces a divergence-free displacement
  // field. Sampling it in the shared advected frame curves every foam octave
  // together, preserving material motion without a ruler-straight wake.
  vec2 foamCurlDisplacement(vec2 p) {
    vec2 waveVectorA = vec2(0.044, 0.071);
    vec2 waveVectorB = vec2(-0.081, 0.036);
    vec2 waveVectorC = vec2(0.112, -0.096);
    vec2 waveVectorD = vec2(-0.214, -0.168);
    vec2 waveVectorE = vec2(0.310, 0.082);
    float phaseA = dot(p, waveVectorA) + uTime * 0.012 + 1.4;
    float phaseB = dot(p, waveVectorB) - uTime * 0.009 - 2.7;
    float phaseC = dot(p, waveVectorC) + uTime * 0.016 + 4.1;
    float phaseD = dot(p, waveVectorD) + uTime * 0.021 + 0.8;
    float phaseE = dot(p, waveVectorE) - uTime * 0.024 - 3.5;
    vec2 curl = vec2(waveVectorA.y, -waveVectorA.x)
      * cos(phaseA) * 23.0;
    curl += vec2(waveVectorB.y, -waveVectorB.x)
      * cos(phaseB) * 12.5;
    curl += vec2(waveVectorC.y, -waveVectorC.x)
      * cos(phaseC) * 5.2;
    curl += vec2(waveVectorD.y, -waveVectorD.x)
      * cos(phaseD) * 3.7;
    curl += vec2(waveVectorE.y, -waveVectorE.x)
      * cos(phaseE) * 1.35;
    return curl;
  }

  // Foam packets are born at staggered material-space emitters and spread
  // before breaking apart. The packet state controls spatial erosion later;
  // it must never be used as a packet-wide opacity or the foam visibly fades.
  vec2 foamLifecycle(vec2 flowUv) {
    vec2 packetPosition = flowUv * vec2(0.18, 0.26);
    vec2 baseCell = floor(packetPosition);
    vec2 localPosition = fract(packetPosition);
    vec2 strongestPacket = vec2(0.0, 1.0);

    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 cellOffset = vec2(float(x), float(y));
        vec2 cellId = baseCell + cellOffset;
        vec2 seed = hash22(cellId);
        vec2 packetOffset = cellOffset + seed - localPosition;
        float packetDistance = length(packetOffset * vec2(0.72, 1.18));
        float cycle = mix(
          9.5,
          14.5,
          hash21(cellId + vec2(9.4, -3.2))
        );
        float lifetime = mix(
          4.8,
          8.0,
          hash21(cellId + vec2(-6.8, 12.7))
        );
        float age = mod(
          uTime + hash21(cellId + vec2(2.1, 18.4)) * cycle,
          cycle
        );
        float normalizedAge = age / lifetime;
        float alive = 1.0 - step(lifetime, age);
        float packetRadius = mix(
          0.46,
          0.84,
          smoothstep(0.0, 0.76, normalizedAge)
        );
        float influence = 1.0 - smoothstep(
          packetRadius * 0.54,
          packetRadius,
          packetDistance
        );
        float visibility = alive * influence;
        if (visibility > strongestPacket.x) {
          strongestPacket = vec2(
            visibility,
            clamp(normalizedAge, 0.0, 1.0)
          );
        }
      }
    }

    return strongestPacket;
  }

  // Reveal and remove small spatial fragments instead of dimming a complete
  // packet. Surviving filaments remain full strength right up to breakup.
  float foamPacketMask(vec2 lifecycle, float breakupNoise) {
    float spatialAa = max(fwidth(lifecycle.x) * 1.15, 0.012);
    float spatialMask = smoothstep(
      0.035 - spatialAa,
      0.28 + spatialAa,
      lifecycle.x
    );
    // Each fragment has its own start time and takes a substantial fraction
    // of the packet lifetime to become opaque. This reads as froth forming,
    // not a binary mask switching on.
    float birthStart = breakupNoise * 0.24;
    float born = smoothstep(
      birthStart,
      birthStart + 0.22,
      lifecycle.y
    );
    float erosionProgress = smoothstep(0.70, 1.0, lifecycle.y);
    float breakupAa = max(fwidth(breakupNoise) * 1.5, 0.035);
    float surviving = smoothstep(
      erosionProgress - breakupAa,
      erosionProgress + breakupAa,
      breakupNoise
    );
    return spatialMask * born * surviving;
  }

  float projectiveValidity(float clipW) {
    return smoothstep(0.02, 0.20, clipW);
  }
`;
