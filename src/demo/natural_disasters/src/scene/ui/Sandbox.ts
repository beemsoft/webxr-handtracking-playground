import * as THREE from 'three';

export const CONDITIONS: Record<string, { label: string; desc: string; w: Record<string, any> }> = {
  clear: {
    label: 'CLEAR DAY',
    desc: 'BEAUFORT 3 · UNLIMITED VISIBILITY',
    w: {
      windSpeed: 5.0, gustiness: 0.15, swellHs: 1.1, swellPeriod: 11.0, choppiness: 1.1,
      amplitude: 1.0, spread: 0.6, rain: 0, storm: 0, fog: 0, spray: 0, lightningRate: 0,
      turbidity: 2.0, sunElevation: 0.66, sunAzimuth: 1.9, sunIntensity: 26,
      cloudCoverage: 0.12, cloudDensity: 0.35, cloudBottom: 1400, cloudTop: 3000,
      cloudAnvil: 0.0, foamStrength: 0.7, starIntensity: 0,
    },
  },
  trade: {
    label: 'TRADE WIND',
    desc: 'BEAUFORT 5 · SCATTERED CUMULUS',
    w: {
      windSpeed: 10.5, gustiness: 0.3, swellHs: 2.2, swellPeriod: 10.5, choppiness: 1.25,
      amplitude: 1.0, spread: 0.7, rain: 0, storm: 0.1, fog: 0.05, spray: 0.15, lightningRate: 0,
      turbidity: 3.0, sunElevation: 0.72, sunAzimuth: 2.1, sunIntensity: 24,
      cloudCoverage: 0.38, cloudDensity: 0.55, cloudBottom: 1100, cloudTop: 3800,
      cloudAnvil: 0.15, foamStrength: 0.95, starIntensity: 0,
    },
  },
  golden: {
    label: 'GOLDEN HOUR',
    desc: 'LOW SUN · LONG SWELL',
    w: {
      windSpeed: 7.5, gustiness: 0.2, swellHs: 2.8, swellPeriod: 13.5, choppiness: 1.15,
      amplitude: 1.0, spread: 0.5, rain: 0, storm: 0.05, fog: 0.12, spray: 0.1, lightningRate: 0,
      turbidity: 4.5, sunElevation: 0.055, sunAzimuth: 1.35, sunIntensity: 20,
      cloudCoverage: 0.34, cloudDensity: 0.6, cloudBottom: 1300, cloudTop: 5200,
      cloudAnvil: 0.3, foamStrength: 0.9, starIntensity: 0.2,
    },
  },
  overcast: {
    label: 'OVERCAST',
    desc: 'CLOSED DECK · FLAT LIGHT',
    w: {
      windSpeed: 12.0, gustiness: 0.35, swellHs: 3.0, swellPeriod: 10.0, choppiness: 1.3,
      amplitude: 1.0, spread: 0.8, rain: 0.12, storm: 0.3, fog: 0.3, spray: 0.3, lightningRate: 0,
      turbidity: 5.0, sunElevation: 0.42, sunAzimuth: 2.4, sunIntensity: 18,
      cloudCoverage: 0.68, cloudDensity: 0.9, cloudBottom: 700, cloudTop: 3400,
      cloudAnvil: 0.2, foamStrength: 1.0, starIntensity: 0,
    },
  },
  squall: {
    label: 'SQUALL',
    desc: 'BEAUFORT 9 · DRIVING RAIN',
    w: {
      windSpeed: 21.0, gustiness: 0.55, swellHs: 5.0, swellPeriod: 9.5, choppiness: 1.35,
      amplitude: 1.0, spread: 0.85, rain: 0.8, storm: 0.75, fog: 0.5, spray: 0.9,
      lightningRate: 0.35, turbidity: 6.0, sunElevation: 0.3, sunAzimuth: 1.8, sunIntensity: 16,
      cloudCoverage: 0.7, cloudDensity: 1.0, cloudBottom: 800, cloudTop: 5200,
      cloudAnvil: 0.5, foamStrength: 1.4, starIntensity: 0,
    },
  },
  storm: {
    label: 'VIOLENT STORM',
    desc: 'BEAUFORT 11 · MOUNTAINOUS SEA',
    w: {
      windSpeed: 30.0, gustiness: 0.7, swellHs: 9.0, swellPeriod: 12.0, choppiness: 1.4,
      amplitude: 1.0, spread: 0.9, rain: 1.0, storm: 1.0, fog: 0.6, spray: 1.4,
      lightningRate: 0.8, turbidity: 6.5, sunElevation: 0.2, sunAzimuth: 1.6, sunIntensity: 14,
      cloudCoverage: 0.74, cloudDensity: 1.1, cloudBottom: 620, cloudTop: 5600,
      cloudAnvil: 0.75, foamStrength: 1.8, starIntensity: 0,
    },
  },
  night: {
    label: 'NIGHT STORM',
    desc: 'NO MOON · LIGHTNING ONLY',
    w: {
      windSpeed: 26.0, gustiness: 0.65, swellHs: 7.5, swellPeriod: 11.5, choppiness: 1.35,
      amplitude: 1.0, spread: 0.9, rain: 0.85, storm: 1.0, fog: 0.5, spray: 1.1,
      lightningRate: 1.4, turbidity: 5.5, sunElevation: -0.22, sunAzimuth: 1.5, sunIntensity: 9,
      cloudCoverage: 0.72, cloudDensity: 1.05, cloudBottom: 700, cloudTop: 5000,
      cloudAnvil: 0.6, foamStrength: 1.5, starIntensity: 1.0,
    },
  },
};

