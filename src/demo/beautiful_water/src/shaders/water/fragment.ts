import { OCEAN_WAVES } from '../../scene/waves';
import { NOISE_TEXTURE_SIZE } from '../../scene/noise-texture';
import { waterFragmentFunctions } from './functions';

const dominantWave = OCEAN_WAVES[0];

export const waterFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uDeepColor;
  uniform vec3 uShallowColor;
  uniform vec3 uHorizonColor;
  uniform float uWaterDepth;
  uniform float uUnderwater;
  uniform sampler2D tReflectionMap;
  uniform sampler2D tRefractionMap;
  uniform sampler2D tNoiseMap;

  varying vec3 vWorldPosition;
  varying vec3 vMacroNormal;
  varying vec2 vSurfacePosition;
  varying float vWaveHeight;
  varying float vWaveSlope;
  varying vec4 vReflectionCoord;
  varying vec4 vRefractionCoord;

  const float WATER_PI = 3.141592653589793;
  const vec2 FOAM_WIND_DIRECTION = vec2(
    ${dominantWave.direction.x.toFixed(8)},
    ${dominantWave.direction.y.toFixed(8)}
  );
  const float FOAM_ADVECTION_SPEED = ${dominantWave.speed.toFixed(6)};
  const float NOISE_TEXTURE_SIZE = ${NOISE_TEXTURE_SIZE.toFixed(1)};

${waterFragmentFunctions}

