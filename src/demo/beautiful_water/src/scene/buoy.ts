import {
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3
} from 'three';
import { seabedHeight } from './environment';
import { sampleOceanSurface } from './waves';

function createRadialTexture({ shadow = false } = {}): CanvasTexture {
  const size = 256;
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, size, size);

    if (shadow) {
      const gradient = context.createRadialGradient(128, 128, 4, 128, 128, 118);
      gradient.addColorStop(0, 'rgba(0,12,18,0.32)');
      gradient.addColorStop(0.45, 'rgba(0,12,18,0.20)');
      gradient.addColorStop(1, 'rgba(0,12,18,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
    } else {
      context.strokeStyle = 'rgba(176,245,235,0.30)';
      for (const [radius, width, alpha] of [[36, 8, 0.34], [70, 5, 0.20], [108, 3, 0.10]]) {
        context.globalAlpha = alpha;
        context.lineWidth = width;
        context.beginPath();
        context.ellipse(128, 128, radius, radius * 0.76, 0, 0, Math.PI * 2);
        context.stroke();
      }
      context.globalAlpha = 1;
    }
  }

  const texture = new CanvasTexture(textureCanvas);
  texture.name = shadow ? 'Buoy surface shadow' : 'Buoy wake rings';
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function createWake(scene: Scene) {
  const uniforms = { uTime: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      varying vec2 vUv;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      void main() {
        vec2 centered = (vUv - 0.5) * vec2(1.0, 1.32);
        float radius = length(centered) * 2.0;
        float angleNoise = hash21(vec2(floor(atan(centered.y, centered.x) * 16.0), 2.0));
        float outward = fract(radius * 2.5 - uTime * 0.22);
        float ripple = 1.0 - smoothstep(0.0, 0.12, abs(outward - 0.16));
        float contact = (1.0 - smoothstep(0.17, 0.30, radius)) * 0.52;
        float edgeFade = 1.0 - smoothstep(0.28, 1.0, radius);
        float alpha = (ripple * 0.14 + contact) * edgeFade * (0.68 + angleNoise * 0.32);

        gl_FragColor = vec4(0.66, 0.94, 0.90, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const geometry = new PlaneGeometry(3.2, 3.2, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 7;
  scene.add(mesh);
  return { mesh, uniforms };
}

function createSurfaceShadow(scene: Scene) {
  const uniforms = { uTime: { value: 0 } };
  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      varying vec2 vUv;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float edgeNoise = (hash21(floor((p + 1.0) * 12.0) + floor(uTime * 0.25)) - 0.5) * 0.045;
        float distanceFromCenter = length(p * vec2(0.82, 1.08));
        float softEdge = 1.0 - smoothstep(0.08, 1.0 + edgeNoise, distanceFromCenter);
        float core = 1.0 - smoothstep(0.0, 0.72, distanceFromCenter);
        float alpha = softEdge * (0.13 + core * 0.17);

        gl_FragColor = vec4(0.003, 0.020, 0.026, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
  const geometry = new PlaneGeometry(2.8, 1.35);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 6;
  scene.add(mesh);
  return { mesh, uniforms };
}

export interface BuoyController {
  mesh: Group;
  captureHiddenObjects: Object3D[];
  underwaterObjects: Object3D[];
  update(time: number, underwaterMix: number): void;
}

export function createBuoy(scene: Scene, sunDirection: Vector3): BuoyController {
  const buoy = new Group();
  const buoyBody = new Group();
  buoy.add(buoyBody);
  scene.add(buoy);

  const buoyUniforms = {
    uTime: { value: 0 },
    uUnderwater: { value: 0 },
    uSunDirection: { value: sunDirection.clone() },
  };

  const applyBeerLambertFog = (mat: MeshStandardMaterial, cacheKey: string) => {
    mat.customProgramCacheKey = () => cacheKey;
    mat.onBeforeCompile = (shader: any) => {
      shader.uniforms.uTime = buoyUniforms.uTime;
      shader.uniforms.uUnderwater = buoyUniforms.uUnderwater;
      shader.uniforms.uSunDirection = buoyUniforms.uSunDirection;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCustomWorldPosition;
        varying vec3 vCustomWorldNormal;`
      ).replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vCustomWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vCustomWorldNormal = normalize((modelMatrix * instanceMatrix * vec4(objectNormal, 0.0)).xyz);
        #else
          vCustomWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vCustomWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
        #endif`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCustomWorldPosition;
        varying vec3 vCustomWorldNormal;
        uniform float uTime;
        uniform float uUnderwater;
        uniform vec3 uSunDirection;

        float buoyHash(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        float buoyValueNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(buoyHash(i + vec2(0.0, 0.0)), buoyHash(i + vec2(1.0, 0.0)), u.x),
            mix(buoyHash(i + vec2(0.0, 1.0)), buoyHash(i + vec2(1.0, 1.0)), u.x),
            u.y
          );
        }`
      ).replace(
        '#include <fog_fragment>',
        `#ifdef USE_FOG
          // Snell's Law refraction and caustic projection (threejs_water_shark)
          const float IOR_AIR = 1.0;
          const float IOR_WATER = 1.333;
          const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);
          vec3 refractedLight = -refract(-normalize(uSunDirection), vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
          vec2 causticCoord = (vCustomWorldPosition.xz - vCustomWorldPosition.y * (refractedLight.xz / max(refractedLight.y, 0.01)));

          float cA = buoyValueNoise(
            causticCoord * 0.82 + vec2(
              sin(causticCoord.y * 0.42 + uTime * 0.45) * 0.72,
              cos(causticCoord.x * 0.38 - uTime * 0.40) * 0.72
            ) + vec2(uTime * 0.08, -uTime * 0.06)
          );
          float cB = buoyValueNoise(
            causticCoord * 1.65 + vec2(-13.4, 8.2) + vec2(-uTime * 0.10, uTime * 0.08)
          );
          float caustic = pow(cA, 1.55) * mix(0.18, 1.0, cB);
          float causticBreak = 0.22 + smoothstep(0.43, 0.73, buoyValueNoise(
            causticCoord * 0.63 + vec2(uTime * 0.024, -uTime * 0.019)
          )) * 0.78;
          caustic *= causticBreak;

          float diffuseCaustic = max(0.0, dot(refractedLight, normalize(vCustomWorldNormal)));
          float depthFade = clamp(1.0 - (-vCustomWorldPosition.y * 0.06), 0.35, 1.0);
          vec3 causticColor = underwaterColor * (caustic * 1.85) * (0.35 + diffuseCaustic * 0.65) * depthFade;
          outgoingLight += causticColor * (0.45 + outgoingLight * 0.75);

          float distanceToCamera = length(cameraPosition - vCustomWorldPosition);
          vec3 viewDirection = normalize(vCustomWorldPosition - cameraPosition);
          float sunScatter = max(dot(viewDirection, uSunDirection), 0.0);

          vec3 waterHaze = mix(
            vec3(0.008, 0.12, 0.15),
            vec3(0.04, 0.28, 0.32),
            pow(sunScatter, 3.0) * 0.50 + 0.15
          );

          vec3 extinction = exp(-distanceToCamera * vec3(0.16, 0.08, 0.055));
          float depthBelowSurface = max(0.0, -vCustomWorldPosition.y);
          vec3 depthExtinction = exp(-depthBelowSurface * vec3(0.035, 0.012, 0.006));

          vec3 underwaterShaded = outgoingLight * depthExtinction * extinction * (underwaterColor * 1.15) + waterHaze * (vec3(1.0) - extinction);
          outgoingLight = mix(outgoingLight, underwaterShaded, uUnderwater);
        #endif`
      );
    };
    mat.needsUpdate = true;
  };

  const buoyRed = new MeshStandardMaterial({
    color: 0xff4d25,
    roughness: 0.28,
    metalness: 0.10,
  });
  const buoyRedDark = new MeshStandardMaterial({
    color: 0xd93419,
    roughness: 0.34,
    metalness: 0.14,
  });
  const buoyWhite = new MeshStandardMaterial({
    color: 0xf4eee2,
    roughness: 0.46,
    metalness: 0.02,
  });
  const buoyBlack = new MeshStandardMaterial({
    color: 0x12191c,
    roughness: 0.36,
    metalness: 0.58,
  });
  const lensMaterial = new MeshStandardMaterial({
    color: 0xffd48a,
    emissive: 0xff7f24,
    emissiveIntensity: 1.7,
    roughness: 0.16,
    metalness: 0.08,
  });

  applyBeerLambertFog(buoyRed, 'buoy_red_fog');
  applyBeerLambertFog(buoyRedDark, 'buoy_red_dark_fog');
  applyBeerLambertFog(buoyWhite, 'buoy_white_fog');
  applyBeerLambertFog(buoyBlack, 'buoy_black_fog');
  applyBeerLambertFog(lensMaterial, 'buoy_lens_fog');

  function addPart(geometry: any, material: any, positionY: number, parent = buoyBody) {
    const part = new Mesh(geometry, material);
    part.position.y = positionY;
    part.castShadow = true;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  }

  addPart(new CylinderGeometry(0.48, 0.58, 0.55, 48), buoyRedDark, 0.02);
  addPart(new CylinderGeometry(0.46, 0.49, 0.46, 48), buoyRed, 0.49);
  addPart(new CylinderGeometry(0.468, 0.49, 0.16, 48), buoyWhite, 0.52);

  const collar = addPart(new TorusGeometry(0.54, 0.095, 18, 64), buoyBlack, -0.17);
  collar.rotation.x = Math.PI / 2;

  addPart(new ConeGeometry(0.455, 0.52, 48), buoyRed, 0.98);
  addPart(new CylinderGeometry(0.055, 0.072, 0.92, 20), buoyBlack, 1.61);
  addPart(new CylinderGeometry(0.18, 0.14, 0.075, 24), buoyBlack, 2.04);
  addPart(new CylinderGeometry(0.12, 0.12, 0.19, 24), lensMaterial, 2.17);
  addPart(new ConeGeometry(0.18, 0.13, 24), buoyBlack, 2.33);

  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2;
    const rail = addPart(
      new CylinderGeometry(0.012, 0.012, 0.30, 8),
      buoyBlack,
      2.17,
    );
    rail.position.x = Math.cos(angle) * 0.145;
    rail.position.z = Math.sin(angle) * 0.145;
  }

  const topRing = addPart(new TorusGeometry(0.11, 0.016, 8, 32), buoyBlack, 2.43);
  topRing.rotation.y = Math.PI / 2;

  const anchorFloor = seabedHeight(0, 0);
  const mooringAnchorMaterial = new MeshStandardMaterial({ color: 0x2a494d, roughness: 0.88, metalness: 0.02 });
  applyBeerLambertFog(mooringAnchorMaterial, 'buoy_anchor_fog');
  const mooringAnchor = new Mesh(
    new DodecahedronGeometry(0.45, 1),
    mooringAnchorMaterial,
  );
  mooringAnchor.position.set(0, anchorFloor + 0.20, 0);
  mooringAnchor.scale.set(1.05, 0.55, 0.88);
  mooringAnchor.castShadow = true;
  mooringAnchor.receiveShadow = true;
  scene.add(mooringAnchor);

  const mooringLineMaterial = new MeshStandardMaterial({ color: 0x22363a, roughness: 0.68, metalness: 0.34 });
  applyBeerLambertFog(mooringLineMaterial, 'buoy_line_fog');
  const mooringLine = new Mesh(
    new CylinderGeometry(0.018, 0.026, 1, 8),
    mooringLineMaterial,
  );
  mooringLine.castShadow = true;
  scene.add(mooringLine);

  const wake = createWake(scene);
  const shadow = createSurfaceShadow(scene);
  const up = new Vector3(0, 1, 0);
  const targetBuoyQuaternion = new Quaternion();
  const targetWakeQuaternion = new Quaternion();
  const targetShadowQuaternion = new Quaternion();
  const shadowYawQuaternion = new Quaternion().setFromAxisAngle(
    up,
    Math.atan2(sunDirection.z, -sunDirection.x),
  );
  const buoyPosition = new Vector2(0, 0);
  const BUOY_WATERLINE_OFFSET = 0.15;
  const initialSurface = sampleOceanSurface(buoyPosition.x, buoyPosition.y, 0);
  buoy.position.set(buoyPosition.x, initialSurface.height - BUOY_WATERLINE_OFFSET, buoyPosition.y);
  wake.mesh.position.set(buoyPosition.x, initialSurface.height + 0.008, buoyPosition.y);

  return {
    mesh: buoy,
    captureHiddenObjects: [wake.mesh, shadow.mesh],
    underwaterObjects: [mooringAnchor, mooringLine],
    update(time: number, underwaterMix: number) {
      buoyUniforms.uTime.value = time;
      buoyUniforms.uUnderwater.value = underwaterMix;
      wake.uniforms.uTime.value = time;
      shadow.uniforms.uTime.value = time;

      const surface = sampleOceanSurface(buoyPosition.x, buoyPosition.y, time);
      const targetHeight = surface.height - BUOY_WATERLINE_OFFSET;
      buoy.position.y = MathUtils.lerp(buoy.position.y, targetHeight, 0.18);
      targetBuoyQuaternion.setFromUnitVectors(up, new Vector3(surface.normal.x, surface.normal.y, surface.normal.z));
      buoy.quaternion.slerp(targetBuoyQuaternion, 0.12);
      buoyBody.rotation.y = Math.sin(time * 0.21) * 0.055;

      wake.mesh.position.set(buoyPosition.x, surface.height + 0.008, buoyPosition.y);
      targetWakeQuaternion.setFromUnitVectors(up, new Vector3(surface.normal.x, surface.normal.y, surface.normal.z));
      wake.mesh.quaternion.slerp(targetWakeQuaternion, 0.14);

      const shadowX = buoyPosition.x - sunDirection.x * 1.25;
      const shadowZ = buoyPosition.y - sunDirection.z * 1.25;
      const shadowSurface = sampleOceanSurface(shadowX, shadowZ, time);
      shadow.mesh.position.set(shadowX, shadowSurface.height + 0.012, shadowZ);
      targetShadowQuaternion
        .setFromUnitVectors(up, new Vector3(shadowSurface.normal.x, shadowSurface.normal.y, shadowSurface.normal.z))
        .multiply(shadowYawQuaternion);
      shadow.mesh.quaternion.slerp(targetShadowQuaternion, 0.14);

      const lineTop = buoy.position.y - 0.18;
      const lineBottom = anchorFloor + 0.34;
      const lineHeight = Math.max(0.2, lineTop - lineBottom);
      mooringLine.position.set(0, lineBottom + lineHeight * 0.5, 0);
      mooringLine.scale.set(1, lineHeight, 1);

      wake.mesh.visible = underwaterMix < 0.72;
      shadow.mesh.visible = underwaterMix < 0.72;
    },
  };
}
