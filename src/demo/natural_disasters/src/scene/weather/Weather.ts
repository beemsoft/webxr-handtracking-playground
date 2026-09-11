import * as THREE from 'three';
import { U } from '../core/SharedUniforms';

const lerp = THREE.MathUtils.lerp;
const damp = (a: number, b: number, l: number, dt: number) => a + (b - a) * (1 - Math.exp(-l * dt));

export const BEAUFORT: [number, string][] = [
  [0.3, 'CALM'], [1.5, 'LIGHT AIR'], [3.3, 'LIGHT BREEZE'], [5.5, 'GENTLE BREEZE'],
  [7.9, 'MODERATE BREEZE'], [10.7, 'FRESH BREEZE'], [13.8, 'STRONG BREEZE'],
  [17.1, 'NEAR GALE'], [20.7, 'GALE'], [24.4, 'STRONG GALE'], [28.4, 'STORM'],
  [32.6, 'VIOLENT STORM'], [1e9, 'HURRICANE'],
];

export function beaufort(ws: number): [number, string] {
  for (let i = 0; i < BEAUFORT.length; i++) if (ws < BEAUFORT[i][0]) return [i, BEAUFORT[i][1]];
  return [12, 'HURRICANE'];
}

export interface WeatherState {
  windSpeed: number;
  windAngle: number;
  gustiness: number;
  swellHs: number;
  swellAngle: number;
  swellPeriod: number;
  spread: number;
  amplitude: number;
  choppiness: number;
  rain: number;
  turbidity: number;
  mieG: number;
  sunElevation: number;
  sunAzimuth: number;
  cloudCoverage: number;
  cloudDensity: number;
  cloudBottom: number;
  cloudTop: number;
  cloudAnvil: number;
  storm: number;
  fog: number;
  spray: number;
  lightningRate: number;
  seaLevel: number;
  waterScatter: THREE.Vector3;
  waterAbsorb: THREE.Vector3;
  foamStrength: number;
  sunIntensity: number;
  starIntensity: number;
  timeScale: number;
  [key: string]: any;
}

export class Weather {
  app: any;
  state: WeatherState;
  target: WeatherState;
  rates: Record<string, number>;
  private _sunDirTmp: THREE.Vector3;
  beaufort: [number, string];
  whitecap: number;

  constructor(app: any) {
    this.app = app;

    this.state = {
      windSpeed: 7.0,
      windAngle: 0.6,
      gustiness: 0.25,
      swellHs: 1.4,
      swellAngle: 1.1,
      swellPeriod: 11.0,
      spread: 0.7,
      amplitude: 1.0,
      choppiness: 1.3,
      rain: 0.0,
      turbidity: 1.0,
      mieG: 0.78,
      sunElevation: 0.22,
      sunAzimuth: 2.1,
      cloudCoverage: 0.42,
      cloudDensity: 0.55,
      cloudBottom: 900,
      cloudTop: 5200,
      cloudAnvil: 0.0,
      storm: 0.0,
      fog: 0.0,
      spray: 0.0,
      lightningRate: 0.0,
      seaLevel: 0.0,
      waterScatter: new THREE.Vector3(0.010, 0.045, 0.092),
      waterAbsorb: new THREE.Vector3(0.003, 0.016, 0.036),
      foamStrength: 1.0,
      sunIntensity: 22.0,
      starIntensity: 1.0,
      timeScale: 1.0,
    };
    this.target = {
      ...this.state,
      waterScatter: this.state.waterScatter.clone(),
      waterAbsorb: this.state.waterAbsorb.clone(),
    };
    this.rates = {
      windSpeed: 0.28, windAngle: 0.15, rain: 0.4, turbidity: 0.25,
      sunElevation: 0.10, sunAzimuth: 0.06, cloudCoverage: 0.22, cloudDensity: 0.25,
      storm: 0.3, spray: 0.5, fog: 0.3, amplitude: 0.3, swellHs: 0.16,
      swellPeriod: 0.14, choppiness: 0.3, cloudAnvil: 0.2, sunIntensity: 0.4, seaLevel: 0.5,
      _default: 0.35,
    };

    this._sunDirTmp = new THREE.Vector3();
    this.beaufort = [3, 'GENTLE BREEZE'];
    this.whitecap = 0.0;
  }

  set(partial: Partial<WeatherState>, immediate = false) {
    for (const k of Object.keys(partial)) {
      if (k === 'waterScatter' || k === 'waterAbsorb') {
        this.target[k].copy(partial[k]);
        if (immediate) this.state[k].copy(partial[k]);
      } else {
        this.target[k] = (partial as any)[k];
        if (immediate) this.state[k] = (partial as any)[k];
      }
    }
  }

