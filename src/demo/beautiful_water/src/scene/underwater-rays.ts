import {
  Camera,
  MathUtils,
  Mesh,
  NormalBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';

function smoothstep(minimum: number, maximum: number, value: number): number {
  const t = MathUtils.clamp((value - minimum) / (maximum - minimum), 0, 1);
  return t * t * (3 - 2 * t);
}

export interface UnderwaterRaysController {
  resize(width: number, height: number): void;
  update(time: number, underwaterMix: number, camera: Camera): void;
  render(renderer: WebGLRenderer): void;
}

export function createUnderwaterRays(sunDirection: Vector3): UnderwaterRaysController {
  const uniforms = {
    uTime: { value: 0 },
    uStrength: { value: 0 },
    uSunPosition: { value: new Vector2(0.5, 1.2) },
    uAspect: { value: 1 },
  };

  const material = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: NormalBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;

      uniform float uTime;
      uniform float uStrength;
      uniform vec2 uSunPosition;
      uniform float uAspect;
      varying vec2 vUv;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float valueNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0)), f.x),
          f.y
        );
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        mat2 turn = mat2(0.80, -0.60, 0.60, 0.80);
        for (int octave = 0; octave < 4; octave++) {
          value += valueNoise(p) * amplitude;
          p = turn * p * 2.03 + 7.1;
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec2 delta = vUv - uSunPosition;
        delta.x *= uAspect;
        float radius = length(delta);
        float angle = atan(delta.y, delta.x);

        float warp = fbm(vec2(angle * 6.5, radius * 1.8 - uTime * 0.012));
        float finePhase = angle * 57.0 + warp * 6.2;
        float broadPhase = angle * 23.0 - warp * 3.4;
        float fineRays = pow(0.5 + 0.5 * cos(finePhase), 10.0);
        float broadRays = pow(0.5 + 0.5 * cos(broadPhase), 7.0);
        float rayDensity = fineRays * 0.62 + broadRays * 0.38;

        float radialEnvelope = 1.0 - smoothstep(0.06, 1.75, radius);
        float originFade = smoothstep(0.035, 0.16, radius);
        float breakup = 0.42 + fbm(vec2(angle * 3.1, radius * 4.2 + uTime * 0.009)) * 0.58;
        float alpha = rayDensity * radialEnvelope * originFade * breakup;
        alpha *= uStrength * 0.095;

        vec3 color = mix(
          vec3(0.035, 0.24, 0.25),
          vec3(0.10, 0.47, 0.45),
          rayDensity
        );
        float dither = (hash21(gl_FragCoord.xy + uTime * 13.0) - 0.5) / 255.0;
        gl_FragColor = vec4(color + dither, alpha);
        #include <colorspace_fragment>
      }
    `,
  });

  const overlayScene = new Scene();
  const overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  overlayScene.add(quad);

  const eta = 1 / 1.333;
  const horizontal = new Vector2(sunDirection.x, sunDirection.z).multiplyScalar(eta);
  const refractedSun = new Vector3(
    horizontal.x,
    Math.sqrt(Math.max(1 - horizontal.lengthSq(), 0.001)),
    horizontal.y,
  ).normalize();
  const sunPoint = new Vector3();
  const cameraForward = new Vector3();

  return {
    resize(width: number, height: number) {
      uniforms.uAspect.value = width / Math.max(height, 1);
    },
    update(time: number, underwaterMix: number, camera: Camera) {
      camera.getWorldDirection(cameraForward);
      const facingSun = smoothstep(-0.08, 0.55, cameraForward.dot(refractedSun));
      sunPoint.copy(camera.position).addScaledVector(refractedSun, 60).project(camera);
      uniforms.uSunPosition.value.set(
        sunPoint.x * 0.5 + 0.5,
        sunPoint.y * 0.5 + 0.5,
      );
      uniforms.uTime.value = time;
      uniforms.uStrength.value = underwaterMix * facingSun;
    },
    render(renderer: WebGLRenderer) {
      if (uniforms.uStrength.value < 0.002) return;
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(overlayScene, overlayCamera);
      renderer.autoClear = autoClear;
    },
  };
}
