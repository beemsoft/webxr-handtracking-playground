export interface PresetConfig {
  label: string;
  renderScale: number;
  maxPixelRatio: number;
  oceanGridX: number;
  oceanGridY: number;
  fftSize: number;
  cloudScale: number;
  cloudSteps: number;
  cloudLightSteps: number;
  cloudEnabled: boolean;
  sprayCount: number;
  rainCount: number;
  dof: boolean;
  motionBlur: boolean;
  taa: boolean;
  envSize: number;
  envCloudSteps: number;
  spoutSteps: number;
}

export const PRESETS: Record<string, PresetConfig> = {
  potato: {
    label: 'POTATO', renderScale: 0.6, maxPixelRatio: 1.0,
    oceanGridX: 96, oceanGridY: 60, fftSize: 128,
    cloudScale: 0.25, cloudSteps: 16, cloudLightSteps: 3, cloudEnabled: false,
    sprayCount: 2048, rainCount: 3000, dof: false, motionBlur: false, taa: false,
    envSize: 128, envCloudSteps: 8, spoutSteps: 24,
  },
  low: {
    label: 'LOW', renderScale: 0.72, maxPixelRatio: 1.0,
    oceanGridX: 110, oceanGridY: 70, fftSize: 128,
    cloudScale: 0.3, cloudSteps: 24, cloudLightSteps: 3, cloudEnabled: false,
    sprayCount: 4000, rainCount: 6000, dof: false, motionBlur: false, taa: false,
    envSize: 128, envCloudSteps: 10, spoutSteps: 28,
  },
  medium: {
    label: 'MEDIUM', renderScale: 0.85, maxPixelRatio: 1.25,
    oceanGridX: 128, oceanGridY: 80, fftSize: 128,
    cloudScale: 0.35, cloudSteps: 32, cloudLightSteps: 4, cloudEnabled: false,
    sprayCount: 8000, rainCount: 12000, dof: false, motionBlur: false, taa: false,
    envSize: 128, envCloudSteps: 12, spoutSteps: 36,
  },
  high: {
    label: 'HIGH', renderScale: 1.0, maxPixelRatio: 1.25,
    oceanGridX: 144, oceanGridY: 90, fftSize: 128,
    cloudScale: 0.4, cloudSteps: 40, cloudLightSteps: 4, cloudEnabled: false,
    sprayCount: 12000, rainCount: 16000, dof: false, motionBlur: false, taa: false,
    envSize: 256, envCloudSteps: 14, spoutSteps: 44,
  },
  ultra: {
    label: 'ULTRA', renderScale: 1.0, maxPixelRatio: 1.5,
    oceanGridX: 160, oceanGridY: 100, fftSize: 128,
    cloudScale: 0.5, cloudSteps: 48, cloudLightSteps: 5, cloudEnabled: false,
    sprayCount: 16000, rainCount: 24000, dof: false, motionBlur: false, taa: false,
    envSize: 256, envCloudSteps: 16, spoutSteps: 52,
  },
};

export const TIERS = ['ultra', 'high', 'medium', 'low', 'potato'];

const SAMPLE_FRAMES = 24;
const SAMPLE_MS = 400;
const MIN_FRAMES = 4;
const MIN_SCALE = 0.5;
const PANIC = 4.0;

export class Quality implements PresetConfig {
  label: string;
  renderScale: number;
  maxPixelRatio: number;
  oceanGridX: number;
  oceanGridY: number;
  fftSize: number;
  cloudScale: number;
  cloudSteps: number;
  cloudLightSteps: number;
  cloudEnabled: boolean;
  sprayCount: number;
  rainCount: number;
  dof: boolean;
  motionBlur: boolean;
  taa: boolean;
  envSize: number;
  envCloudSteps: number;
  spoutSteps: number;

  presetName: string;
  adaptive: boolean;
  targetMs: number;
  dynamicScale: number;
  private _acc: number;
  private _count: number;
  private _cooldown: number;
  private _window: Float32Array;
  private _scratch: Float32Array;
  history: Float32Array;
  historyIndex: number;
  onDowngrade: ((name: string, scale: number) => void) | null;

