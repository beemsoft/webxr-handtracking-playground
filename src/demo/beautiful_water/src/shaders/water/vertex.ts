import {
  OCEAN_DOMAIN_WARP,
  OCEAN_DOMAIN_VARIANTS,
  OCEAN_ENERGY_WAVES,
  OCEAN_WAVES,
} from '../../scene/waves';

const domainWarpCalls = OCEAN_DOMAIN_WARP.map((mode, index) => /* glsl */ `
    addDomainWarp(
      basePosition,
      vec2(${mode.waveVector.x.toFixed(8)}, ${mode.waveVector.y.toFixed(8)}),
      domainTurn * vec2(
        ${mode.displacement.x.toFixed(8)},
        ${mode.displacement.y.toFixed(8)}
      ),
      ${mode.speed.toFixed(6)},
      ${mode.phase.toFixed(6)} + phaseBias * ${(0.73 + index * 0.58).toFixed(6)},
      warpedPosition,
      derivativeX,
      derivativeZ
    );
`).join('');

const energyWaveCalls = OCEAN_ENERGY_WAVES.map((mode, index) => /* glsl */ `
    addEnergyWave(
      basePosition,
      vec2(${mode.waveVector.x.toFixed(8)}, ${mode.waveVector.y.toFixed(8)}),
      ${mode.amplitude.toFixed(6)},
      ${mode.speed.toFixed(6)},
      ${mode.phase.toFixed(6)} + phaseBias * ${(1.11 + index * 0.47).toFixed(6)},
      energy,
      energyGradient
    );
`).join('');

const domainDeclarations = OCEAN_DOMAIN_VARIANTS.map((variant, index) => {
  const cosine = Math.cos(variant.rotation);
  const sine = Math.sin(variant.rotation);
  return /* glsl */ `
    vec2 wavePosition${index};
    vec2 domainDerivativeX${index};
    vec2 domainDerivativeZ${index};
    float domainEnergy${index};
    vec2 domainEnergyGradient${index};
    sampleOceanDomain(
      basePosition,
      ${variant.phaseBias.toFixed(6)},
      mat2(
        ${cosine.toFixed(8)}, ${sine.toFixed(8)},
        ${(-sine).toFixed(8)}, ${cosine.toFixed(8)}
      ),
      wavePosition${index},
      domainDerivativeX${index},
      domainDerivativeZ${index},
      domainEnergy${index},
      domainEnergyGradient${index}
    );
`;
}).join('');

const domainAverageExpression = OCEAN_DOMAIN_VARIANTS
  .map((_, index) => `wavePosition${index}`)
  .join(' + ');

const waveCalls = OCEAN_WAVES.map((wave, index) => {
  const domainIndex = index % OCEAN_DOMAIN_VARIANTS.length;
  return /* glsl */ `
    addWave(
      wavePosition${domainIndex},
      domainDerivativeX${domainIndex},
      domainDerivativeZ${domainIndex},
      domainEnergy${domainIndex},
      domainEnergyGradient${domainIndex},
      vec2(${wave.direction.x.toFixed(8)}, ${wave.direction.y.toFixed(8)}),
      ${wave.steepness.toFixed(6)},
      ${wave.wavelength.toFixed(6)},
      ${wave.speed.toFixed(6)},
      ${wave.phase.toFixed(6)},
      ${wave.bendFrequency.toFixed(6)},
      ${wave.bendStrength.toFixed(6)},
      ${wave.packetFrequency.toFixed(6)},
      ${wave.packetStrength.toFixed(6)},
      ${wave.crestSharpness.toFixed(6)},
      ${wave.lodStart.toFixed(6)},
      ${wave.lodEnd.toFixed(6)},
      cameraDistance,
      displaced,
      gradient
    );
`;
}).join('');

