import { CameraViewPreset, WeatherPreset } from '../ocean/OceanTypes';

export interface HUDCallbacks {
  onWeatherChange: (weather: WeatherPreset) => void;
  onViewChange: (view: CameraViewPreset) => void;
  onToggleMotion: () => boolean;
  onResetView: () => void;
}

export class HUD {
  private container: HTMLDivElement | null = null;
  private weatherButtons: Map<WeatherPreset, HTMLButtonElement> = new Map();
  private viewButtons: Map<CameraViewPreset, HTMLButtonElement> = new Map();
  private motionButton: HTMLButtonElement | null = null;
  private hideButton: HTMLButtonElement | null = null;
  private restoreButton: HTMLButtonElement | null = null;
  private isHidden = false;
  private callbacks: HUDCallbacks;

  constructor(callbacks: HUDCallbacks) {
    this.callbacks = callbacks;
    this.buildUI();
    this.setupKeyboardShortcuts();
  }

  private buildUI() {
    // Inject styles
    const style = document.createElement('style');
    style.textContent = `
      .ocean-sim-vignette { position: fixed; inset: 0; pointer-events: none; z-index: 10; background: linear-gradient(180deg, rgba(7,30,38,0.13), transparent 20%, transparent 65%, rgba(4,24,33,0.35)); }
      .ocean-sim-ui { position: fixed; inset: 0; pointer-events: none; z-index: 20; opacity: 1; transition: opacity .4s ease; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #f3f5ef; }
      .ocean-sim-ui.is-hidden { opacity: 0; visibility: hidden; }
      .ocean-sim-masthead { position: absolute; top: max(20px, env(safe-area-inset-top)); left: max(24px, env(safe-area-inset-left)); right: max(24px, env(safe-area-inset-right)); display: flex; justify-content: flex-end; }
      .ocean-sim-actions { display: flex; align-items: center; gap: 12px; pointer-events: auto; }
      .ocean-sim-weather-controls { display: flex; gap: 2px; padding: 3px; border: 1px solid rgba(238,246,240,0.22); border-radius: 25px; background: rgba(10,41,52,0.35); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
      .ocean-sim-weather-controls button { border: 0; border-radius: 22px; background: none; padding: 7px 12px; font-size: 11px; letter-spacing: .04em; color: rgba(241,246,237,0.68); cursor: pointer; transition: background .2s, color .2s; }
      .ocean-sim-weather-controls button[aria-pressed="true"] { background: rgba(241,246,237,0.22); color: #f6f8f0; font-weight: 600; }
      .ocean-sim-weather-controls button:hover { color: #ffffff; }
      .ocean-sim-icon-button { display: grid; place-items: center; padding: 0; border: 1px solid rgba(241,246,236,0.24); background: rgba(13,47,59,0.35); width: 36px; height: 36px; border-radius: 50%; color: #f1f6ed; cursor: pointer; transition: background .2s, border-color .2s; backdrop-filter: blur(12px); }
      .ocean-sim-icon-button:hover { background: rgba(241,246,236,0.2); border-color: rgba(241,246,236,0.5); }
      .ocean-sim-icon-button svg { width: 16px; height: 16px; }
      .ocean-sim-view-controls { position: absolute; bottom: max(24px, env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; padding: 5px; border: 1px solid rgba(230,244,239,0.20); border-radius: 40px; background: rgba(10,41,52,0.45); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); box-shadow: 0 5px 24px rgba(0,26,38,0.3); pointer-events: auto; }
      .ocean-sim-view-button { height: 36px; padding: 0 16px; border: 1px solid transparent; background: none; border-radius: 25px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 11px; letter-spacing: .035em; color: rgba(240,247,239,0.72); cursor: pointer; transition: background .3s, color .3s; white-space: nowrap; }
      .ocean-sim-view-button svg { width: 14px; height: 14px; }
      .ocean-sim-view-button:hover { background: rgba(238,246,240,0.12); color: #f4f7ef; }
      .ocean-sim-view-button[aria-pressed="true"] { color: #f4f7ef; background: rgba(237,245,233,0.22); border-color: rgba(237,245,233,0.15); font-weight: 600; }
      .ocean-sim-divider { width: 1px; height: 18px; background: rgba(238,246,240,0.18); margin: 0 3px; }
      #ocean-sim-restore { display: none; position: fixed; right: 24px; bottom: 24px; z-index: 25; pointer-events: auto; }
      body.ocean-sim-ui-hidden #ocean-sim-restore { display: grid; }
    `;
    document.head.appendChild(style);

    const vignette = document.createElement('div');
    vignette.className = 'ocean-sim-vignette';
    document.body.appendChild(vignette);

    this.container = document.createElement('div');
    this.container.className = 'ocean-sim-ui';
    this.container.innerHTML = `
      <header class="ocean-sim-masthead">
        <div class="ocean-sim-actions">
          <div class="ocean-sim-weather-controls" role="group" aria-label="Sea conditions">
            <button data-weather="calm" aria-pressed="false">Calm</button>
            <button data-weather="breeze" aria-pressed="true">Breeze</button>
            <button data-weather="golden" aria-pressed="false">Golden</button>
            <button data-weather="storm" aria-pressed="false">Storm</button>
          </div>
          <button class="ocean-sim-icon-button" id="ocean-sim-hide-ui" title="Hide UI (H)" aria-label="Hide interface">
            <svg viewBox="0 0 20 20" fill="none"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" stroke="currentColor" stroke-width="1.3"/><circle cx="10" cy="10" r="2.3" stroke="currentColor" stroke-width="1.3"/></svg>
          </button>
          <button class="ocean-sim-icon-button" id="ocean-sim-fullscreen" title="Fullscreen (F)" aria-label="Enter fullscreen">
            <svg viewBox="0 0 20 20" fill="none"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" stroke="currentColor" stroke-width="1.4"/></svg>
          </button>
        </div>
      </header>
      <nav class="ocean-sim-view-controls" aria-label="Scene controls">
        <button class="ocean-sim-view-button" data-view="aerial" aria-pressed="true" title="Aerial view (R)">
          <svg viewBox="0 0 18 18" fill="none"><path d="m2 11 7-7 7 7-7 4-7-4Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.2"/><path d="m2 7 7-4 7 4" stroke="currentColor" opacity=".5" stroke-width="1.2"/></svg>
          Aerial
        </button>
        <button class="ocean-sim-view-button" data-view="waterline" aria-pressed="false" title="Waterline explore">
          <svg viewBox="0 0 18 18" fill="none"><path d="M1 7c2-2 4-2 6 0s4 2 6 0 3-1 4 0M1 12c2-2 4-2 6 0s4 2 6 0 3-1 4 0" stroke="currentColor" stroke-linecap="round" stroke-width="1.2"/></svg>
          Waterline
        </button>
        <button class="ocean-sim-view-button" data-view="shallows" aria-pressed="false" title="Inspect shallows">
          <svg viewBox="0 0 18 18" fill="none"><path d="m9 2 1.7 4.9L16 9l-5.3 2.1L9 16l-1.7-4.9L2 9l5.3-2.1L9 2Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.2"/></svg>
          Shallows
        </button>
        <span class="ocean-sim-divider"></span>
        <button class="ocean-sim-icon-button" id="ocean-sim-motion" aria-label="Pause motion" aria-pressed="false" title="Pause motion (Space)">
          <svg id="ocean-sim-pause-icon" viewBox="0 0 20 20" fill="none"><path d="M7 5v10M13 5v10" stroke="currentColor" stroke-width="1.8"/></svg>
        </button>
      </nav>
    `;
    document.body.appendChild(this.container);

    this.restoreButton = document.createElement('button');
    this.restoreButton.id = 'ocean-sim-restore';
    this.restoreButton.className = 'ocean-sim-icon-button';
    this.restoreButton.title = 'Show interface (H)';
    this.restoreButton.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" stroke="currentColor" stroke-width="1.3"/><circle cx="10" cy="10" r="2.3" stroke="currentColor" stroke-width="1.3"/></svg>`;
    document.body.appendChild(this.restoreButton);

    // Bind weather buttons
    const wButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-weather]');
    wButtons.forEach((btn) => {
      const w = btn.dataset.weather as WeatherPreset;
      this.weatherButtons.set(w, btn);
      btn.addEventListener('click', () => {
        this.setWeatherUI(w);
        this.callbacks.onWeatherChange(w);
      });
    });