void main() {
    float distanceToCamera = length(cameraPosition - vWorldPosition);
    vec2 macroGradient = -vMacroNormal.xz / max(vMacroNormal.y, 0.24);
    vec2 detailGradient = microGradient(vSurfacePosition, distanceToCamera);
    vec2 combinedGradient = macroGradient + detailGradient;
    vec3 surfaceUp = normalize(vec3(-combinedGradient.x, 1.0, -combinedGradient.y));
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    // Never interpolate or switch between antipodal interface normals. The
    // previous medium-dependent flip caused a full-frame discontinuity while
    // crossing the surface (and its WebGPU equivalent normalized a zero
    // vector at exactly 50%). Evaluate each side with its physical normal and
    // blend only the resulting colors.
    vec3 undersideNormal = -surfaceUp;
    float viewFacing = clamp(abs(dot(surfaceUp, viewDirection)), 0.0, 1.0);
    float fresnel = 0.025 + 0.975 * pow(1.0 - viewFacing, 5.0);
    vec3 reflectionDirection = reflect(-viewDirection, surfaceUp);
    reflectionDirection.y = max(reflectionDirection.y, 0.015);
    float reflectionAzimuth = dot(
      normalize(reflectionDirection.xz + vec2(0.0001)),
      normalize(uSunDirection.xz)
    ) * 0.5 + 0.5;
    float sunwardReflection = smoothstep(0.15, 0.85, reflectionAzimuth);

    float waterColumn = uWaterDepth / max(viewFacing, 0.28);
    float opticalDepth = 1.0 - exp(-waterColumn * 0.052);
    opticalDepth = clamp(
      opticalDepth + smoothstep(100.0, 210.0, distanceToCamera) * 0.12,
      0.0,
      1.0
    );
    float depthVariation = fbm(
      vSurfacePosition * 0.075 + vec2(uTime * 0.012, -uTime * 0.008)
    );
    float secondaryVariation = fbm(vSurfacePosition * 0.17 + vec2(-11.0, 7.0));
    float clearPatch = smoothstep(0.32, 0.72,
      depthVariation * 0.72 + secondaryVariation * 0.28);
    float nearField = 1.0 - smoothstep(18.0, 115.0, distanceToCamera);
    float shallowMix = clamp(
      (1.0 - opticalDepth) * 0.42 + clearPatch * nearField * 0.20,
      0.0,
      0.76
    );
    vec3 waterBody = mix(uDeepColor, uShallowColor, shallowMix);
    waterBody *= mix(0.93, 1.03, secondaryVariation);
    float cloudShadow = cloudShadowMask(vSurfacePosition);
    waterBody *= mix(1.0, 0.72, cloudShadow * (0.42 + nearField * 0.30));

    float facingLight = max(dot(surfaceUp, uSunDirection), 0.0);
    waterBody += vec3(0.00, 0.065, 0.075) * pow(facingLight, 2.0) * nearField;

    vec3 reflectedSky = skyReflection(normalize(reflectionDirection));
    float detailSlope = length(detailGradient);
    float facetReflection = smoothstep(0.035, 0.16, detailSlope);
    float reflectionMix = clamp(
      0.085 + fresnel * 0.89 + facetReflection * nearField * 0.045,
      0.0,
      0.97
    );
    vec2 reflectionUv = vReflectionCoord.xy / max(vReflectionCoord.w, 0.001);
    vec2 refractionUv = vRefractionCoord.xy / max(vRefractionCoord.w, 0.001);
    float distortionStrength = mix(0.0025, 0.0080, viewFacing);
    vec2 reflectionSampleUv = reflectionUv + combinedGradient * distortionStrength;
    vec2 refractionSampleUv = refractionUv - combinedGradient * distortionStrength * 0.72;
    float reflectionCaptureFade = projectiveValidity(vReflectionCoord.w);
    float refractionCaptureFade = projectiveValidity(vRefractionCoord.w);
    vec3 reflectedCapture = texture2D(
      tReflectionMap,
      clamp(reflectionSampleUv, vec2(0.003), vec2(0.997))
    ).rgb;
    vec3 refractedCapture = texture2D(
      tRefractionMap,
      clamp(refractionSampleUv, vec2(0.003), vec2(0.997))
    ).rgb;
    vec3 reflectedScene = mix(reflectedSky, reflectedCapture, reflectionCaptureFade);
    vec3 refractedScene = mix(waterBody, refractedCapture, refractionCaptureFade);
    vec3 transmissionTint = mix(
      vec3(0.58, 0.88, 0.82),
      vec3(0.20, 0.45, 0.52),
      opticalDepth
    );
    float columnTransmittance = exp(-waterColumn * 0.045);
    float transmissionAmount = mix(0.40, 0.52, clearPatch) * columnTransmittance;
    transmissionAmount *= 0.50 + nearField * 0.50;
    vec3 sceneTransmission = mix(
      waterBody,
      refractedScene * transmissionTint,
      clamp(transmissionAmount, 0.0, 0.66)
    );
    // The capture preserves nearby object reflections; the procedural sky
    // path responds to the full fragment normal and therefore breaks cloud
    // silhouettes into the smaller facets seen on a choppy surface.
    vec3 sceneReflection = mix(reflectedSky, reflectedScene, 0.48);
    vec3 directionalReflectionTint = mix(
      vec3(0.30, 0.50, 0.68),
      vec3(0.62, 0.76, 0.84),
      sunwardReflection
    );
    sceneReflection *= directionalReflectionTint * mix(0.74, 1.0, secondaryVariation);
    sceneReflection = mix(sceneReflection, uDeepColor, 0.08);
    vec3 surfaceColor = mix(sceneTransmission, sceneReflection, reflectionMix);
    surfaceColor *= mix(1.0, 0.84, cloudShadow * (1.0 - fresnel) * 0.72);
    float localFacetLight = smoothstep(
      -0.06,
      0.32,
      dot(surfaceUp, uSunDirection)
    );
    surfaceColor *= mix(0.92, 1.055, localFacetLight * nearField);

    float distanceHue = smoothstep(24.0, 138.0, distanceToCamera);
    vec3 nearWaterGrade = surfaceColor * vec3(0.74, 1.10, 1.06);
    nearWaterGrade += vec3(0.0, 0.032, 0.036) * nearField * clearPatch;
    vec3 farWaterGrade = surfaceColor * vec3(0.68, 0.84, 1.12);
    surfaceColor = mix(nearWaterGrade, farWaterGrade, distanceHue);

    // Thin, wind-sculpted crests transmit cyan light before they fully break.
    // The back-light term makes the effect strongest while looking toward the
    // sun, while a smaller grazing component keeps off-axis crests readable.
    float crestTransmission = smoothstep(
      0.12,
      0.72,
      vWaveHeight + min(vWaveSlope, 0.42) * 0.24
    );
    float backLighting = pow(max(dot(-viewDirection, uSunDirection), 0.0), 2.4);
    float crestRim = pow(1.0 - viewFacing, 1.35);
    surfaceColor += vec3(0.008, 0.20, 0.19)
      * crestTransmission * crestRim * (0.24 + backLighting * 0.76);

    vec3 halfVector = normalize(viewDirection + uSunDirection);
    float normalDotView = max(dot(surfaceUp, viewDirection), 0.001);
    float normalDotLight = max(dot(surfaceUp, uSunDirection), 0.001);
    float normalDotHalf = max(dot(surfaceUp, halfVector), 0.0);
    float viewDotHalf = max(dot(viewDirection, halfVector), 0.0);
    vec3 normalDx = dFdx(surfaceUp);
    vec3 normalDy = dFdy(surfaceUp);
    float normalVariance = max(dot(normalDx, normalDx), dot(normalDy, normalDy));
    float baseRoughness = mix(
      0.040,
      0.105,
      smoothstep(22.0, 155.0, distanceToCamera)
    );
    // Screen-space variance widens only sub-pixel highlights. This preserves
    // small glints nearby without letting distant normals shimmer or pixelate.
    float microfacetAlpha = clamp(
      baseRoughness * baseRoughness + min(normalVariance * 0.32, 0.055),
      0.0012,
      0.052
    );
    float distribution = distributionGGX(microfacetAlpha, normalDotHalf);
    float visibility = visibilitySmithGGXCorrelated(
      microfacetAlpha,
      normalDotView,
      normalDotLight
    );
    float sunFresnel = fresnelSchlick(viewDotHalf);
    float sunSpecular = distribution * visibility * sunFresnel * normalDotLight;
    sunSpecular = sunSpecular / (1.0 + sunSpecular);
    sunSpecular = pow(sunSpecular, 1.22);

    // A wind-roughened ocean reflects the sun from a distribution of small
    // facet slopes rather than as one continuous mirror column. A wider GGX
    // lobe locates the glitter field; advected multi-scale occupancy breaks
    // it into resolved flashes without screen-space pixel noise.
    float broadAlpha = clamp(
      microfacetAlpha * 2.7 + 0.010,
      0.014,
      0.088
    );
    float broadDistribution = distributionGGX(broadAlpha, normalDotHalf);
    float broadVisibility = visibilitySmithGGXCorrelated(
      broadAlpha,
      normalDotView,
      normalDotLight
    );
    float broadSpecular = broadDistribution * broadVisibility
      * sunFresnel * normalDotLight;
    broadSpecular = broadSpecular / (1.0 + broadSpecular);

    vec2 glitterWind = normalize(FOAM_WIND_DIRECTION);
    vec2 glitterCross = vec2(-glitterWind.y, glitterWind.x);
    vec2 glitterPosition = vSurfacePosition
      - glitterWind * (uTime * 0.31)
      + glitterCross * (uTime * 0.047)
      + combinedGradient * 0.16;
    vec2 glitterUv = vec2(
      dot(glitterPosition, glitterWind) * 0.72,
      dot(glitterPosition, glitterCross) * 1.58
    );
    mat2 glitterTurn = mat2(0.61, -0.79, 0.79, 0.61);
    float glitterNoise = valueNoise(glitterUv * 2.5 + vec2(7.3, -4.8)) * 0.26;
    glitterNoise += valueNoise(
      glitterTurn * glitterUv * 8.8 + vec2(-13.2, 19.6)
    ) * 0.47;
    glitterNoise += valueNoise(
      glitterTurn * glitterUv * 21.5 + vec2(31.7, -9.1)
    ) * 0.27;
    float glitterAa = max(fwidth(glitterNoise) * 1.45, 0.022);
    float glitterOccupancy = smoothstep(
      0.50 - glitterAa,
      0.69 + glitterAa,
      glitterNoise
    );
    float glitterSparkles = smoothstep(
      0.67 - glitterAa,
      0.83 + glitterAa,
      glitterNoise
    );
    float resolvedGlitter = 1.0 - smoothstep(62.0, 175.0, distanceToCamera);
    glitterOccupancy = mix(0.18, glitterOccupancy, resolvedGlitter);
    float glitterEnergy = sunSpecular * mix(0.04, 0.92, glitterOccupancy);
    glitterEnergy += broadSpecular
      * (glitterOccupancy * 0.28 + glitterSparkles * 0.72) * 0.92;
    surfaceColor += vec3(1.0, 0.84, 0.61) * glitterEnergy * 2.85;

    // Foam is locked to the displaced crest field, then eroded into narrow
    // porous ribbons. It cannot float independently of a wave, while the two
    // noise scales prevent broad solid-white patches.
    vec2 windDirection = normalize(FOAM_WIND_DIRECTION);
    vec2 crestDirection = vec2(-windDirection.y, windDirection.x);
    // Keep every foam octave in one advected coordinate frame. Independent
    // time offsets make the mask morph in place while a crest passes through,
    // which reads as a scan-line reveal instead of surface transport.
    vec2 advectedFoamPosition = vSurfacePosition
      - windDirection * (uTime * FOAM_ADVECTION_SPEED)
      - crestDirection * (uTime * 0.026);
    float foamAlong = dot(advectedFoamPosition, windDirection);
    float foamAcross = dot(advectedFoamPosition, crestDirection);
    // Breaking happens in broad wind patches, not on every eligible crest.
    // These cells are deliberately much longer across a wave front than in
    // its travel direction, so the active regions read as interrupted swell
    // systems rather than a repeating checkerboard of identical white rows.
    float breakingZoneA = sin(
      foamAlong * 0.024 + foamAcross * 0.010 + 4.3
    );
    float breakingZoneB = sin(
      foamAlong * 0.047 - foamAcross * 0.017 - 11.6
    );
    float breakingZoneC = sin(
      foamAlong * 0.013 + foamAcross * 0.029 + 17.2
    );
    float breakingZoneField = 0.50 + breakingZoneA * 0.24
      + breakingZoneA * breakingZoneB * 0.15 + breakingZoneC * 0.11;
    float breakingZone = smoothstep(0.36, 0.64, breakingZoneField);
    float foamWarp = fbm(
      advectedFoamPosition * 0.105 + vec2(4.7, -2.9)
    ) - 0.5;
    vec2 foamCoordinates = advectedFoamPosition
      + foamCurlDisplacement(advectedFoamPosition)
      + vec2(foamWarp * 1.15, foamWarp * -0.72)
      + macroGradient * 0.72;
    vec2 foamUv = vec2(
      dot(foamCoordinates, windDirection) * 1.55,
      dot(foamCoordinates, crestDirection) * 0.72
    );
    mat2 foamTurn = mat2(0.73, -0.68, 0.68, 0.73);
    float foamContour = fbm(foamUv * 2.15 + vec2(3.4, -6.2));
    float contourDistance = abs(foamContour - 0.565);
    float contourAntialias = max(fwidth(foamContour) * 1.35, 0.006);
    float filaments = 1.0 - smoothstep(
      0.018 + contourAntialias,
      0.064 + contourAntialias,
      contourDistance
    );
    float tornMask = smoothstep(0.37, 0.62,
      fbm(foamTurn * foamUv * 4.15 + vec2(-7.6, 2.8)));
    float foamMicro = valueNoise(
      foamTurn * foamUv * 13.8 + vec2(19.4, -11.7)
    );
    vec2 lifecycleA = foamLifecycle(foamUv);
    vec2 turnoverUv = foamTurn * foamUv + vec2(31.7, -18.2);
    vec2 lifecycleB = foamLifecycle(turnoverUv);
    float breakupNoiseA = mix(
      valueNoise(foamUv * 5.6 + vec2(-9.4, 17.3)),
      valueNoise(foamTurn * foamUv * 13.1 + vec2(23.8, -4.7)),
      0.32
    );
    float breakupNoiseB = mix(
      valueNoise(turnoverUv * 6.2 + vec2(14.6, 8.1)),
      valueNoise(foamTurn * turnoverUv * 14.7 + vec2(-6.3, 28.5)),
      0.30
    );
    float lifecycleMask = max(
      foamPacketMask(lifecycleA, breakupNoiseA),
      foamPacketMask(lifecycleB, breakupNoiseB)
    );
    float edgeBreakup = smoothstep(0.32, 0.58, foamMicro);
    float flecks = smoothstep(0.78, 0.91, foamMicro) * 0.18;
    float porousRibbon = max(
      filaments * tornMask * edgeBreakup,
      flecks * tornMask
    );
    vec2 streakUv = vec2(foamUv.x * 0.44, foamUv.y * 1.72);
    float streakContour = fbm(streakUv * 1.32 + vec2(-5.1, 9.3));
    float streakDistance = abs(streakContour - 0.555);
    float streakAa = max(fwidth(streakContour) * 1.4, 0.005);
    float longFilaments = 1.0 - smoothstep(
      0.020 + streakAa,
      0.067 + streakAa,
      streakDistance
    );
    float streakBreakup = smoothstep(0.35, 0.61,
      fbm(foamTurn * streakUv * 3.7 + vec2(11.2, -3.6)));
    float streakContinuity = smoothstep(0.30, 0.61, fbm(
      vec2(streakUv.x * 0.24, streakUv.y * 0.43) + vec2(-2.8, 7.6)
    ));
    float curvedStreaks = longFilaments * streakBreakup
      * mix(0.16, 1.0, streakContinuity);

    // A weaker crossing family follows the same flow but prevents every
    // remnant from sharing one heading. Its broad blend avoids a second grid.
    mat2 crossTurn = mat2(0.94, -0.34, 0.34, 0.94);
    vec2 crossingUv = crossTurn * streakUv;
    float crossingContour = fbm(
      vec2(crossingUv.x * 0.42, crossingUv.y * 1.35) + vec2(6.7, -10.4)
    );
    float crossingAa = max(fwidth(crossingContour) * 1.35, 0.005);
    float crossingFilaments = 1.0 - smoothstep(
      0.021 + crossingAa,
      0.070 + crossingAa,
      abs(crossingContour - 0.56)
    );
    float crossingBreakup = smoothstep(0.38, 0.64, fbm(
      crossingUv * 3.1 + vec2(-13.2, 4.8)
    ));
    porousRibbon = max(
      porousRibbon,
      curvedStreaks * 0.58 + crossingFilaments * crossingBreakup * 0.22
    );

    float foamThreshold = mix(0.075, 0.170,
      valueNoise(advectedFoamPosition * 0.21 + vec2(8.7, -4.1)));
    float crestSignal = vWaveHeight + min(vWaveSlope, 0.34) * 0.18;
    float breakingEnergy = smoothstep(
      foamThreshold - 0.15,
      foamThreshold + 0.21,
      crestSignal
    );
    float formationVariation = mix(0.74, 1.08,
      fbm(advectedFoamPosition * 0.84 + vec2(-3.8, 12.1)));
    float breakingZoneGain = mix(0.22, 1.35, breakingZone);
    float crestFoam = breakingEnergy * mix(breakingEnergy, 1.0, 0.22)
      * formationVariation * breakingZoneGain;
    float breakingFace = mix(0.58, 1.0, smoothstep(0.075, 0.24, vWaveSlope));
    float foam = crestFoam * (porousRibbon + flecks * 0.18) * breakingFace;
    foam *= lifecycleMask;
    foam *= 1.0 - smoothstep(105.0, 220.0, distanceToCamera) * 0.36;
    float foamBlend = foam * mix(0.34, 0.60, viewFacing);
    surfaceColor = mix(surfaceColor, vec3(0.76, 0.87, 0.85), foamBlend);

    float horizonFade = smoothstep(105.0, 205.0, distanceToCamera);
    float horizonAbsorption = mix(0.78, 0.52, sunwardReflection);
    surfaceColor = mix(surfaceColor, uHorizonColor, horizonFade * horizonAbsorption);

    vec3 transmissionDirection = refract(-viewDirection, undersideNormal, 1.333);
    float transmissionAvailable = smoothstep(0.001, 0.08, length(transmissionDirection));
    vec3 transmissionSky = skyReflection(normalize(transmissionDirection + vec3(0.0, 0.0001, 0.0)));
    float ceilingTexture = smoothstep(0.42, 0.83,
      fbm(vSurfacePosition * 0.46 + vec2(uTime * 0.045, -uTime * 0.032)));
    vec3 underDeep = vec3(0.008, 0.12, 0.15);
    vec3 underLit = vec3(0.035, 0.26, 0.30);
    float sunScatter = max(dot(-viewDirection, uSunDirection), 0.0);
    vec3 underwaterColor = mix(underDeep, underLit, 0.22 + viewFacing * 0.72);
    underwaterColor += vec3(0.05, 0.22, 0.24) * ceilingTexture * viewFacing;
    underwaterColor += vec3(0.03, 0.14, 0.15) * pow(sunScatter, 3.0);
    underwaterColor = mix(
      underwaterColor,
      transmissionSky * vec3(0.55, 0.88, 0.85),
      transmissionAvailable * viewFacing * 0.55
    );
    float underwaterFog = 1.0 - exp(-distanceToCamera * 0.075);
    vec3 hazeScatter = mix(underDeep, underLit, pow(sunScatter, 3.0) * 0.42);
    underwaterColor = mix(underwaterColor, hazeScatter, underwaterFog);

    vec3 color = mix(surfaceColor, underwaterColor, uUnderwater);
    float grain = hash21(gl_FragCoord.xy + uTime * 17.0) - 0.5;
    color += grain / 420.0;

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