  update(dt: number) {
    const s = this.state, t = this.target;
    for (const k of Object.keys(s)) {
      if (k === 'waterScatter' || k === 'waterAbsorb') {
        const rate = 0.4;
        s[k].x = damp(s[k].x, t[k].x, rate, dt);
        s[k].y = damp(s[k].y, t[k].y, rate, dt);
        s[k].z = damp(s[k].z, t[k].z, rate, dt);
        continue;
      }
      if (typeof s[k] !== 'number') continue;
      const rate = (this.rates[k] ?? this.rates._default) * 4.0;
      s[k] = damp(s[k], t[k], rate, dt);
    }

    const ws = s.windSpeed;
    const gustPhase = (this.app.time ?? 0) * 0.21;
    const gust = 1.0 + s.gustiness * (Math.sin(gustPhase) * 0.5 + Math.sin(gustPhase * 2.37 + 1.1) * 0.3 + Math.sin(gustPhase * 5.1) * 0.2);
    const wsGust = ws * gust;

    if (this.app.ocean?.params) {
      const p = this.app.ocean.params;
      p.windSpeed = wsGust;
      p.windDir = s.windAngle;
      p.swellHs = s.swellHs;
      p.swellDir = s.swellAngle;
      p.swellPeriod = s.swellPeriod;
      p.spread = s.spread;
      p.amplitude = s.amplitude;
      p.choppiness = s.choppiness;
      const whitecap = THREE.MathUtils.clamp(3.84e-6 * Math.pow(Math.max(wsGust, 0.1), 3.41), 0, 0.16);
      const wt = THREE.MathUtils.clamp(ws / 30, 0, 1);
      p.foamBias = lerp(0.01, 0.16, wt);
      p.steepBias = lerp(0.85, 0.52, wt);
      p.foamMul = lerp(0.30, 0.54, wt) * s.foamStrength;
      p.foamDecay = lerp(0.9, 0.5, wt);
      p.bubbleDecay = lerp(0.35, 0.11, wt);
      this.whitecap = whitecap;
    }

    U.uWindSpeed.value = wsGust;
    U.uWindDir.value.set(Math.cos(s.windAngle), Math.sin(s.windAngle));
    U.uGustiness.value = s.gustiness;
    U.uRain.value = s.rain;
    U.uFogDensity.value = s.fog;
    U.uSprayAmount.value = s.spray;
    U.uWhitecapCoverage.value = this.whitecap;
    U.uStormFactor.value = s.storm;
    U.uSeaLevel.value = s.seaLevel;

    const el = s.sunElevation, az = s.sunAzimuth;
    this._sunDirTmp.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    U.uSunDir.value.copy(this._sunDirTmp);
    if (this.app.atmosphere) {
      this.app.atmosphere.sunDir.copy(this._sunDirTmp);
      this.app.atmosphere.turbidity = s.turbidity;
      this.app.atmosphere.mieG = s.mieG;
      this.app.atmosphere.sunIntensity = s.sunIntensity;
    }
    U.uSunIntensity.value = s.sunIntensity;
    U.uAtmoTurbidity.value = s.turbidity;
    U.uAtmoMieG.value = s.mieG;
    U.uMoonDir.value.set(-Math.cos(el * 0.6) * Math.cos(az + 2.6), Math.max(0.25, -Math.sin(el) * 0.8 + 0.35), -Math.cos(el * 0.6) * Math.sin(az + 2.6)).normalize();

    if (this.app.sky) {
      this.app.sky.starIntensity = s.starIntensity;
    }

    if (this.app.oceanMesh?.uniforms) {
      const om = this.app.oceanMesh.uniforms;
      om.uWaterScatter.value.copy(s.waterScatter);
      om.uWaterAbsorb.value.copy(s.waterAbsorb);
      om.uFoamStrength.value = s.foamStrength;
    }

    const cu = this.app.clouds?.shared;
    if (cu) {
      cu.uCoverage.value = s.cloudCoverage;
      cu.uCloudDensity.value = s.cloudDensity;
      cu.uCloudBottom.value = s.cloudBottom;
      cu.uCloudTop.value = Math.max(s.cloudTop, s.cloudBottom + 400);
      cu.uAnvil.value = s.cloudAnvil;
      const cloudAngle = s.windAngle + 0.35;
      const cloudSpeed = 2.5 + ws * 0.42;
      cu.uCloudWind.value.set(Math.cos(cloudAngle) * cloudSpeed, Math.sin(cloudAngle) * cloudSpeed);
      cu.uCloudScaleM.value = lerp(7000, 20000, THREE.MathUtils.clamp(s.storm, 0, 1));
    }

    this.beaufort = beaufort(wsGust);
  }
}
