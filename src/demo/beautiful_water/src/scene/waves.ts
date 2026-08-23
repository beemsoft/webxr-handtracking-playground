import { Vector2 } from 'three';

export interface WaveDefinition {
  direction: Vector2;
  steepness: number;
  wavelength: number;
  speed: number;
  phase: number;
  bendFrequency: number;
  bendStrength: number;
  packetFrequency: number;
  packetStrength: number;
  crestSharpness: number;
  lodStart: number;
  lodEnd: number;
}

export interface DomainWarpDefinition {
  waveVector: Vector2;
  displacement: Vector2;
  speed: number;
  phase: number;
}

export interface DomainVariantDefinition {
  phaseBias: number;
  rotation: number;
}

export interface EnergyWaveDefinition {
  waveVector: Vector2;
  amplitude: number;
  speed: number;
  phase: number;
}

function wave(
  direction: [number, number],
  steepness: number,
  wavelength: number,
  speed: number,
  phase: number,
  bendFrequency: number,
  bendStrength: number,
  packetFrequency: number,
  packetStrength: number,
  crestSharpness: number,
  lodStart: number,
  lodEnd: number,
): WaveDefinition {
  return {
    direction: new Vector2(...direction).normalize(),
    steepness,
    wavelength,
    speed,
    phase,
    bendFrequency,
    bendStrength,
    packetFrequency,
    packetStrength,
    crestSharpness,
    lodStart,
    lodEnd,
  };
}

function domainWarp(
  waveVector: [number, number],
  displacement: [number, number],
  speed: number,
  phase: number,
): DomainWarpDefinition {
  return {
    waveVector: new Vector2(...waveVector),
    displacement: new Vector2(...displacement),
    speed,
    phase,
  };
}

function energyWave(
  waveVector: [number, number],
  amplitude: number,
  speed: number,
  phase: number,
): EnergyWaveDefinition {
  return {
    waveVector: new Vector2(...waveVector),
    amplitude,
    speed,
    phase,
  };
}

export const OCEAN_DOMAIN_WARP: DomainWarpDefinition[] = [
  domainWarp([0.0147, 0.0091], [5.2, -2.1], 0.011, 0.70),
  domainWarp([-0.0109, 0.0183], [-2.8, 4.6], -0.008, 3.10),
  domainWarp([0.0287, -0.0211], [1.9, 2.2], 0.006, 5.40),
];

export const OCEAN_DOMAIN_VARIANTS: DomainVariantDefinition[] = [
  { phaseBias: 0.00, rotation: 0.00 },
];

export const OCEAN_ENERGY_WAVES: EnergyWaveDefinition[] = [
  energyWave([0.0213, -0.0141], 0.22, 0.010, 0.80),
  energyWave([-0.0137, 0.0269], 0.15, -0.008, 2.70),
  energyWave([0.0391, 0.0187], 0.10, 0.006, 5.20),
];

export const OCEAN_WAVES: WaveDefinition[] = [
  wave([1.00, 0.14], 0.044, 25.7, 1.95, 0.30, 0.029, 2.70, 0.018, 0.52, 0.18, 250, 440),
  wave([0.91, -0.42], 0.038, 31.3, 2.08, 4.17, 0.023, 3.10, 0.014, 0.48, 0.16, 260, 450),
  wave([0.72, 0.69], 0.040, 28.1, 2.01, 1.83, 0.027, 2.45, 0.017, 0.46, 0.15, 240, 430),
  wave([0.97, 0.25], 0.040, 22.9, 1.83, 5.22, 0.035, 2.05, 0.022, 0.44, 0.17, 210, 400),
  wave([0.80, -0.60], 0.045, 20.7, 1.75, 2.78, 0.039, 1.85, 0.025, 0.42, 0.16, 190, 380),
  wave([0.42, 0.91], 0.035, 18.9, 1.68, 5.40, 0.043, 1.55, 0.029, 0.38, 0.12, 170, 350),
  wave([0.83, 0.56], 0.052, 16.0, 1.56, 2.10, 0.052, 1.45, 0.034, 0.40, 0.18, 170, 340),
  wave([0.98, -0.18], 0.038, 13.4, 1.43, 3.20, 0.062, 0.80, 0.044, 0.34, 0.10, 120, 260),
  wave([0.91, -0.42], 0.070, 11.8, 1.34, 4.75, 0.071, 0.92, 0.049, 0.36, 0.16, 120, 270),
  wave([0.51, -0.86], 0.036, 9.3, 1.20, 0.70, 0.090, 0.55, 0.064, 0.30, 0.08, 75, 190),
  wave([0.58, 0.82], 0.068, 8.7, 1.16, 1.25, 0.096, 0.62, 0.068, 0.32, 0.15, 70, 190),
  wave([0.69, -0.72], 0.055, 6.4, 0.98, 3.60, 0.132, 0.42, 0.091, 0.30, 0.11, 48, 150),
  wave([0.97, 0.25], 0.043, 4.8, 0.83, 5.55, 0.176, 0.29, 0.122, 0.26, 0.08, 34, 116),
  wave([0.43, -0.90], 0.030, 3.5, 0.69, 0.82, 0.238, 0.20, 0.164, 0.22, 0.05, 25, 86),
];