  constructor(name = 'high') {
    this.adaptive = true;
    this.targetMs = 17.5;
    this.dynamicScale = 1.0;
    this._acc = 0;
    this._count = 0;
    this._cooldown = 0;
    this._window = new Float32Array(SAMPLE_FRAMES);
    this._scratch = new Float32Array(SAMPLE_FRAMES);
    this.history = new Float32Array(90);
    this.historyIndex = 0;
    this.onDowngrade = null;
    this.setPreset(name);
  }

  setPreset(name: string, scale = 1.0) {
    this.presetName = PRESETS[name] ? name : 'high';
    Object.assign(this, PRESETS[this.presetName]);
    this.dynamicScale = scale;
    this._cooldown = 2.0;
  }

  get effectiveScale() { return this.renderScale * this.dynamicScale; }

  tierBelow(n: number): string | null {
    const i = TIERS.indexOf(this.presetName);
    if (i < 0) return null;
    const j = Math.min(i + n, TIERS.length - 1);
    return j > i ? TIERS[j] : null;
  }

  private _median(n: number) {
    const s = this._scratch.subarray(0, n);
    s.set(this._window.subarray(0, n));
    s.sort();
    return (n & 1) ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) * 0.5;
  }

  private _shed(ms: number) {
    const tier = this.tierBelow(Math.max(1, Math.round(Math.log2(ms / this.targetMs))));
    if (tier && this.onDowngrade) {
      this.onDowngrade(tier, MIN_SCALE);
    } else {
      this.dynamicScale = MIN_SCALE;
    }
  }

  tick(frameMs: number): boolean {
    this.history[this.historyIndex] = frameMs;
    this.historyIndex = (this.historyIndex + 1) % this.history.length;

    if (!this.adaptive) return false;

    if (this._cooldown > 0) {
      this._cooldown -= (frameMs || 16.6) * 1e-3;
      return false;
    }

    if (frameMs > this.targetMs * PANIC) {
      this._shed(frameMs);
      this._acc = 0; this._count = 0;
      this._cooldown = 3.0;
      return true;
    }

    this._window[this._count++] = frameMs;
    this._acc += frameMs;

    const full = this._count >= SAMPLE_FRAMES;
    const timedOut = this._count >= MIN_FRAMES && this._acc >= SAMPLE_MS;
    if (!full && !timedOut) return false;

    const count = this._count;
    const med = this._median(count);
    this._acc = 0;
    this._count = 0;

    if (med > this.targetMs * 1.08) {
      if (this.dynamicScale > 0.72) {
        this.dynamicScale = Math.max(0.68, this.dynamicScale * 0.91);
        this._cooldown = 1.0;
        return true;
      }
      const lower = this.tierBelow(1);
      if (lower && this.onDowngrade) {
        this.onDowngrade(lower, 1.0);
        return true;
      }
      if (this.dynamicScale > MIN_SCALE) {
        this.dynamicScale = Math.max(MIN_SCALE, this.dynamicScale * 0.88);
        this._cooldown = 1.2;
        return true;
      }
    } else if (med < this.targetMs * 0.72) {
      if (this.dynamicScale < 0.98) {
        this.dynamicScale = Math.min(1.0, this.dynamicScale * 1.06);
        this._cooldown = 1.5;
        return true;
      }
    }
    return false;
  }
}

export function autoDetectPreset(rendererString = ''): string {
  const r = rendererString.toLowerCase();
  if (/apple m[234] (pro|max|ultra)|rtx (30[789]0|40[789]0)|radeon rx (6[89]00|7[89]00)/.test(r)) return 'ultra';
  if (/apple m[1234]|rtx 20[678]0|rtx 3060|gtx 1660|gtx 10[78]0|rx 6600|rx 5600|rx 5700/.test(r)) return 'high';
  if (/gtx 1650|gtx 10[56]0|rx 580|rx 5500|intel arc|iris xe|radeon graphics|mali-g7[78]|adreno (6[56]0|7[34]0)/.test(r)) return 'medium';
  if (/intel.*uhd|intel.*hd|mali|adreno|powervr|apple a\d+/.test(r)) return 'low';
  return 'medium';
}
