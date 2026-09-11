import * as THREE from 'three';

export interface ISharedUniforms {
  uTime: { value: number };
  uDt: { value: number };
  uFrame: { value: number };
  uResolution: { value: THREE.Vector2 };
  uInvResolution: { value: THREE.Vector2 };
  uCamPos: { value: THREE.Vector3 };
  uPrevCamPos: { value: THREE.Vector3 };
  uViewProj: { value: THREE.Matrix4 };
  uPrevViewProj: { value: THREE.Matrix4 };
  uInvViewProj: { value: THREE.Matrix4 };
  uViewProjNJ: { value: THREE.Matrix4 };
  uPrevViewProjNJ: { value: THREE.Matrix4 };
  uInvViewProjNJ: { value: THREE.Matrix4 };
  uJitter: { value: THREE.Vector2 };
  uPrevJitter: { value: THREE.Vector2 };
  uNear: { value: number };
  uFar: { value: number };

  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Vector3 };
  uSunIntensity: { value: number };
  uMoonDir: { value: THREE.Vector3 };
  uAtmoTurbidity: { value: number };
  uAtmoMieG: { value: number };
  uAtmoGroundAlbedo: { value: THREE.Vector3 };
  uAmbientColor: { value: THREE.Vector3 };

  uWindDir: { value: THREE.Vector2 };
  uWindSpeed: { value: number };
  uGustiness: { value: number };
  uRain: { value: number };
  uFogDensity: { value: number };
  uSprayAmount: { value: number };
  uWhitecapCoverage: { value: number };
  uStormFactor: { value: number };
  uSeaLevel: { value: number };

  uLightning0: { value: THREE.Vector4 };
  uLightning1: { value: THREE.Vector4 };
  uLightningColor: { value: THREE.Vector3 };
  uAmbientFlash: { value: number };

  uVortex0: { value: THREE.Vector4 };
  uVortex1: { value: THREE.Vector4 };
  uVortex2: { value: THREE.Vector4 };
  uVortex3: { value: THREE.Vector4 };
  uSoliton0: { value: THREE.Vector4 };
  uSoliton0b: { value: THREE.Vector4 };
  uSoliton1: { value: THREE.Vector4 };
  uSoliton1b: { value: THREE.Vector4 };
  uRogue: { value: THREE.Vector4 };
  uRogueB: { value: THREE.Vector4 };
  uHurricane: { value: THREE.Vector4 };

  uFoamTex: { value: THREE.Texture | null };
  uRippleTex: { value: THREE.Texture | null };
  uCurlTex: { value: THREE.Texture | null };

  uEnvMap: { value: THREE.Texture | null };
  uEnvMaxLod: { value: number };
  uEnvWidth: { value: number };

  uExposure: { value: number };
  uEarthCurvature: { value: number };
  [key: string]: { value: any };
}

export const U: ISharedUniforms = {
  uTime: { value: 0 },
  uDt: { value: 1 / 60 },
  uFrame: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uInvResolution: { value: new THREE.Vector2(1, 1) },
  uCamPos: { value: new THREE.Vector3() },
  uPrevCamPos: { value: new THREE.Vector3() },
  uViewProj: { value: new THREE.Matrix4() },
  uPrevViewProj: { value: new THREE.Matrix4() },
  uInvViewProj: { value: new THREE.Matrix4() },
  uViewProjNJ: { value: new THREE.Matrix4() },
  uPrevViewProjNJ: { value: new THREE.Matrix4() },
  uInvViewProjNJ: { value: new THREE.Matrix4() },
  uJitter: { value: new THREE.Vector2() },
  uPrevJitter: { value: new THREE.Vector2() },
  uNear: { value: 0.1 },
  uFar: { value: 120000 },

  uSunDir: { value: new THREE.Vector3(0.3, 0.4, -0.86) },
  uSunColor: { value: new THREE.Vector3(1, 0.96, 0.9) },
  uSunIntensity: { value: 22.0 },
  uMoonDir: { value: new THREE.Vector3(-0.3, 0.5, 0.8) },
  uAtmoTurbidity: { value: 1.0 },
  uAtmoMieG: { value: 0.78 },
  uAtmoGroundAlbedo: { value: new THREE.Vector3(0.06, 0.09, 0.12) },
  uAmbientColor: { value: new THREE.Vector3(0.1, 0.2, 0.35) },

  uWindDir: { value: new THREE.Vector2(1, 0) },
  uWindSpeed: { value: 8.0 },
  uGustiness: { value: 0.3 },
  uRain: { value: 0.0 },
  uFogDensity: { value: 0.0 },
  uSprayAmount: { value: 0.0 },
  uWhitecapCoverage: { value: 0.0 },
  uStormFactor: { value: 0.0 },
  uSeaLevel: { value: 0.0 },

  uLightning0: { value: new THREE.Vector4(0, 0, 0, 0) },
  uLightning1: { value: new THREE.Vector4(0, 0, 0, 0) },
  uLightningColor: { value: new THREE.Vector3(0.75, 0.85, 1.0) },
  uAmbientFlash: { value: 0.0 },

  uVortex0: { value: new THREE.Vector4(0, 0, 0, 0) },
  uVortex1: { value: new THREE.Vector4(0, 0, 0, 0) },
  uVortex2: { value: new THREE.Vector4(0, 0, 0, 0) },
  uVortex3: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSoliton0: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSoliton0b: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSoliton1: { value: new THREE.Vector4(0, 0, 0, 0) },
  uSoliton1b: { value: new THREE.Vector4(0, 0, 0, 0) },
  uRogue: { value: new THREE.Vector4(0, 0, 0, 0) },
  uRogueB: { value: new THREE.Vector4(0, 0, 0, 0) },
  uHurricane: { value: new THREE.Vector4(0, 0, 0, 0) },

  uFoamTex: { value: null },
  uRippleTex: { value: null },
  uCurlTex: { value: null },

  uEnvMap: { value: null },
  uEnvMaxLod: { value: 6.0 },
  uEnvWidth: { value: 256 },

  uExposure: { value: 1.0 },
  uEarthCurvature: { value: 1.0 },
};

export function updateFrameUniforms(
  camera: THREE.PerspectiveCamera,
  projNoJitter: THREE.Matrix4,
  dt: number,
  time: number,
  frame: number
) {
  U.uTime.value = time;
  U.uDt.value = dt;
  U.uFrame.value = frame;
  U.uPrevViewProj.value.copy(U.uViewProj.value);
  U.uPrevViewProjNJ.value.copy(U.uViewProjNJ.value);
  U.uPrevCamPos.value.copy(U.uCamPos.value);

  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

  let effectiveProj = camera.projectionMatrix;
  if ((camera as any).isArrayCamera && (camera as any).cameras && (camera as any).cameras.length > 0) {
    const subCam = (camera as any).cameras[0];
    if (subCam.projectionMatrix) {
      effectiveProj = subCam.projectionMatrix;
    }
  }

  const effectiveProjNJ = projNoJitter || effectiveProj;

  U.uViewProj.value.multiplyMatrices(effectiveProj, camera.matrixWorldInverse);
  U.uInvViewProj.value.copy(U.uViewProj.value).invert();
  U.uViewProjNJ.value.multiplyMatrices(effectiveProjNJ, camera.matrixWorldInverse);
  U.uInvViewProjNJ.value.copy(U.uViewProjNJ.value).invert();
  U.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  U.uNear.value = camera.near || 0.1;
  U.uFar.value = camera.far || 100000;
}