function sampleOceanDomain(x: number, z: number, time: number, variant: DomainVariantDefinition) {
  let warpedX = x;
  let warpedZ = z;
  let derivativeXX = 1;
  let derivativeXZ = 0;
  let derivativeZX = 0;
  let derivativeZZ = 1;

  const cosineTurn = Math.cos(variant.rotation);
  const sineTurn = Math.sin(variant.rotation);

  for (const [modeIndex, mode] of OCEAN_DOMAIN_WARP.entries()) {
    const displacementX = cosineTurn * mode.displacement.x
      - sineTurn * mode.displacement.y;
    const displacementZ = sineTurn * mode.displacement.x
      + cosineTurn * mode.displacement.y;
    const phaseOffset = mode.phase + variant.phaseBias * (0.73 + modeIndex * 0.58);
    const wavePhase = mode.waveVector.x * x
      + mode.waveVector.y * z
      - time * mode.speed
      + phaseOffset;
    const sine = Math.sin(wavePhase);
    const cosine = Math.cos(wavePhase);
    warpedX += displacementX * sine;
    warpedZ += displacementZ * sine;
    derivativeXX += displacementX * mode.waveVector.x * cosine;
    derivativeXZ += displacementX * mode.waveVector.y * cosine;
    derivativeZX += displacementZ * mode.waveVector.x * cosine;
    derivativeZZ += displacementZ * mode.waveVector.y * cosine;
  }

  let energy = 0.82;
  let energyGradientX = 0;
  let energyGradientZ = 0;

  for (const [modeIndex, mode] of OCEAN_ENERGY_WAVES.entries()) {
    const phaseOffset = mode.phase + variant.phaseBias * (1.11 + modeIndex * 0.47);
    const wavePhase = mode.waveVector.x * x
      + mode.waveVector.y * z
      - time * mode.speed
      + phaseOffset;
    const sine = Math.sin(wavePhase);
    const cosine = Math.cos(wavePhase);
    energy += mode.amplitude * sine;
    energyGradientX += mode.amplitude * mode.waveVector.x * cosine;
    energyGradientZ += mode.amplitude * mode.waveVector.y * cosine;
  }

  return {
    warpedX,
    warpedZ,
    derivativeXX,
    derivativeXZ,
    derivativeZX,
    derivativeZZ,
    energy,
    energyGradientX,
    energyGradientZ,
  };
}

