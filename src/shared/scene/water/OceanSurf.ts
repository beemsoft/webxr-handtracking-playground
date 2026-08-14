import {
  Color,
  DoubleSide,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  Vector4,
  Matrix4,
  PerspectiveCamera,
  OrthographicCamera
} from 'three';

export class OceanSurf extends Mesh {
  constructor() {
    const material = new ShaderMaterial({
      name: 'OceanSurfMaterial',
      uniforms: {
        uTime: { value: 0 },
        uWaveSpeed: { value: 0.25 },
        uShallowColor: { value: new Color(0x45b1bf).multiplyScalar(2.0) },
        uDeepColor: { value: new Color(0x001221).multiplyScalar(2.0) },
        uDepthTexture: { value: null },
        uInverseShadowMatrix: { value: new Matrix4() },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 500 },
        uFoamColor: { value: new Color(0xffffff) },
        uFoamLimit: { value: 0.4 },
        uOpacity: { value: 0.6 },
        uSunDirection: { value: new Vector3(1, 1, 1).normalize() },
        uProjMatrix: { value: new Matrix4() },
        uViewMatrix: { value: new Matrix4() },
        uFogColor: { value: new Color(0x3a4f59) },
        uFogDensity: { value: 0.0 },
        uFogNear: { value: 10.0 },
        uFogHeightFalloff: { value: 0.12 },
        uShipPosition: { value: new Vector3(0, -9999, 0) },
        uShipDirection: { value: new Vector3(0, 0, 1) },
        uShipSpeed: { value: 0.0 },
        uShipParams: { value: new Vector4(13.5, 22.5, 26.0, 60.0) }, // beam, bowZ, sternZ, maxWakeLength
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
        uniform mat4 uInverseShadowMatrix;
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
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uFogNear;
        uniform float uFogHeightFalloff;
        uniform vec3 uShipPosition;
        uniform vec3 uShipDirection;
        uniform float uShipSpeed;
        uniform vec4 uShipParams;

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
          
          // Reconstruct screen UVs from the perspective of the SHADOW camera (which rendered the depth map)
          vec4 shadowProjPos = uProjMatrix * uViewMatrix * vec4(vWorldPosition, 1.0);
          vec2 screenUv = shadowProjPos.xy / shadowProjPos.w * 0.5 + 0.5;
          
          float diff = 1e6;

          // If within shadow camera view, sample depth and compute water depth diff
          if (screenUv.x >= 0.0 && screenUv.x <= 1.0 && screenUv.y >= 0.0 && screenUv.y <= 1.0) {
            float depthSample = texture2D(uDepthTexture, screenUv).x;
            
            // If the reconstructed depth is not background (depthSample < 0.9999)
            if (depthSample < 0.9999 && depthSample > 0.0001) {
              vec4 viewPos = viewMatrix * vec4(vWorldPosition, 1.0);
              float surfaceViewZ = viewPos.z;
              
              vec4 ndc = vec4(screenUv * 2.0 - 1.0, depthSample * 2.0 - 1.0, 1.0);
              vec4 worldPosScene = uInverseShadowMatrix * ndc;
              worldPosScene /= worldPosScene.w;
              
              vec4 currentViewPosScene = viewMatrix * worldPosScene;
              diff = surfaceViewZ - currentViewPosScene.z;

              // Prevent water effects on parts of the island that are above water level
              if (diff < -0.1) {
                 discard;
              }
            }
          }
          
          diff = max(0.0, diff);

          // Normal perturbation for ripples
          vec2 rippleUv = vWorldPosition.xz * 4.0 + uTime * 0.1;
          float ripple = fbm(rippleUv);
          normal = normalize(normal + vec3(ripple * 0.1, 0.0, ripple * 0.1));

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
          float spec = pow(max(0.0, dot(viewDir, reflectDir)), 64.0);
          
          color = mix(color, vec3(0.7, 0.85, 1.0) * 1.5, fresnel * 0.4); // Sky reflection approximation
          color += spec * 1.5;

          // Blend water color with the scene color below to simulate transparency
          // If we had the actual scene color texture we could do proper refraction/transparency
          // But since we only have depth, we can at least make the water more transparent as it gets shallower

          // Contact depth foam (Beach foam / Keel contact)
          float contactFoam = 0.0;
          float swash = sin(uTime * 0.8) * 0.08;
          float currentFoamLimit = uFoamLimit + swash;
          
          if (diff < currentFoamLimit) {
            float n = foamNoise(vWorldPosition.xz * 12.0 + uTime * 0.2);
            contactFoam = 1.0 - smoothstep(0.0, currentFoamLimit * (0.3 + 1.2 * n), diff);
            contactFoam = smoothstep(0.2, 0.6, contactFoam); // More contrasty foam
          }

          // Hydrodynamic Moving Ship Foam (Bow Wave Foam & Trailing Stern Wake Foam)
          float bowFoam = 0.0;
          float sternWakeFoam = 0.0;

          if (uShipPosition.y > -9000.0 && uShipSpeed > 0.01) {
            vec3 relPos = vWorldPosition - uShipPosition;
            vec3 forward = normalize(vec3(uShipDirection.x, 0.0, uShipDirection.z));
            vec3 right = vec3(-forward.z, 0.0, forward.x);

            float zLocal = dot(relPos, forward); // Longitudinal axis along ship heading (+Z is bow, -Z is stern)
            float xLocal = dot(relPos, right);   // Lateral axis perpendicular to ship centerline
            float absX = abs(xLocal);

            float beamHalf = uShipParams.x * 0.5;   // Half-beam width (~6.75)
            float bowZ = uShipParams.y;             // Bow prow cutwater position (~22.5)
            float sternZ = -uShipParams.z;          // Stern position (~-26.0)
            float maxWakeDist = uShipParams.w;      // Max trailing wake length (~60.0)

            // --- 1. BOW FOAM (Front of moving ship: Prow cutwater spray & diverging bow wave) ---
            // A. Turbulent cutwater spray right at the front prow tip
            float dCutwater = length(vec2(xLocal * 1.6, max(0.0, zLocal - (bowZ - 1.5))));
            if (dCutwater < 5.0 && zLocal > bowZ - 6.0) {
              float cutwaterShape = smoothstep(4.5, 0.2, dCutwater) * smoothstep(bowZ + 4.0, bowZ - 1.0, zLocal);
              float prowSprayNoise = foamNoise(vWorldPosition.xz * 8.0 - forward.xz * uTime * 4.0 * uShipSpeed);
              float prowSprayFine = noise(vWorldPosition.xz * 16.0 - forward.xz * uTime * 7.0);
              float prowFoam = cutwaterShape * (0.4 + 0.6 * prowSprayNoise + 0.3 * prowSprayFine);
              bowFoam = max(bowFoam, prowFoam);
            }

            // B. Diverging V-shaped Kelvin bow wave peeling outward and backward from cutwater
            float dBehindBow = bowZ - zLocal; // 0 at prow cutwater, positive behind bow along front hull
            if (dBehindBow > -1.0 && dBehindBow < 24.0) {
              float bowSpread = clamp(dBehindBow * 0.55, 0.3, beamHalf + 2.5);
              float waveArmDist = abs(absX - bowSpread);
              float bowArm = smoothstep(2.0, 0.0, waveArmDist) * smoothstep(-1.0, 0.8, dBehindBow) * smoothstep(24.0, 6.0, dBehindBow);

              // Flank froth along the forward hull sides
              float flankFroth = smoothstep(beamHalf + 1.2, 0.0, absX) * smoothstep(0.0, 4.0, dBehindBow) * smoothstep(22.0, 10.0, dBehindBow);

              float bowNoise1 = foamNoise(vWorldPosition.xz * 8.0 - forward.xz * uTime * 3.0 * uShipSpeed);
              float bowNoise2 = noise(vec2(xLocal * 2.5, dBehindBow * 1.2 - uTime * 2.5));
              float bowTexture = mix(bowNoise1, bowNoise2, 0.35);

              float bowWaveFoam = (bowArm * 1.5 + flankFroth * 0.9) * (0.35 + 0.65 * bowTexture);
              bowFoam = max(bowFoam, bowWaveFoam);
            }

            // C. Intensify bow spray where depth prepass detects hull contact near the front
            if (diff < uFoamLimit * 2.8 && zLocal > 0.0) {
              float hullContact = (1.0 - smoothstep(0.0, uFoamLimit * 2.8, diff)) * (0.6 + 0.5 * foamNoise(vWorldPosition.xz * 10.0 - forward.xz * uTime * 2.5));
              bowFoam = max(bowFoam, hullContact);
            }

            bowFoam = clamp(bowFoam, 0.0, 1.0);

            // --- 2. TRAILING STERN WAKE FOAM (Back of moving ship: Trailing wake & prop wash) ---
            float sternRelZ = sternZ - zLocal; // Distance behind stern (positive behind ship)
            if (sternRelZ > -1.5 && sternRelZ < maxWakeDist) {
              // Lateral wake expansion cone behind the ship
              float wakeSpread = beamHalf * 0.65 + sternRelZ * 0.22;
              float wakeFade = smoothstep(maxWakeDist, 0.0, sternRelZ);

              if (absX < wakeSpread * 1.4) {
                // Outer Kelvin wake edges (diverging V-wake crests)
                float edgeDist = abs(absX - wakeSpread * 0.85);
                float wakeEdge = smoothstep(1.1, 0.0, edgeDist) * 0.95;

                // Central churning turbulence track
                float centerTrack = smoothstep(wakeSpread * 0.5, 0.0, absX) * 1.3;

                // Trailing foam texture: elongated streaks stretched along wake direction
                vec2 wakeUV = vec2(xLocal * 2.2, (sternRelZ - uTime * 0.6 * uShipSpeed) * 0.6);
                float wakeNoise1 = foamNoise(wakeUV);
                float wakeNoise2 = noise(wakeUV * 2.0 + vec2(12.0, 37.0));
                float wakePattern = mix(wakeNoise1, wakeNoise2, 0.35);

                float froth = smoothstep(0.18, 0.58, wakePattern * (0.75 + 0.25 * sin(sternRelZ * 0.6 - uTime * 2.0)));

                sternWakeFoam = (centerTrack + wakeEdge) * froth * wakeFade;
                sternWakeFoam = clamp(sternWakeFoam, 0.0, 1.0);
              }
            }
          }
          
          // Combine all foam components
          float foam = max(contactFoam, max(bowFoam, sternWakeFoam));

          // Add some procedural foam on crests
          float crestFoam = smoothstep(0.4, 0.8, vWorldPosition.y);
          float n2 = foamNoise(vWorldPosition.xz * 3.0 - uTime * 0.1);
          crestFoam *= n2;
          foam = max(foam, crestFoam * 0.8);

          color = mix(color, uFoamColor, foam);

          // Fade out opacity at the very edge to avoid harsh intersections
          float edgeAlpha = smoothstep(0.0, 0.1, diff);
          
          // Overall water transparency - gets more opaque as it gets deeper
          float waterAlpha = mix(0.1, uOpacity, smoothstep(0.0, 0.5, diff));
          float finalAlpha = waterAlpha * edgeAlpha;

          // Height-attenuated atmospheric sea fog (Beer-Lambert law)
          if (uFogDensity > 0.0) {
            float dist = length(vWorldPosition - cameraPosition);
            float effDist = max(0.0, dist - uFogNear);
            float avgHeight = max(0.0, 0.5 * (cameraPosition.y + vWorldPosition.y));
            // Thick fog layer in the first 10 meters above sea level
            float lowLayerBoost = 1.0 + 2.0 * smoothstep(10.0, 0.0, avgHeight);
            float heightAtten = exp(-uFogHeightFalloff * avgHeight) * lowLayerBoost;
            float opticalThickness = effDist * uFogDensity * heightAtten;
            float fogFactor = 1.0 - exp(-opticalThickness);
            fogFactor = clamp(fogFactor, 0.0, 1.0);

            color = mix(color, uFogColor, fogFactor);
            finalAlpha = mix(finalAlpha, 1.0, fogFactor);
          }

          gl_FragColor = vec4(color, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });

    const geometry = new PlaneGeometry(200, 200, 256, 256);
    geometry.rotateX(-Math.PI / 2);
    super(geometry, material);

    this.onBeforeRender = (renderer, scene, camera) => {
      // In WebXR, camera might be an eye camera (PerspectiveCamera) belonging to an ArrayCamera
      // or it could be the main camera in non-XR mode.
      // We DON'T update uProjMatrix and uViewMatrix here anymore, because they must match
      // the camera used to render the depth texture, which is handled in WebXRManager or WebPageManager.

      // Update NEAR and FAR for the current camera to ensure linear depth conversion is correct
      // if we were using perspectiveDepthToViewZ.
      if (camera instanceof PerspectiveCamera || camera instanceof OrthographicCamera) {
        material.uniforms.uCameraNear.value = camera.near;
        material.uniforms.uCameraFar.value = camera.far;
      }
    };
  }

  update(time: number) {
    (this.material as ShaderMaterial).uniforms.uTime.value = time;
  }

  setShipState(position: Vector3, direction: Vector3, speed: number, params?: Vector4) {
    const uniforms = (this.material as ShaderMaterial).uniforms;
    if (uniforms.uShipPosition) uniforms.uShipPosition.value.copy(position);
    if (uniforms.uShipDirection) uniforms.uShipDirection.value.copy(direction);
    if (uniforms.uShipSpeed) uniforms.uShipSpeed.value = speed;
    if (params && uniforms.uShipParams) uniforms.uShipParams.value.copy(params);
  }
}
