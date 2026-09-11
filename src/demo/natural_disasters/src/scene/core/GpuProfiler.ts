import * as THREE from 'three';

export interface ProfilerZone {
  name: string;
  pending: WebGLQuery[];
  ms: number;
  ema: number;
  cpuMs: number;
  _t0?: number;
}

export class GpuProfiler {
  renderer: THREE.WebGLRenderer;
  gl: WebGL2RenderingContext;
  ext: any;
  zones: Map<string, ProfilerZone>;
  enabled: boolean;
  cpuFallback: boolean;
  private _active: { z: ProfilerZone; q: WebGLQuery } | null;
  private _order: string[];

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.zones = new Map();
    this.enabled = false;
    this.cpuFallback = !this.ext;
    this._active = null;
    this._order = [];
  }

  private _zone(name: string): ProfilerZone {
    let z = this.zones.get(name);
    if (!z) {
      z = { name, pending: [], ms: 0, ema: 0, cpuMs: 0 };
      this.zones.set(name, z);
      this._order.push(name);
    }
    return z;
  }

  begin(name: string) {
    if (!this.enabled) return;
    const z = this._zone(name);
    if (this.cpuFallback) { z._t0 = performance.now(); return; }
    if (this._active) return;
    const gl = this.gl;
    const q = gl.createQuery();
    if (!q) return;
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this._active = { z, q };
  }

  end(name: string) {
    if (!this.enabled) return;
    const z = this._zone(name);
    if (this.cpuFallback) {
      this.gl.finish();
      z.cpuMs = performance.now() - (z._t0 || 0);
      z.ema = z.ema ? z.ema * 0.9 + z.cpuMs * 0.1 : z.cpuMs;
      return;
    }
    if (!this._active || this._active.z !== z) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    z.pending.push(this._active.q);
    this._active = null;
  }

  collect() {
    if (!this.enabled || this.cpuFallback) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    for (const z of this.zones.values()) {
      while (z.pending.length) {
        const q = z.pending[0];
        if (disjoint) { gl.deleteQuery(q); z.pending.shift(); continue; }
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        gl.deleteQuery(q);
        z.pending.shift();
        z.ms = ns / 1e6;
        z.ema = z.ema ? z.ema * 0.85 + z.ms * 0.15 : z.ms;
      }
      while (z.pending.length > 8) {
        const q = z.pending.shift();
        if (q) gl.deleteQuery(q);
      }
    }
  }

  report() {
    const out: { name: string; ms: number }[] = [];
    for (const name of this._order) {
      const z = this.zones.get(name);
      if (z) {
        out.push({ name, ms: +(z.ema || z.ms || z.cpuMs).toFixed(3) });
      }
    }
    out.sort((a, b) => b.ms - a.ms);
    return { mode: this.cpuFallback ? 'cpu-finish' : 'gpu-timer', zones: out };
  }

  reset() { for (const z of this.zones.values()) { z.ema = 0; z.ms = 0; } }
}
