import * as THREE from 'three';
import { SpectralCascade } from '../ocean/SpectralCascade';
import { WeatherPreset, WeatherProfile } from '../ocean/OceanTypes';
import { SkyAtmosphereResult } from '../sky/SkyAtmosphere';

export class WeatherManager {
  weatherName: WeatherPreset = 'breeze';
  weatherSettling = false;
  residualStorm = { value: 0 };
  surfaceWind = { value: 1.15 };
  windDirection = { value: new THREE.Vector2(Math.cos(1.26), Math.sin(1.26)) };

  private sky: SkyAtmosphereResult;
  private cascades: SpectralCascade[];
  private scene: THREE.Scene;
  private timeUniform: { value: number };
  private reducedMotion: boolean;

  private clearFog = new THREE.Color(0.34, 0.54, 0.69);
  private stormFog = new THREE.Color(0.07, 0.085, 0.11);
  private warmSun = new THREE.Color(0xfff3d9);
  private stormSun = new THREE.Color(0xc5d2e9);

  private weatherProfiles: Record<WeatherPreset, WeatherProfile> = {
    calm: { gains: [0.95, 0.29, 0.36], storm: 0, wind: 0.3, clouds: 0.075, golden: 0, angle: 1.18 },
    breeze: { gains: [1.45, 1.25, 1.1], storm: 0, wind: 1.15, clouds: 0.23, golden: 0, angle: 1.26 },
    golden: { gains: [1.6, 0.95, 0.85], storm: 0, wind: 0.88, clouds: 0.12, golden: 1, angle: 1.15 },
    storm: { gains: [3.8, 4.1, 2.1], storm: 1, wind: 3.6, clouds: 1, golden: 0, angle: 0.05 },
  };

  constructor(
    sky: SkyAtmosphereResult,
    cascades: SpectralCascade[],
    scene: THREE.Scene,
    timeUniform: { value: number },
    reducedMotion: boolean
  ) {
    this.sky = sky;
    this.cascades = cascades;
    this.scene = scene;
    this.timeUniform = timeUniform;
    this.reducedMotion = reducedMotion;
  }

  setWeather(name: WeatherPreset) {
    if (!this.weatherProfiles[name]) return;
    this.weatherName = name;
    if (name === 'storm') {
      this.sky.setNextLightning(this.timeUniform.value + 1.4 + Math.random() * 1.2);
    } else {
      this.sky.setNextLightning(Infinity);
      this.sky.setStrikeTime(-100);
    }
  }

  cycleWeather(): WeatherPreset {
    const list: WeatherPreset[] = ['calm', 'breeze', 'golden', 'storm'];
    const idx = list.indexOf(this.weatherName);
    const next = list[(idx + 1) % list.length];
    this.setWeather(next);
    return next;
  }

  update(delta: number, paused: boolean) {
    const profile = this.weatherProfiles[this.weatherName];
    const blend = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 0.9);

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    this.sky.skyUniforms.uStorm.value = lerp(this.sky.skyUniforms.uStorm.value, profile.storm, blend);
    this.sky.skyUniforms.uWind.value = lerp(this.sky.skyUniforms.uWind.value, profile.wind, blend);
    this.sky.skyUniforms.uCloudCover.value = lerp(this.sky.skyUniforms.uCloudCover.value, profile.clouds, blend);

    this.weatherSettling = Math.abs(this.sky.skyUniforms.uStorm.value - profile.storm) > 0.002;

    this.cascades.forEach((cascade, index) => {
      const gain = cascade.pack.uniforms.uGain;
      const inertia = [44, 8.0, 1.65][index];
      gain.value = lerp(gain.value, profile.gains[index], this.reducedMotion ? 1 : 1 - Math.exp(-delta / inertia));
      this.weatherSettling = this.weatherSettling || Math.abs(gain.value - profile.gains[index]) > 0.002;
    });

    this.sky.skyUniforms.uGolden.value = lerp(this.sky.skyUniforms.uGolden.value, profile.golden, blend * 0.4);
    const golden = this.sky.skyUniforms.uGolden.value;

    this.surfaceWind.value = lerp(this.surfaceWind.value, profile.wind, 1 - Math.exp(-delta / 1.3));
    this.windDirection.value
      .lerp(new THREE.Vector2(Math.cos(profile.angle), Math.sin(profile.angle)), 1 - Math.exp(-delta / 18))
      .normalize();

    this.sky.sunDirection.copy(this.sky.daylightSunDirection).lerp(this.sky.goldenSunDirection, golden).normalize();
    this.sky.sun.position.copy(this.sky.sunDirection).multiplyScalar(850);

    this.residualStorm.value = lerp(
      this.residualStorm.value,
      profile.storm,
      1 - Math.exp(-delta / (profile.storm > this.residualStorm.value ? 5 : 26))
    );

    const storm = this.sky.skyUniforms.uStorm.value;
    if (!paused && !this.reducedMotion && storm > 0.65 && this.timeUniform.value >= this.sky.getNextLightning()) {
      this.sky.createLightning();
    }

    const age = this.timeUniform.value - this.sky.getStrikeTime();
    const flash =
      !paused && !this.reducedMotion && this.weatherName === 'storm' && age >= 0 && age < 0.48
        ? Math.min(1, age / 0.025) * Math.exp(-age * 11) * 1.4
        : 0;
    this.sky.skyUniforms.uFlash.value = flash;
    this.sky.lightning.visible = flash > 0.004;

    this.sky.sun.intensity = lerp(lerp(3.05, 3.8, golden), 0.35, storm) + flash * 0.8;
    this.sky.sun.shadow.intensity = lerp(0.87, 0.44, storm);
    this.sky.sun.color.copy(this.warmSun).lerp(new THREE.Color(1.0, 0.66, 0.34), golden).lerp(this.stormSun, storm);

    this.sky.hemisphere.intensity = lerp(lerp(1.45, 0.85, golden), 0.67, storm) + flash * 1.1;
    this.sky.ambient.intensity = lerp(0.12, 0.18, storm) + flash * 0.4;

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.lerpColors(this.clearFog, this.stormFog, storm);
      this.scene.fog.near = lerp(2500, 1000, storm);
      this.scene.fog.far = lerp(25000, 6800, storm);
    }
  }
}
