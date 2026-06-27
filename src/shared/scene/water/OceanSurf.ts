import {
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Matrix4
} from 'three';

export class OceanSurf extends Mesh {
  constructor() {
    const material = new ShaderMaterial({
      name: 'OceanSurfMaterial',
      uniforms: {
        uTime: { value: 0 },
        uWaveSpeed: { value: 0.25 },
        uShallowColor: { value: new Color(0x45b1bf) },
        uDeepColor: { value: new Color(0x001221) },
        uDepthTexture: { value: null },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 100 },
        uFoamColor: { value: new Color(0xffffff) },
        uFoamLimit: { value: 0.4 },
        uOpacity: { value: 0.8 },
        uSunDirection: { value: new Vector3(1, 1, 1).normalize() },
        uProjMatrix: { value: new Matrix4() },
        uViewMatrix: { value: new Matrix4() },
      },
      vertexShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        uniform float uTime;
        uniform float uWaveSpeed;

        // Gerstner Wave function
        vec3 gerstnerWave(vec4 wave, vec3 p, inout vec3 tangent, inout vec3 binormal) {
          float steepness = wave.z;
          float wavelength = wave.w;
          float k = 2.0 * 3.14159 / wavelength;
          float c = sqrt(9.8 / k);
          vec2 d = normalize(wave.xy);
          float f = k * (dot(d, p.xz) - c * uTime * uWaveSpeed);
          float a = steepness / k;

          tangent += vec3(
            -d.x * d.x * (steepness * sin(f)),
            d.x * (steepness * cos(f)),
            -d.x * d.y * (steepness * sin(f))
          );
          binormal += vec3(
            -d.x * d.y * (steepness * sin(f)),
            d.y * (steepness * cos(f)),
            -d.y * d.y * (steepness * sin(f))
          );

          return vec3(
            d.x * (a * cos(f)),
            a * sin(f),
            d.y * (a * cos(f))
          );
        }

        void main() {
          vec3 p = position;
          vec3 tangent = vec3(1.0, 0.0, 0.0);
          vec3 binormal = vec3(0.0, 0.0, 1.0);

          p += gerstnerWave(vec4(0.7, 0.3, 0.18, 30.0), position, tangent, binormal);
          p += gerstnerWave(vec4(-0.6, 0.4, 0.14, 21.0), position, tangent, binormal);
          p += gerstnerWave(vec4(0.3, -0.8, 0.1, 14.0), position, tangent, binormal);
          p += gerstnerWave(vec4(0.8, 0.1, 0.06, 7.0), position, tangent, binormal);
          p += gerstnerWave(vec4(-0.2, -0.9, 0.04, 3.5), position, tangent, binormal);

          vNormal = normalize(cross(binormal, tangent));
          vec4 worldPos = modelMatrix * vec4(p, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        
        uniform sampler2D uDepthTexture;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uFoamColor;
        uniform float uFoamLimit;
        uniform float uOpacity;
        uniform vec3 uSunDirection;
        uniform float uTime;
        uniform mat4 uProjMatrix;
        uniform mat4 uViewMatrix;

        #include <packing>

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          vec2 shift = vec2(100.0);
          for (int i = 0; i < 4; ++i) {
            v += a * noise(p);
            p = p * 2.0 + shift;
            a *= 0.5;
          }
          return v;
        }

        // Sharper noise for foam
        float foamNoise(vec2 p) {
          float v = 0.0;
          float a = 0.5;
          vec2 shift = vec2(100.0);
          for (int i = 0; i < 3; ++i) {
            v += a * (1.0 - abs(noise(p) * 2.0 - 1.0));
            p = p * 2.0 + shift;
            a *= 0.5;
          }
          return v;
        }

        void main() {
          vec3 normal = normalize(vNormal);
          vec4 shadowScreenPos = uProjMatrix * uViewMatrix * vec4(vWorldPosition, 1.0);
          vec2 screenUv = shadowScreenPos.xy / shadowScreenPos.w * 0.5 + 0.5;
          
          float depthSample = texture2D(uDepthTexture, screenUv).x;
          
          // Convert both to linear view space depth for comparison
          float sceneViewZ = perspectiveDepthToViewZ(depthSample, uCameraNear, uCameraFar);
          
          // For surface depth, we must also use the viewZ relative to the shadow camera
          // otherwise the comparison is invalid if the eye camera has a different view transform
          vec4 shadowViewPos = uViewMatrix * vec4(vWorldPosition, 1.0);
          float surfaceViewZ = shadowViewPos.z;
          
          // In Three.js viewZ is negative, so we use subtraction in this order
          float diff = surfaceViewZ - sceneViewZ; 

          // Prevent water effects on parts of the island that are above water level
          if (diff < 0.01) {
             discard;
          }

          // Normal perturbation for ripples
          vec2 rippleUv = vWorldPosition.xz * 4.0 + uTime * 0.1;
          float ripple = fbm(rippleUv);
          normal = normalize(normal + vec3(ripple * 0.05, 0.0, ripple * 0.05));

          // Depth-based color (shallower = lighter turquoise, deeper = dark navy)
          float depthFactor = 1.0 - exp(-diff * 0.5);
          vec3 waterColor = mix(uShallowColor, uDeepColor, depthFactor);

          // Basic lighting
          float light = max(0.0, dot(normal, uSunDirection));
          vec3 color = waterColor * (0.5 + 0.5 * light);

          // Fresnel & Specular
          vec3 viewDir = normalize(cameraPosition - vWorldPosition);
          float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 5.0);
          
          vec3 reflectDir = reflect(-uSunDirection, normal);
          float spec = pow(max(0.0, dot(viewDir, reflectDir)), 128.0);
          
          color = mix(color, vec3(0.7, 0.85, 1.0), fresnel * 0.4); // Sky reflection approximation
          color += spec * 0.6;

          // Foam at intersections (Beach foam)
          float foam = 0.0;
          float swash = sin(uTime * 0.8) * 0.08;
          float currentFoamLimit = uFoamLimit + swash;
          
          if (diff < currentFoamLimit) {
            float n = foamNoise(vWorldPosition.xz * 12.0 + uTime * 0.2);
            foam = 1.0 - smoothstep(0.0, currentFoamLimit * (0.3 + 1.2 * n), diff);
            foam = smoothstep(0.2, 0.6, foam); // More contrasty foam
          }
          
          // Add some procedural foam on crests
          float crestFoam = smoothstep(0.4, 0.8, vWorldPosition.y);
          float n2 = foamNoise(vWorldPosition.xz * 3.0 - uTime * 0.1);
          crestFoam *= n2;
          foam = max(foam, crestFoam * 0.8);

          color = mix(color, uFoamColor, foam);

          // Fade out opacity at the very edge to avoid harsh intersections
          float edgeAlpha = smoothstep(0.0, 0.1, diff);

          gl_FragColor = vec4(color, uOpacity * edgeAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });

    const geometry = new PlaneGeometry(200, 200, 256, 256);
    geometry.rotateX(-Math.PI / 2);
    super(geometry, material);
  }

  update(time: number) {
    (this.material as ShaderMaterial).uniforms.uTime.value = time;
  }
}
