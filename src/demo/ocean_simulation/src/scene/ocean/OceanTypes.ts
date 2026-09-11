import * as THREE from 'three';

export interface WeatherProfile {
  gains: [number, number, number];
  storm: number;
  wind: number;
  clouds: number;
  golden: number;
  angle: number;
}

export type WeatherPreset = 'calm' | 'breeze' | 'golden' | 'storm';
export type CameraViewPreset = 'aerial' | 'waterline' | 'shallows' | 'explore';

export interface CoastalFieldResult {
  texture: THREE.DataTexture;
  data: Float32Array;
  resolution: number;
  direction: [number, number];
  c0: number;
}
