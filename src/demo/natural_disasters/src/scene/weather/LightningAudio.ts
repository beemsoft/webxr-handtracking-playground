import * as THREE from 'three';
import { ResonanceAudio, Source } from 'resonance-audio';

export interface ThunderStrikeOptions {
  position: THREE.Vector3;
  intensity?: number;
  strokes?: { at: number; amp: number }[];
  isDistantAmbient?: boolean;
}

interface PendingThunder {
  sourceNode: AudioBufferSourceNode;
  hpfNode: BiquadFilterNode;
  lpfNode: BiquadFilterNode;
  gainNode: GainNode;
  resonanceSource?: Source;
  pannerNode?: PannerNode;
  triggerTime: number;
  position: THREE.Vector3;
  duration: number;
}

/**
 * Spatial Lightning & Thunder Audio System.
 *
 * Uses ElevenLabs audio recordings:
 * 1. "ElevenLabs_Thunderous_clash_of_lightning_strike_echoing_across_a_stormy_night.mp3" for close/prominent strikes.
 * 2. "ElevenLabs_Distant_lightning_strike_piercing_through_thick_clouds,_followed_by_a_soft_rumble.mp3" for distant ambient flashes.
 *
 * Includes:
 * - Physics-based propagation delay (~343 m/s)
 * - 3D Ambisonic spatial positioning (Resonance Audio)
 * - Distance air absorption low-pass filtering
 * - 65Hz high-pass filter & master compressor to prevent Quest 3S / VR speaker distortion
 * - Built-in fallback sound synthesizer for instant zero-latency playback
 */
export class LightningAudioSystem {
  private _context: AudioContext | null = null;
  private _audioScene: ResonanceAudio | null = null;
  private _masterGain: GainNode | null = null;
  private _compressorNode: DynamicsCompressorNode | null = null;
  private _activeSources: PendingThunder[] = [];
  private _speedOfSound = 343.0; // meters per second
  private _maxPendingSources = 12;
  private _busyUntilTime = 0;

  private _thunderousClashBuffer: AudioBuffer | null = null;
  private _distantStrikeBuffer: AudioBuffer | null = null;
  private _fallbackClashBuffer: AudioBuffer | null = null;
  private _fallbackDistantBuffer: AudioBuffer | null = null;
  private _loadingPromise: Promise<void> | null = null;

  constructor() {}

  /**
   * Initialize audio context and load ElevenLabs sound effects.
   */
  init(sharedContext?: AudioContext) {
    try {
      this._context = sharedContext || new (window.AudioContext || (window as any).webkitAudioContext)();

      // Dynamics compressor to protect Quest 3S and mobile headset speakers from distortion
      this._compressorNode = this._context.createDynamicsCompressor();
      this._compressorNode.threshold.setValueAtTime(-12, this._context.currentTime);
      this._compressorNode.knee.setValueAtTime(8, this._context.currentTime);
      this._compressorNode.ratio.setValueAtTime(4, this._context.currentTime);
      this._compressorNode.attack.setValueAtTime(0.003, this._context.currentTime);
      this._compressorNode.release.setValueAtTime(0.2, this._context.currentTime);
      this._compressorNode.connect(this._context.destination);

      this._masterGain = this._context.createGain();
      this._masterGain.gain.setValueAtTime(0.85, this._context.currentTime);
      this._masterGain.connect(this._compressorNode);

      // Initialize 3D Ambisonic acoustic scene (open-air outdoor acoustics)
      this._audioScene = new ResonanceAudio(this._context, {
        ambisonicOrder: 3,
      });

      // Disable shoebox room reflections in open-air environment to avoid Web Audio DelayNode range warnings
      const sceneAny = this._audioScene as any;
      if (sceneAny._room) {
        sceneAny._room.setListenerPosition = () => {};
        if (sceneAny._room._early) {
          sceneAny._room._early.setListenerPosition = () => {};
        }
        if (sceneAny._room._late) {
          sceneAny._room._late.setListenerPosition = () => {};
        }
      }

      this._audioScene.output.connect(this._masterGain);

      // Synthesize fallback procedural buffers immediately so sounds are never silent
      this._generateFallbackBuffers();

      // Load sound effects asynchronously
      this._loadAudioSamples();
    } catch (err) {
      console.warn('LightningAudioSystem initialization error:', err);
    }
  }