export const waterVertexShader = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform mat4 uReflectionTextureMatrix;
  uniform mat4 uRefractionTextureMatrix;

  varying vec3 vWorldPosition;
  varying vec3 vMacroNormal;
  varying vec2 vSurfacePosition;
  varying float vWaveHeight;
  varying float vWaveSlope;
  varying vec4 vReflectionCoord;
  varying vec4 vRefractionCoord;

  const float PI = 3.141592653589793;

  void addDomainWarp(
    vec2 basePosition,
    vec2 waveVector,
    vec2 displacement,
    float speed,
    float phaseOffset,
    inout vec2 warpedPosition,
    inout vec2 derivativeX,
    inout vec2 derivativeZ
  ) {
    float phase = dot(basePosition, waveVector) - uTime * speed + phaseOffset;
    float sine = sin(phase);
    vec2 derivative = displacement * cos(phase);
    warpedPosition += displacement * sine;
    derivativeX += derivative * waveVector.x;
    derivativeZ += derivative * waveVector.y;
  }

  void addEnergyWave(
    vec2 basePosition,
    vec2 waveVector,
    float amplitude,
    float speed,
    float phaseOffset,
    inout float energy,
    inout vec2 energyGradient
  ) {
    float phase = dot(basePosition, waveVector) - uTime * speed + phaseOffset;
    energy += amplitude * sin(phase);
    energyGradient += amplitude * cos(phase) * waveVector;
  }

  void sampleOceanDomain(
    vec2 basePosition,
    float phaseBias,
    mat2 domainTurn,
    out vec2 warpedPosition,
    out vec2 derivativeX,
    out vec2 derivativeZ,
    out float energy,
    out vec2 energyGradient
  ) {
    warpedPosition = basePosition;
    derivativeX = vec2(1.0, 0.0);
    derivativeZ = vec2(0.0, 1.0);
    energy = 0.82;
    energyGradient = vec2(0.0);

${domainWarpCalls}
${energyWaveCalls}
  }

  void addWave(
    vec2 wavePosition,
    vec2 domainDerivativeX,
    vec2 domainDerivativeZ,
    float domainEnergy,
    vec2 domainEnergyGradient,
    vec2 direction,
    float steepness,
    float wavelength,
    float speed,
    float phaseOffset,
    float bendFrequency,
    float bendStrength,
    float packetFrequency,
    float packetStrength,
    float crestSharpness,
    float lodStart,
    float lodEnd,
    float cameraDistance,
    inout vec3 displaced,
    inout vec2 gradient
  ) {
    direction = normalize(direction);
    vec2 perpendicular = vec2(-direction.y, direction.x);
    float along = dot(direction, wavePosition);
    float across = dot(perpendicular, wavePosition);
    vec2 alongGradient = vec2(
      dot(direction, domainDerivativeX),
      dot(direction, domainDerivativeZ)
    );
    vec2 acrossGradient = vec2(
      dot(perpendicular, domainDerivativeX),
      dot(perpendicular, domainDerivativeZ)
    );

    float bendPhase = across * bendFrequency + phaseOffset * 1.71 - uTime * 0.055;
    float secondaryBendPhase = across * bendFrequency * 2.13
      - phaseOffset * 0.73 + uTime * 0.035;
    float bend = (
      sin(bendPhase) + sin(secondaryBendPhase) * 0.27
    ) * bendStrength;

    float packetPhase = (along * 0.34 + across) * packetFrequency
      + phaseOffset * 2.07;
    float secondaryPacketPhase = (along * -0.18 + across * 1.83)
      * packetFrequency - phaseOffset * 1.31;
    float packetEnvelope = 1.0 + packetStrength * (
      sin(packetPhase) * 0.68 + sin(secondaryPacketPhase) * 0.32
    );
    float envelope = packetEnvelope * domainEnergy;

    float waveNumber = 2.0 * PI / wavelength;
    float lod = 1.0 - smoothstep(lodStart, lodEnd, cameraDistance);
    float amplitude = steepness / waveNumber * lod;
    float phase = waveNumber * (along + bend - speed * uTime) + phaseOffset;
    float sine = sin(phase);
    float cosine = cos(phase);
    float shapedHeight = sine - crestSharpness * cos(phase * 2.0);
    float shapedDerivative = cosine + crestSharpness * 2.0 * sin(phase * 2.0);

    float bendDerivative = (
      cos(bendPhase) * bendFrequency
      + cos(secondaryBendPhase) * bendFrequency * 2.13 * 0.27
    ) * bendStrength;
    vec2 phaseGradient = waveNumber * (
      alongGradient + acrossGradient * bendDerivative
    );
    vec2 packetGradient = packetStrength * (
      cos(packetPhase) * 0.68 * packetFrequency
        * (alongGradient * 0.34 + acrossGradient)
      + cos(secondaryPacketPhase) * 0.32 * packetFrequency
        * (alongGradient * -0.18 + acrossGradient * 1.83)
    );
    vec2 envelopeGradient = packetGradient * domainEnergy
      + packetEnvelope * domainEnergyGradient;

    displaced.xz += direction * (amplitude * envelope * cosine);
    displaced.y += amplitude * envelope * shapedHeight;
    gradient += amplitude * (
      envelopeGradient * shapedHeight
      + envelope * shapedDerivative * phaseGradient
    );
  }

  void main() {
    vec3 displaced = position;
    vec2 basePosition = position.xz;
    vec2 gradient = vec2(0.0);
    vec3 meanWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    float cameraDistance = length(cameraPosition - meanWorldPosition);

${domainDeclarations}

${waveCalls}

    vec3 localNormal = normalize(vec3(-gradient.x, 1.0, -gradient.y));
    vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
    vec4 opticalPlanePosition = modelMatrix * vec4(position, 1.0);

    vWorldPosition = worldPosition.xyz;
    vMacroNormal = normalize(normalMatrix * localNormal);
    vSurfacePosition = (${domainAverageExpression})
      / ${OCEAN_DOMAIN_VARIANTS.length.toFixed(1)};
    vWaveHeight = displaced.y;
    vWaveSlope = length(gradient);
    // The render captures are clipped against the mean water plane. Project
    // that same plane into each capture; projecting displaced crests makes the
    // homogeneous coordinate cross zero at grazing angles and exposes whole
    // triangles of invalid texture data.
    vReflectionCoord = uReflectionTextureMatrix * opticalPlanePosition;
    vRefractionCoord = uRefractionTextureMatrix * opticalPlanePosition;

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;