    // Bind view buttons
    const vButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-view]');
    vButtons.forEach((btn) => {
      const v = btn.dataset.view as CameraViewPreset;
      this.viewButtons.set(v, btn);
      btn.addEventListener('click', () => {
        this.setViewUI(v);
        this.callbacks.onViewChange(v);
      });
    });

    // Bind motion button
    this.motionButton = this.container.querySelector('#ocean-sim-motion') as HTMLButtonElement;
    if (this.motionButton) {
      this.motionButton.addEventListener('click', () => {
        const isPaused = this.callbacks.onToggleMotion();
        this.setMotionUI(isPaused);
      });
    }

    // Bind Hide/Restore buttons
    this.hideButton = this.container.querySelector('#ocean-sim-hide-ui') as HTMLButtonElement;
    if (this.hideButton) {
      this.hideButton.addEventListener('click', () => this.toggleUI());
    }
    this.restoreButton.addEventListener('click', () => this.toggleUI());

    // Bind Fullscreen
    const fsButton = this.container.querySelector('#ocean-sim-fullscreen') as HTMLButtonElement;
    if (fsButton) {
      fsButton.addEventListener('click', async () => {
        try {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
          } else {
            await document.documentElement.requestFullscreen();
          }
        } catch (e) {
          console.warn('Fullscreen unavailable', e);
        }
      });
    }
  }

  setWeatherUI(weather: WeatherPreset) {
    this.weatherButtons.forEach((btn, key) => {
      btn.setAttribute('aria-pressed', String(key === weather));
    });
  }

  setViewUI(view: CameraViewPreset) {
    this.viewButtons.forEach((btn, key) => {
      btn.setAttribute('aria-pressed', String(key === view));
    });
  }

  setMotionUI(paused: boolean) {
    if (!this.motionButton) return;
    this.motionButton.setAttribute('aria-pressed', String(paused));
    const icon = document.getElementById('ocean-sim-pause-icon');
    if (icon) {
      icon.innerHTML = paused
        ? '<path d="m7 4 8 6-8 6V4Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>'
        : '<path d="M7 5v10M13 5v10" stroke="currentColor" stroke-width="1.8"/>';
    }
  }

  toggleUI() {
    this.isHidden = !this.isHidden;
    if (this.container) {
      this.container.classList.toggle('is-hidden', this.isHidden);
    }
    document.body.classList.toggle('ocean-sim-ui-hidden', this.isHidden);
  }

  private setupKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName)) {
        return;
      }
      if (event.code === 'Space' && (event.target as HTMLElement)?.tagName !== 'BUTTON') {
        event.preventDefault();
        const isPaused = this.callbacks.onToggleMotion();
        this.setMotionUI(isPaused);
      }
      if (event.key.toLowerCase() === 'h') this.toggleUI();
      if (event.key.toLowerCase() === 'r') {
        this.setViewUI('aerial');
        this.callbacks.onResetView();
      }
      if (event.key === '1') {
        this.setWeatherUI('calm');
        this.callbacks.onWeatherChange('calm');
      }
      if (event.key === '2') {
        this.setWeatherUI('breeze');
        this.callbacks.onWeatherChange('breeze');
      }
      if (event.key === '3') {
        this.setWeatherUI('golden');
        this.callbacks.onWeatherChange('golden');
      }
      if (event.key === '4') {
        this.setWeatherUI('storm');
        this.callbacks.onWeatherChange('storm');
      }
      if (event.key === 'Escape' && this.isHidden) {
        this.toggleUI();
      }
    });
  }

  setVisible(visible: boolean) {
    if (this.container) {
      this.container.style.display = visible ? 'block' : 'none';
    }
    if (this.restoreButton) {
      this.restoreButton.style.display = visible && this.isHidden ? 'grid' : 'none';
    }
  }
}