function el(tag: string, cls?: string | null, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function sbSlider(min: number, max: number, step: number, value: number, fmt: (v: number) => string, onChange: (v: number) => void) {
  const wrap = el('div', 'sb-slider') as HTMLDivElement & { set: (v: number) => void };
  const inp = document.createElement('input');
  inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(value);
  const val = el('span', 'sb-val', fmt(+value));
  inp.addEventListener('input', () => { val.textContent = fmt(+inp.value); onChange(+inp.value); });
  wrap.appendChild(inp); wrap.appendChild(val);
  wrap.set = (v: number) => { inp.value = String(v); val.textContent = fmt(+v); };
  return wrap;
}

export class Sandbox {
  app: any;
  active: boolean;
  rainOn: boolean;
  condition: string | null = null;
  private _banner: HTMLElement | null = null;
  private _bannerT: any = null;
  private _condBtns: Record<string, HTMLElement> = {};
  private _actionBtns: Record<string, HTMLElement> = {};
  private _sliders: Record<string, { s: any; map?: any }> = {};
  private _speedSlider: any;
  private _zoomSlider: any;
  private _entered = false;
  private _lastFov = 0;
  private _lastSpeed = 0;
  root!: HTMLElement;

  constructor(app: any) {
    this.app = app;
    this.active = false;
    this.rainOn = false;
    this._build();
  }

  fire(name: string, fn: () => void, opts: { shake?: number; rise?: number; hold?: number; drop?: number; zoomOut?: number } = {}) {
    fn();
    if (opts.shake && this.app.cine) this.app.cine.impulse(opts.shake);
    if (opts.rise && this.app.weather && this.app.camera && this.app.cine) {
      const y = this.app.weather.state.seaLevel + opts.rise;
      if (this.app.camera.position.y < y) this.app.cine.riseTo(y, opts.hold ?? 12);
    }
    if (opts.drop && this.app.camera && this.app.camera.position.y < 400 && this.app.cine) {
      this.app.cine.dropTo(opts.drop, opts.hold ?? 12);
    }
    if (opts.zoomOut && this.app.cine && this.app.cine.freeFov < opts.zoomOut) this.app.cine.setZoom(opts.zoomOut);
    this.flash(name);
    this._syncSliders();
    this._syncButtons();
  }

  private _baseSky(key: string, extra: Record<string, any> = {}) {
    const base = { ...CONDITIONS[key].w };
    if (this.app.weather && this.app.weather.target.sunElevation > 0.12) {
      base.sunElevation = this.app.weather.target.sunElevation;
      base.sunAzimuth = this.app.weather.target.sunAzimuth;
    }
    if (this.app.weather) this.app.weather.set({ ...base, ...extra });
    this.condition = null;
  }

  flash(text: string) {
    const b = this._banner;
    if (!b) return;
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('show'), 1800);
  }

  aim(min = 260, max = 4000) {
    if (!this.app.cine || !this.app.camera) return { x: 0, z: -400, dist: 400 };
    const a = this.app.cine.aimPoint(900);
    const cam = this.app.camera.position;
    let dx = a.x - cam.x, dz = a.z - cam.z;
    const d = Math.hypot(dx, dz) || 1;
    const t = THREE.MathUtils.clamp(d, min, max);
    return { x: cam.x + (dx / d) * t, z: cam.z + (dz / d) * t, dist: t };
  }

  applyCondition(key: string, immediate = false) {
    const c = CONDITIONS[key];
    if (!c || !this.app.weather) return;
    this.app.weather.set(c.w, immediate);
    this.rainOn = c.w.rain > 0.05;
    this.condition = key;
    this.flash(c.label);
    this._syncButtons();
    this._syncSliders();
  }

  lightning() {
    const w = this.app.weather;
    if (w && w.state.cloudCoverage < 0.3) {
      w.set({ cloudCoverage: 0.55, cloudDensity: 0.9, cloudAnvil: 0.5, storm: 0.45 });
      this.condition = null;
    }
    this.fire('LIGHTNING', () => this.app.director?.lightningBurst(8), { shake: 0.9 });
  }

  toggleRain() {
    const w = this.app.weather;
    if (!w) return;
    const on = !this.rainOn;
    this.rainOn = on;
    this.fire(on ? 'RAIN' : 'RAIN OFF', () => {
      if (!on) { w.set({ rain: 0.0 }); return; }
      w.set({
        rain: 0.85,
        fog: Math.max(w.target.fog, 0.35),
        cloudCoverage: Math.max(w.target.cloudCoverage, 0.62),
        cloudDensity: Math.max(w.target.cloudDensity, 0.95),
        cloudBottom: Math.min(w.target.cloudBottom, 900),
      });
      this.condition = null;
    }, { shake: on ? 0.3 : 0 });
  }

  waterspout() {
    const a = this.aim(340, 1100);
    if (this.app.weather && this.app.weather.target.cloudCoverage < 0.5) this._baseSky('squall');
    this.fire('WATERSPOUT', () => this.app.director?.spawnWaterspout(a.x, a.z, 32),
      { shake: 1.0, rise: 70, hold: 22, zoomOut: 62 });
  }

  whirlpool() {
    const a = this.aim(150, 420);
    this._baseSky('overcast', { windSpeed: 15, swellHs: 4.0, spray: 0.5, foamStrength: 1.5 });
    this.fire('MAELSTROM', () => this.app.director?.spawnWhirlpool(a.x, a.z, 42, 110),
      { shake: 0.9, rise: 65, hold: 22, zoomOut: 56 });
  }

  hurricane() {
    const a = this.aim(1600, 3200);
    this._baseSky('storm', {
      windSpeed: 36, gustiness: 0.85, spray: 1.9, cloudCoverage: 0.76, cloudDensity: 1.2,
      cloudAnvil: 1.0, cloudBottom: 520, cloudTop: 6400, lightningRate: 1.0, swellHs: 12.0,
      turbidity: 7.0, fog: 0.65, foamStrength: 2.0,
    });
    this.rainOn = true;
    this.fire('HURRICANE', () => this.app.director?.spawnHurricane(a.x, a.z, 32),
      { shake: 1.8, rise: 120, hold: 30, zoomOut: 68 });
  }

  rogue() {
    const cam = this.app.camera;
    if (!cam) return;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const angle = Math.atan2(f.z, f.x) + Math.PI;
    if (this.app.weather && this.app.weather.target.windSpeed < 16) {
      this._baseSky('squall', { rain: this.rainOn ? 0.8 : 0.15, fog: 0.35 });
    }
    this.fire('ROGUE WAVE', () => this.app.director?.spawnRogue({ angle, distance: 560, height: 30 }),
      { shake: 2.0, drop: 9, hold: 18, zoomOut: 50 });
  }

  tsunami() {
    if (!this.app.camera) return;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.app.camera.quaternion);
    const h = Math.hypot(f.x, f.z) || 1;
    const cam = this.app.camera.position;
    const along = (-f.x / h) * cam.x + (-f.z / h) * cam.z;
    this.fire('TSUNAMI', () => this.app.director?.spawnTsunami({
      dirX: -f.x / h, dirZ: -f.z / h,
      height: 42, width: 150, steep: 1.35, speed: 62, distance: along - 640,
    }), { shake: 2.4, drop: 12, hold: 26, zoomOut: 52 });
  }

  calm() {
    this.app.director?.clearEvents();
    this.applyCondition('clear');
  }

  private _build() {
    const root = el('div', 'sb');
    root.id = 'sandbox';

    const cross = el('div', 'sb-cross');
    cross.innerHTML = '<i></i><i></i>';
    root.appendChild(cross);

    this._banner = el('div', 'sb-banner');
    root.appendChild(this._banner);

    const left = el('div', 'sb-left');
    left.appendChild(el('h4', null, 'CONDITIONS'));
    const condRow = el('div', 'sb-grid');
    this._condBtns = {};
    for (const key of Object.keys(CONDITIONS)) {
      const b = el('button', 'sb-btn', CONDITIONS[key].label);
      b.addEventListener('click', () => this.applyCondition(key));
      this._condBtns[key] = b;
      condRow.appendChild(b);
    }
    left.appendChild(condRow);

    left.appendChild(el('h4', null, 'SKY'));
    const w = this.app.weather;
    const mk = (label: string, key: string, min: number, max: number, step: number, fmt: (v: number) => string, map?: any) => {
      const val0 = w && w.target ? w.target[key] : min;
      const s = sbSlider(min, max, step, map ? map.to(val0) : val0, fmt,
        (v) => {
          if (w && w.target) {
            w.target[key] = map ? map.from(v) : v;
            if (this.condition) { this.condition = null; this._syncButtons(); }
            if (key === 'rain') { this.rainOn = v > 0.05; this._syncButtons(); }
          }
        });
      const r = el('div', 'sb-row');
      r.appendChild(el('label', null, label));
      r.appendChild(s);
      left.appendChild(r);
      this._sliders[key] = { s, map };
      return s;
    };
    const f1 = (v: number) => v.toFixed(1);
    const f2 = (v: number) => v.toFixed(2);
    const fInt = (v: number) => v.toFixed(0);

    mk('sun °', 'sunElevation', -12, 90, 0.5, fInt, {
      to: (v: number) => Math.asin(THREE.MathUtils.clamp(v, -1, 1)) * 180 / Math.PI,
      from: (v: number) => Math.sin(v * Math.PI / 180),
    });
    mk('sun dir', 'sunAzimuth', -3.14, 3.14, 0.02, f2);
    mk('cloud', 'cloudCoverage', 0, 1, 0.01, f2);
    mk('density', 'cloudDensity', 0, 1.6, 0.01, f2);
    mk('base m', 'cloudBottom', 300, 3000, 10, fInt);
    mk('anvil', 'cloudAnvil', 0, 1, 0.01, f2);
    mk('haze', 'turbidity', 1, 12, 0.1, f1);

    left.appendChild(el('h4', null, 'SEA'));
    mk('wind m/s', 'windSpeed', 0, 45, 0.5, f1);
    mk('wind dir', 'windAngle', -3.14, 3.14, 0.02, f2);
    mk('swell m', 'swellHs', 0, 16, 0.1, f1);
    mk('period s', 'swellPeriod', 5, 18, 0.1, f1);
    mk('chop', 'choppiness', 0, 2.0, 0.02, f2);
    mk('rain', 'rain', 0, 1, 0.01, f2);
    mk('spray', 'spray', 0, 2, 0.02, f2);

    left.appendChild(el('h4', null, 'CAMERA'));
    const spd = sbSlider(2, 600, 1, this.app.cine?.freeSpeed || 40, fInt, (v) => { if (this.app.cine) this.app.cine.freeSpeed = v; });
    const spdRow = el('div', 'sb-row');
    spdRow.appendChild(el('label', null, 'speed'));
    spdRow.appendChild(spd);
    left.appendChild(spdRow);
    this._speedSlider = spd;

    const zoom = sbSlider(9, 90, 1, 55, fInt, (v) => this.app.cine?.setZoom(v));
    const zoomRow = el('div', 'sb-row');
    zoomRow.appendChild(el('label', null, 'zoom fov'));
    zoomRow.appendChild(zoom);
    left.appendChild(zoomRow);
    this._zoomSlider = zoom;

    root.appendChild(left);

    const dock = el('div', 'sb-dock');
    const actions: [string, string, () => void][] = [
      ['1', 'LIGHTNING', () => this.lightning()],
      ['2', 'RAIN', () => this.toggleRain()],
      ['3', 'WATERSPOUT', () => this.waterspout()],
      ['4', 'MAELSTROM', () => this.whirlpool()],
      ['5', 'HURRICANE', () => this.hurricane()],
      ['6', 'ROGUE WAVE', () => this.rogue()],
      ['7', 'TSUNAMI', () => this.tsunami()],
      ['0', 'CALM ALL', () => this.calm()],
    ];
    this._actionBtns = {};
    for (const [key, label, fn] of actions) {
      const b = el('button', 'sb-act');
      b.appendChild(el('kbd', null, key));
      b.appendChild(el('span', null, label));
      b.addEventListener('click', fn);
      this._actionBtns[label] = b;
      dock.appendChild(b);
    }
    root.appendChild(dock);

    const help = el('div', 'sb-help');
    help.innerHTML = 'WASD move · SPACE/Q up-down · SHIFT sprint · CTRL slow<br>'
      + 'MOUSE look (click to capture, ESC to release) · WHEEL zoom · CTRL+WHEEL speed<br>'
      + '1-7 events · 0 calm · TAB settings · C cinematic mode';
    root.appendChild(help);

    document.body.appendChild(root);
    this.root = root;

    window.addEventListener('keydown', (e) => {
      if (!this.active || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const map: Record<string, () => void> = {
        Digit1: () => this.lightning(), Digit2: () => this.toggleRain(),
        Digit3: () => this.waterspout(), Digit4: () => this.whirlpool(),
        Digit5: () => this.hurricane(), Digit6: () => this.rogue(),
        Digit7: () => this.tsunami(), Digit0: () => this.calm(),
      };
      if (map[e.code]) { map[e.code](); e.preventDefault(); }
    });
  }

  private _syncButtons() {
    for (const k of Object.keys(this._condBtns)) {
      this._condBtns[k].classList.toggle('active', k === this.condition);
    }
    this._actionBtns.RAIN?.classList.toggle('active', this.rainOn);
  }

  private _syncSliders() {
    if (!this.app.weather || !this.app.weather.target) return;
    const t = this.app.weather.target;
    for (const key of Object.keys(this._sliders || {})) {
      const { s, map } = this._sliders[key];
      if (t[key] !== undefined) s.set(map ? map.to(t[key]) : t[key]);
    }
  }

  setActive(on: boolean) {
    this.active = on;
    this.root.classList.toggle('on', on);
    document.body.classList.toggle('sandbox', on);
    if (on) {
      if (this.app.director) this.app.director.enabled = false;
      if (this.app.cine) this.app.cine.setFree(true);
      document.body.classList.remove('cine');
      if (!this._entered) {
        this._entered = true;
        this.applyCondition('trade');
        if (this.app.cine) this.app.cine.setZoom(60);
      }
      this._syncSliders();
      this._syncButtons();
      if (this.app.cine) {
        this._zoomSlider?.set(this.app.cine.freeFov);
        this._speedSlider?.set(this.app.cine.freeSpeed);
      }
    } else {
      if (this.app.cine) this.app.cine.setFree(false);
      if (this.app.director) this.app.director.enabled = true;
      document.body.classList.add('cine');
    }
  }

  tick() {
    if (!this.active || !this.app.cine) return;
    const fov = Math.round(this.app.cine.freeFov);
    if (fov !== this._lastFov) { this._lastFov = fov; this._zoomSlider?.set(fov); }
    const sp = Math.round(this.app.cine.freeSpeed);
    if (sp !== this._lastSpeed) { this._lastSpeed = sp; this._speedSlider?.set(sp); }
  }
}