  getContext(): AudioContext | null {
    return this._context;
  }

  /**
   * Returns whether a lightning sound effect is currently playing or scheduled to play.
   */
  isPlaying(): boolean {
    if (!this._context) return false;
    return this._context.currentTime < this._busyUntilTime;
  }

  resume() {
    if (this._context && this._context.state === 'suspended') {
      this._context.resume().catch(() => {});
    }
  }

  /**
   * Generates instant fallback audio buffers in case network loading is in progress or unavailable.
   */
  private _generateFallbackBuffers() {
    if (!this._context) return;
    try {
      const sampleRate = this._context.sampleRate || 44100;

      // 1. Close clash fallback (3.2 seconds)
      const clashSamples = Math.floor(sampleRate * 3.2);
      const clashBuf = this._context.createBuffer(1, clashSamples, sampleRate);
      const cData = clashBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < clashSamples; i++) {
        const t = i / sampleRate;
        const white = Math.random() * 2.0 - 1.0;
        b0 = 0.99 * b0 + white * 0.08;
        b1 = 0.95 * b1 + white * 0.18;
        b2 = 0.85 * b2 + white * 0.35;
        const env = Math.exp(-t * 3.2) * Math.sin(Math.PI * Math.min(1.0, t * 60.0));
        const sub = Math.sin(2.0 * Math.PI * Math.max(55, 120 * Math.exp(-t * 8.0)) * t);
        const clap = (sub * 0.5 + b0 * 0.8 + b1 * 0.6) * env;
        cData[i] = Math.tanh(clap * 0.85);
      }
      this._fallbackClashBuffer = clashBuf;

      // 2. Distant rumble fallback (4.5 seconds)
      const distSamples = Math.floor(sampleRate * 4.5);
      const distBuf = this._context.createBuffer(1, distSamples, sampleRate);
      const dData = distBuf.getChannelData(0);
      let db0 = 0, db1 = 0;
      for (let i = 0; i < distSamples; i++) {
        const t = i / sampleRate;
        const white = Math.random() * 2.0 - 1.0;
        db0 = 0.995 * db0 + white * 0.05;
        db1 = 0.98 * db1 + white * 0.12;
        const env = Math.pow(Math.min(1.0, t * 1.5), 0.5) * Math.exp(-t * 0.7);
        const rumble = (db0 * 1.1 + db1 * 0.6) * env * (0.8 + 0.2 * Math.sin(2.0 * Math.PI * 3.5 * t));
        dData[i] = Math.tanh(rumble * 0.75);
      }
      this._fallbackDistantBuffer = distBuf;
    } catch (_) {}
  }

  /**
   * Loads both ElevenLabs lightning MP3 files with multiple fallback URL paths.
   */
  private _loadAudioSamples(): Promise<void> {
    if (this._loadingPromise) return this._loadingPromise;
    if (!this._context) return Promise.resolve();

    const loadBuffer = async (filename: string): Promise<AudioBuffer | null> => {
      const candidates = [
        `../../../vr/sound/${encodeURIComponent(filename)}`,
        `/vr/sound/${encodeURIComponent(filename)}`,
        `vr/sound/${encodeURIComponent(filename)}`,
        `./vr/sound/${encodeURIComponent(filename)}`,
        `../../../vr/sound/${filename}`,
        `/vr/sound/${filename}`,
        `vr/sound/${filename}`,
        `./vr/sound/${filename}`,
      ];

      for (const url of candidates) {
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const arr = await resp.arrayBuffer();
            if (this._context) {
              return await new Promise<AudioBuffer>((resolve, reject) => {
                this._context!.decodeAudioData(arr.slice(0), resolve, reject);
              });
            }
          }
        } catch (_) {
          // try next candidate
        }
      }
      return null;
    };

    const clashFile = 'ElevenLabs_Thunderous_clash_of_lightning_strike_echoing_across_a_stormy_night.mp3';
    const distantFile = 'ElevenLabs_Distant_lightning_strike_piercing_through_thick_clouds,_followed_by_a_soft_rumble.mp3';

    this._loadingPromise = Promise.all([
      loadBuffer(clashFile).then((buf) => {
        if (buf) this._thunderousClashBuffer = buf;
      }),
      loadBuffer(distantFile).then((buf) => {
        if (buf) this._distantStrikeBuffer = buf;
      }),
    ]).then(() => {});

    return this._loadingPromise;
  }

  /**
   * Updates listener 3D orientation & position from camera world matrix.
   */
  updateListener(cameraMatrixWorld: THREE.Matrix4) {
    if (this._audioScene && cameraMatrixWorld) {
      this._audioScene.setListenerFromMatrix(cameraMatrixWorld as any);
    }

    // Clean up finished audio sources
    if (this._context) {
      const now = this._context.currentTime;
      for (let i = this._activeSources.length - 1; i >= 0; i--) {
        const item = this._activeSources[i];
        if (now > item.triggerTime + item.duration + 0.5) {
          try {
            item.sourceNode.disconnect();
            item.hpfNode.disconnect();
            item.lpfNode.disconnect();
            item.gainNode.disconnect();
          } catch (_) {}
          this._activeSources.splice(i, 1);
        }
      }
    }
  }

  /**
   * Triggers lightning thunder audio based on bolt 3D position and listener distance.
   */
  triggerLightning(options: ThunderStrikeOptions, listenerPosition: THREE.Vector3) {
    if (!this._context) return;
    this.resume();

    // Prevent overloading VR sound system: only play one lightning effect at a time,
    // waiting until it has finished before playing the next effect.
    if (this.isPlaying()) return;

    const strikePos = options.position;
    const distance = Math.max(15, strikePos.distanceTo(listenerPosition));
    const intensity = Math.min(1.5, Math.max(0.2, options.intensity ?? 0.9));

    // Physics-based propagation delay (~343 m/s)
    const propagationDelay = Math.min(6.5, distance / this._speedOfSound);
    const triggerTime = this._context.currentTime + propagationDelay;

    // Select appropriate sample based on distance & ambience
    const isDistant = options.isDistantAmbient || distance > 1100;
    let chosenBuffer = isDistant ? this._distantStrikeBuffer : this._thunderousClashBuffer;
    if (!chosenBuffer) {
      chosenBuffer = this._thunderousClashBuffer || this._distantStrikeBuffer;
    }
    // Fallback to generated procedural buffers if MP3s are still loading
    if (!chosenBuffer) {
      chosenBuffer = isDistant ? this._fallbackDistantBuffer : this._fallbackClashBuffer;
    }
    if (!chosenBuffer) {
      chosenBuffer = this._fallbackClashBuffer || this._fallbackDistantBuffer;
    }
    if (!chosenBuffer) return;

    // Atmospheric air absorption low-pass filter
    const cutoffFreq = Math.max(260, Math.min(8500, 8500 / (1.0 + Math.pow(distance / 500, 1.1))));

    // Smooth distance attenuation gain tailored for ocean balance
    const distanceGain = Math.max(0.2, Math.min(1.0, 1.0 / (1.0 + Math.pow(distance / 750, 0.75))));
    const finalVolume = intensity * distanceGain * (options.isDistantAmbient ? 0.6 : 0.95);

    try {
      const sourceNode = this._context.createBufferSource();
      sourceNode.buffer = chosenBuffer;

      // Subtle playback rate randomization for organic variety
      const playbackRate = 0.95 + Math.random() * 0.1;
      sourceNode.playbackRate.value = playbackRate;

      const duration = chosenBuffer.duration / playbackRate;
      this._busyUntilTime = triggerTime + duration;

      // High-pass filter at 65Hz to eliminate muddy sub-bass rumble that overloads Quest 3S speakers
      const hpfNode = this._context.createBiquadFilter();
      hpfNode.type = 'highpass';
      hpfNode.frequency.setValueAtTime(65, triggerTime);
      hpfNode.Q.setValueAtTime(0.7, triggerTime);

      // Low-pass filter for air absorption
      const lpfNode = this._context.createBiquadFilter();
      lpfNode.type = 'lowpass';
      lpfNode.frequency.setValueAtTime(cutoffFreq, triggerTime);
      lpfNode.Q.setValueAtTime(0.7, triggerTime);

      const gainNode = this._context.createGain();
      gainNode.gain.setValueAtTime(0.001, triggerTime);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.001, finalVolume), triggerTime + 0.03);

      // Connect node graph: Source -> HPF -> LPF -> Gain -> Spatializer
      sourceNode.connect(hpfNode);
      hpfNode.connect(lpfNode);
      lpfNode.connect(gainNode);

      let resonanceSource: Source | undefined;
      let pannerNode: PannerNode | undefined;

      if (this._audioScene) {
        resonanceSource = this._audioScene.createSource();
        resonanceSource.setPosition(strikePos.x, strikePos.y, strikePos.z);
        resonanceSource.setRolloff('none');
        resonanceSource.setMaxDistance(50000);
        resonanceSource.setMinDistance(5);
        gainNode.connect(resonanceSource.input);
      } else {
        // Fallback Web Audio PannerNode
        pannerNode = this._context.createPanner();
        pannerNode.panningModel = 'HRTF';
        pannerNode.distanceModel = 'inverse';
        pannerNode.refDistance = 100;
        pannerNode.maxDistance = 50000;
        pannerNode.rolloffFactor = 0.5;
        pannerNode.positionX.setValueAtTime(strikePos.x, triggerTime);
        pannerNode.positionY.setValueAtTime(strikePos.y, triggerTime);
        pannerNode.positionZ.setValueAtTime(strikePos.z, triggerTime);
        gainNode.connect(pannerNode);
        if (this._masterGain) {
          pannerNode.connect(this._masterGain);
        }
      }

      sourceNode.onended = () => {
        try {
          sourceNode.disconnect();
          hpfNode.disconnect();
          lpfNode.disconnect();
          gainNode.disconnect();
        } catch (_) {}
      };

      // Schedule playback
      sourceNode.start(triggerTime);

      // Track active sources
      if (this._activeSources.length >= this._maxPendingSources) {
        const oldest = this._activeSources.shift();
        if (oldest) {
          try { oldest.sourceNode.stop(); } catch (_) {}
        }
      }

      this._activeSources.push({
        sourceNode,
        hpfNode,
        lpfNode,
        gainNode,
        resonanceSource,
        pannerNode,
        triggerTime,
        position: strikePos.clone(),
        duration,
      });
    } catch (err) {
      this._busyUntilTime = 0;
      console.warn('Failed to schedule thunder audio:', err);
    }
  }

  dispose() {
    this._busyUntilTime = 0;
    for (const item of this._activeSources) {
      try {
        item.sourceNode.stop();
        item.sourceNode.disconnect();
        item.hpfNode.disconnect();
        item.lpfNode.disconnect();
        item.gainNode.disconnect();
      } catch (_) {}
    }
    this._activeSources = [];
    this._thunderousClashBuffer = null;
    this._distantStrikeBuffer = null;
    this._fallbackClashBuffer = null;
    this._fallbackDistantBuffer = null;
  }
}
