import { PRESETS } from '../core/Quality';
import { Sandbox } from './Sandbox';

const $ = (id: string) => document.getElementById(id);

function row(label: string, control: HTMLElement) {
  const d = document.createElement('div');
  d.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  d.appendChild(l);
  d.appendChild(control);
  return d;
}

function slider(min: number, max: number, step: number, value: number, onChange: (v: number) => void) {
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.style.gap = '6px';
  const inp = document.createElement('input');
  inp.type = 'range'; inp.min = String(min); inp.max = String(max); inp.step = String(step); inp.value = String(value);
  const val = document.createElement('span');
  val.className = 'val';
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  val.textContent = fmt(+value);
  inp.addEventListener('input', () => { val.textContent = fmt(+inp.value); onChange(+inp.value); });
  wrap.appendChild(inp); wrap.appendChild(val);
  return wrap;
}

function button(text: string, onClick: (btn: HTMLButtonElement) => void) {
  const b = document.createElement('button');
  b.textContent = text;
  b.addEventListener('click', () => onClick(b));
  return b;
}

function header(text: string) {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

export function installUI(app: any) {
  const panel = $('panel');
  const toggle = $('panelToggle');
  if (toggle && panel) {
    toggle.addEventListener('click', () => panel.classList.toggle('open'));
  }

  document.addEventListener('pointerup', (e) => {
    const c = (e.target as HTMLElement)?.closest?.('button, input') as HTMLElement | null;
    if (c) c.blur();
  });

  const d = app.director;
  const post = app.post?.settings;

  const sandbox = new Sandbox(app);
  app.sandbox = sandbox;
  const modeBtn = $('modeToggle');
  const setMode = (on: boolean) => {
    sandbox.setActive(on);
    if (modeBtn) {
      modeBtn.textContent = on ? 'CINEMATIC' : 'SANDBOX';
      modeBtn.classList.toggle('active', on);
    }
    if (on && panel) panel.classList.remove('open');
  };
  if (modeBtn) {
    modeBtn.addEventListener('click', () => setMode(!sandbox.active));
  }
  app.setSandbox = setMode;

  if (panel && d && post) {
    panel.appendChild(header('SEQUENCE'));
    const actRow = document.createElement('div');
    actRow.className = 'btnrow';
    actRow.appendChild(button('◀ PREV', () => d.gotoAct(d.actIndex - 1)));
    const playBtn = button('❚❚ PAUSE', (b) => {
      app.paused = !app.paused;
      b.textContent = app.paused ? '▶ PLAY' : '❚❚ PAUSE';
    });
    actRow.appendChild(playBtn);
    actRow.appendChild(button('NEXT ▶', () => d.gotoAct(d.actIndex + 1)));
    panel.appendChild(actRow);

    const actList = document.createElement('div');
    actList.className = 'btnrow';
    d.acts.forEach((a: any, i: number) => {
      const b = button(a.name, () => d.gotoAct(i));
      b.style.flex = '1 1 46%';
      b.style.fontSize = '9px';
      b.dataset.act = String(i);
      actList.appendChild(b);
    });
    panel.appendChild(actList);

    panel.appendChild(row('auto director', (() => {
      const b = button('ON', (btn) => {
        d.enabled = !d.enabled;
        btn.textContent = d.enabled ? 'ON' : 'OFF';
        btn.classList.toggle('active', d.enabled);
      });
      b.classList.add('active');
      return b;
    })()));

    panel.appendChild(row('time scale', slider(0, 3, 0.05, 1, (v) => { app.timeScale = v; })));

    panel.appendChild(header('CAMERA'));
    const camRow = document.createElement('div');
    camRow.className = 'btnrow';
    camRow.appendChild(button('FREE FLY', (b) => {
      if (app.cine) {
        app.cine.setFree(!app.cine.free);
        b.classList.toggle('active', app.cine.free);
        document.body.classList.toggle('cine', !app.cine.free);
      }
    }));
    camRow.appendChild(button('NEXT SHOT', () => d.nextShot()));
    panel.appendChild(camRow);
    panel.appendChild(row('aperture f/', slider(1.2, 22, 0.1, post.aperture, v => post.aperture = v)));
    panel.appendChild(row('focal len mm', slider(14, 200, 1, post.focalLength * 1000, v => post.focalLength = v / 1000)));

    panel.appendChild(header('WEATHER'));
    const w = d.weather;
    const addW = (lbl: string, key: string, min: number, max: number, step: number) => {
      const s = slider(min, max, step, w.target[key], (v) => { w.target[key] = v; });
      panel.appendChild(row(lbl, s));
    };
    addW('wind m/s', 'windSpeed', 0, 60, 0.5);
    addW('wind dir', 'windAngle', -3.2, 3.2, 0.02);
    addW('swell Hs m', 'swellHs', 0, 22, 0.1);
    addW('swell Tp s', 'swellPeriod', 4, 20, 0.1);
    addW('choppiness', 'choppiness', 0, 2.5, 0.02);
    addW('rain', 'rain', 0, 1, 0.01);
    addW('cloud cover', 'cloudCoverage', 0, 1, 0.01);
    addW('cloud density', 'cloudDensity', 0, 2, 0.01);
    addW('turbidity', 'turbidity', 1, 14, 0.1);
    addW('sun elev', 'sunElevation', -0.35, 1.4, 0.005);
    addW('sun azim', 'sunAzimuth', -3.2, 3.2, 0.01);

    panel.appendChild(header('DISASTERS'));
    const dis = document.createElement('div');
    dis.className = 'btnrow';
    dis.appendChild(button('LIGHTNING', () => d.lightningBurst(10)));
    dis.appendChild(button('WATERSPOUT', () => {
      const c = app.camera ? app.camera.position : { x: 0, z: 0 };
      d.spawnWaterspout(c.x + 60, c.z - 320, 30);
    }));
    dis.appendChild(button('ROGUE WAVE', () => d.spawnRogue()));
    dis.appendChild(button('TSUNAMI', () => d.spawnTsunami()));
    dis.appendChild(button('HURRICANE', () => {
      const c = app.camera ? app.camera.position : { x: 0, z: 0 };
      d.spawnHurricane(c.x, c.z);
    }));
    dis.appendChild(button('CLEAR', () => d.clearEvents()));
    panel.appendChild(dis);

    panel.appendChild(header('RENDER'));
    const qRow = document.createElement('div');
    qRow.className = 'btnrow';
    Object.keys(PRESETS).forEach((k) => {
      const b = button(PRESETS[k].label, (btn) => {
        app.setQualityPreset?.(k);
        qRow.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        btn.classList.add('active');
      });
      b.style.fontSize = '9px';
      if (app.quality && k === app.quality.presetName) b.classList.add('active');
      qRow.appendChild(b);
    });
    panel.appendChild(qRow);

    panel.appendChild(row('adaptive res', (() => {
      const b = button('ON', (btn) => {
        if (!app.quality) return;
        app.quality.adaptive = !app.quality.adaptive;
        btn.textContent = app.quality.adaptive ? 'ON' : 'OFF';
        btn.classList.toggle('active', app.quality.adaptive);
        if (!app.quality.adaptive) { app.quality.dynamicScale = 1; app._resize?.(true); }
      });
      b.classList.add('active');
      return b;
    })()));

    panel.appendChild(header('POST'));
    panel.appendChild(row('exposure', slider(0.2, 4, 0.05, post.exposureBias, v => post.exposureBias = v)));
    panel.appendChild(row('bloom', slider(0, 0.3, 0.005, post.bloomStrength, v => post.bloomStrength = v)));
    panel.appendChild(row('motion blur', slider(0, 2, 0.05, post.motionBlurStrength, v => post.motionBlurStrength = v)));
    panel.appendChild(row('grain', slider(0, 0.1, 0.002, post.grain, v => post.grain = v)));
    panel.appendChild(row('vignette', slider(0, 1.2, 0.02, post.vignette, v => post.vignette = v)));
    panel.appendChild(row('chromatic', slider(0, 3, 0.05, post.chromatic, v => post.chromatic = v)));
    panel.appendChild(row('sharpen', slider(0, 1, 0.02, post.sharpen, v => post.sharpen = v)));
    const tmRow = document.createElement('div');
    tmRow.className = 'btnrow';
    const agxB = button('AGX', (b) => { post.tonemap = 0; b.classList.add('active'); acesB.classList.remove('active'); });
    const acesB = button('ACES', (b) => { post.tonemap = 1; b.classList.add('active'); agxB.classList.remove('active'); });
    agxB.classList.add('active');
    tmRow.appendChild(agxB); tmRow.appendChild(acesB);
    panel.appendChild(tmRow);

    const toggles: [string, () => boolean, (v: boolean) => void][] = [
      ['TAA', () => post.taa, (v) => post.taa = v],
      ['DOF', () => post.dof, (v) => post.dof = v],
      ['MBLUR', () => post.motionBlur, (v) => post.motionBlur = v],
      ['BLOOM', () => post.bloom, (v) => post.bloom = v],
    ];
    const tRow = document.createElement('div');
    tRow.className = 'btnrow';
    toggles.forEach(([name, get, set]) => {
      const b = button(name, (btn) => { set(!get()); btn.classList.toggle('active', get()); });
      if (get()) b.classList.add('active');
      b.style.fontSize = '9px';
      tRow.appendChild(b);
    });
    panel.appendChild(tRow);
  }

  const hud: Record<string, HTMLElement | null> = {
    shot: $('hShot'), time: $('hTime'), beaufort: $('hBeaufort'), seaState: $('hSeaState'),
    wind: $('hWind'), windDir: $('hWindDir'), hs: $('hHs'), swell: $('hSwell'),
    fps: $('hFps'), ms: $('hMs'), res: $('hRes'), qual: $('hQual'),
    eventBox: $('event'), eventName: $('eventName'), eventDesc: $('eventDesc'),
    tlfill: $('tlfill'), tlticks: $('tlticks'),
  };

  if (hud.tlticks && d) {
    let accum = 0;
    d.acts.forEach((a: any) => {
      const s = document.createElement('span');
      s.style.left = `${(accum / d.totalDuration) * 100}%`;
      hud.tlticks!.appendChild(s);
      accum += a.duration;
    });
  }

  if (d) {
    d.onAct = (act: any) => {
      if (hud.eventName) hud.eventName.textContent = act.name;
      if (hud.eventDesc) hud.eventDesc.textContent = act.desc;
      if (hud.eventBox) {
        hud.eventBox.classList.add('show');
        clearTimeout((hud as any)._t);
        (hud as any)._t = setTimeout(() => hud.eventBox?.classList.remove('show'), 5200);
      }
    };
    if (d.acts[d.actIndex]) d.onAct(d.acts[d.actIndex], d.actIndex);
  }

  let fpsAcc = 0, fpsCount = 0, lastHud = 0;
  const origAfter = app.afterUpdate;
  app.afterUpdate = (scaled: number, dt: number) => {
    origAfter?.(scaled, dt);
    fpsAcc += app.frameMs || (dt * 1000); fpsCount++;
    const now = performance.now();
    if (now - lastHud < 180) return;
    sandbox.tick();
    lastHud = now;
    const ms = fpsAcc / Math.max(fpsCount, 1);
    fpsAcc = 0; fpsCount = 0;

    if (app.weather) {
      const ws = app.weather.state;
      const [bf, name] = app.weather.beaufort || [0, ''];
      if (hud.beaufort) hud.beaufort.textContent = String(bf);
      if (hud.seaState) hud.seaState.textContent = name;
      if (hud.wind) hud.wind.textContent = ws.windSpeed.toFixed(1);
      if (hud.windDir) hud.windDir.textContent = `${((ws.windAngle * 180 / Math.PI + 360) % 360).toFixed(0)}°`;
    }
    if (app.ocean) {
      if (hud.hs) hud.hs.textContent = app.ocean.significantWaveHeight.toFixed(1);
      if (hud.swell) hud.swell.textContent = (app.ocean.swellHsActual || 0).toFixed(1);
    }
    if (hud.fps) hud.fps.textContent = (1000 / Math.max(ms, 0.01)).toFixed(0);
    if (hud.ms) hud.ms.textContent = ms.toFixed(1);
    if (hud.res) hud.res.textContent = `${app.renderWidth || window.innerWidth}×${app.renderHeight || window.innerHeight}`;
    if (app.quality && hud.qual) hud.qual.textContent = `${app.quality.label} ${((app.quality.dynamicScale || 1) * 100).toFixed(0)}%`;
    if (d && hud.shot) hud.shot.textContent = `${d.actIndex + 1}.${d.shotIdx + 1}`;
    if (hud.time) hud.time.textContent = (app.time || 0).toFixed(1);

    if (d && hud.tlfill) {
      let before = 0;
      for (let i = 0; i < d.actIndex; i++) before += d.acts[i].duration;
      hud.tlfill.style.width = `${((before + d.actTime) / d.totalDuration) * 100}%`;
    }
  };

  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    switch (e.code) {
      case 'KeyH':
        document.getElementById('hud')?.classList.toggle('on');
        panel?.classList.remove('open');
        break;
      case 'KeyP':
        app.paused = !app.paused;
        break;
      case 'KeyN': d?.gotoAct(d.actIndex + 1); break;
      case 'KeyB': d?.gotoAct(d.actIndex - 1); break;
      case 'KeyF':
        if (app.cine) {
          app.cine.setFree(!app.cine.free);
          document.body.classList.toggle('cine', !app.cine.free);
        }
        break;
      case 'KeyL': d?.lightningBurst(10); break;
      case 'KeyC': setMode(!sandbox.active); break;
      case 'Tab': panel?.classList.toggle('open'); e.preventDefault(); break;
      default: break;
    }
  });
}