export function sampleOceanSurface(x: number, z: number, time: number) {
  let domainAverageX = 0;
  let domainAverageZ = 0;
  const domainSamples = OCEAN_DOMAIN_VARIANTS.map((variant) => {
    const sample = sampleOceanDomain(x, z, time, variant);
    domainAverageX += sample.warpedX;
    domainAverageZ += sample.warpedZ;
    return sample;
  });

  const domainCount = OCEAN_DOMAIN_VARIANTS.length;
  domainAverageX /= domainCount;
  domainAverageZ /= domainCount;

  let displacedX = domainAverageX;
  let displacedY = 0;
  let displacedZ = domainAverageZ;
  let gradientX = 0;
  let gradientZ = 0;

  for (const [index, waveItem] of OCEAN_WAVES.entries()) {
    const domain = domainSamples[index % domainCount];
    const dirX = waveItem.direction.x;
    const dirY = waveItem.direction.y;
    const perpX = -dirY;
    const perpZ = dirX;

    const along = dirX * domain.warpedX + dirY * domain.warpedZ;
    const across = perpX * domain.warpedX + perpZ * domain.warpedZ;

    const alongGradientX = dirX * domain.derivativeXX + dirY * domain.derivativeZX;
    const alongGradientZ = dirX * domain.derivativeXZ + dirY * domain.derivativeZZ;

    const acrossGradientX = perpX * domain.derivativeXX + perpZ * domain.derivativeZX;
    const acrossGradientZ = perpX * domain.derivativeXZ + perpZ * domain.derivativeZZ;

    const bendPhase = across * waveItem.bendFrequency + waveItem.phase * 1.71 - time * 0.055;
    const secondaryBendPhase = across * waveItem.bendFrequency * 2.13
      - waveItem.phase * 0.73 + time * 0.035;
    const bend = (
      Math.sin(bendPhase) + Math.sin(secondaryBendPhase) * 0.27
    ) * waveItem.bendStrength;

    const packetPhase = (along * 0.34 + across) * waveItem.packetFrequency
      + waveItem.phase * 2.07;
    const secondaryPacketPhase = (along * -0.18 + across * 1.83)
      * waveItem.packetFrequency - waveItem.phase * 1.31;
    const packetEnvelope = 1.0 + waveItem.packetStrength * (
      Math.sin(packetPhase) * 0.68 + Math.sin(secondaryPacketPhase) * 0.32
    );
    const envelope = packetEnvelope * domain.energy;

    const waveNumber = (Math.PI * 2) / waveItem.wavelength;
    const amplitude = waveItem.steepness / waveNumber;
    const phase = waveNumber * (along + bend - waveItem.speed * time) + waveItem.phase;
    const sine = Math.sin(phase);
    const cosine = Math.cos(phase);
    const shapedHeight = sine - waveItem.crestSharpness * Math.cos(phase * 2.0);
    const shapedDerivative = cosine + waveItem.crestSharpness * 2.0 * Math.sin(phase * 2.0);

    const bendDerivative = (
      Math.cos(bendPhase) * waveItem.bendFrequency
      + Math.cos(secondaryBendPhase) * waveItem.bendFrequency * 2.13 * 0.27
    ) * waveItem.bendStrength;

    const phaseGradientX = waveNumber * (
      alongGradientX + acrossGradientX * bendDerivative
    );
    const phaseGradientZ = waveNumber * (
      alongGradientZ + acrossGradientZ * bendDerivative
    );

    const packetGradientCross1 = Math.cos(packetPhase) * 0.68 * waveItem.packetFrequency;
    const packetGradientCross2 = Math.cos(secondaryPacketPhase) * 0.32 * waveItem.packetFrequency;

    const packetGradientX = waveItem.packetStrength * (
      packetGradientCross1 * (alongGradientX * 0.34 + acrossGradientX)
      + packetGradientCross2 * (alongGradientX * -0.18 + acrossGradientX * 1.83)
    );
    const packetGradientZ = waveItem.packetStrength * (
      packetGradientCross1 * (alongGradientZ * 0.34 + acrossGradientZ)
      + packetGradientCross2 * (alongGradientZ * -0.18 + acrossGradientX * 1.83)
    );

    const envelopeGradientX = packetGradientX * domain.energy
      + packetEnvelope * domain.energyGradientX;
    const envelopeGradientZ = packetGradientZ * domain.energy
      + packetEnvelope * domain.energyGradientZ;

    displacedX += dirX * (amplitude * envelope * cosine);
    displacedZ += dirY * (amplitude * envelope * cosine);
    displacedY += amplitude * envelope * shapedHeight;

    gradientX += amplitude * (
      envelopeGradientX * shapedHeight
      + envelope * shapedDerivative * phaseGradientX
    );
    gradientZ += amplitude * (
      envelopeGradientZ * shapedHeight
      + envelope * shapedDerivative * phaseGradientZ
    );
  }

  const length = Math.hypot(-gradientX, 1.0, -gradientZ) || 1.0;
  return {
    height: displacedY,
    position: {
      x: displacedX,
      y: displacedY,
      z: displacedZ,
    },
    normal: {
      x: -gradientX / length,
      y: 1.0 / length,
      z: -gradientZ / length,
    },
  };
}
