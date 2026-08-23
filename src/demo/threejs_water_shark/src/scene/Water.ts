import {
    CubeTextureLoader,
    DoubleSide,
    Mesh,
    PlaneGeometry,
    ShaderMaterial,
    TextureLoader
} from "three";

export class Water extends Mesh {
    public material: ShaderMaterial;

    constructor() {
        const cubetextureloader = new CubeTextureLoader();

        const textureCube = cubetextureloader.load([
            'xpos.jpg', 'xneg.jpg',
            'ypos.jpg', 'ypos.jpg',
            'zpos.jpg', 'zneg.jpg',
        ]);

        const textureloader = new TextureLoader();
        const tiles = textureloader.load('tiles.jpg');
        const light = [0.7559289460184544, 0.7559289460184544, -0.3779644730092272];

        const material = new ShaderMaterial( {
            name: 'WaterShader',
            uniforms: {
                light: { value: light },
                tiles: { value: tiles },
                sky: { value: textureCube },
                water: { value: null },
                causticTex: { value: null },
                underwater: { value: false },
            },
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            vertexShader: /* glsl */`
uniform sampler2D water;

varying vec3 eye;
varying vec3 pos;
varying vec3 vWorldPosition;

void main() {
  vec4 info = texture2D(water, position.xy * 0.5 + 0.5);
  pos = position.xzy;
  pos.y += info.r;

  vec3 axis_x = vec3(modelViewMatrix[0].x, modelViewMatrix[0].y, modelViewMatrix[0].z);
  vec3 axis_y = vec3(modelViewMatrix[1].x, modelViewMatrix[1].y, modelViewMatrix[1].z);
  vec3 axis_z = vec3(modelViewMatrix[2].x, modelViewMatrix[2].y, modelViewMatrix[2].z);
  vec3 offset = vec3(modelViewMatrix[3].x, modelViewMatrix[3].y, modelViewMatrix[3].z);

  eye = vec3(dot(-offset, axis_x), dot(-offset, axis_y), dot(-offset, axis_z));
  vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
            `,
            fragmentShader: /* glsl */`
precision highp float;
precision highp int;

#include <utils>

uniform float underwater;
uniform samplerCube sky;

varying vec3 eye;
varying vec3 pos;
varying vec3 vWorldPosition;

void main() {
  vec2 coord = pos.xz * 0.5 + 0.5;
  vec4 info = texture2D(water, coord);

  /* make water look more "peaked" */
  for (int i = 0; i < 5; i++) {
    coord += info.ba * 0.005;
    info = texture2D(water, coord);
  }

  vec3 normal = normalize(vec3(info.b, sqrt(max(0.001, 1.0 - dot(info.ba, info.ba))), info.a));
  vec3 incomingRay = normalize(pos - eye);

  if (dot(normal, incomingRay) > 0.0) {
    // Viewing from underwater
    normal = -normal;
    vec3 reflectedRay = reflect(incomingRay, normal);
    vec3 refractedRay = refract(incomingRay, normal, IOR_WATER / IOR_AIR);
    float fresnel = mix(0.4, 1.0, pow(1.0 - max(0.0, dot(normal, -incomingRay)), 3.0));

    vec3 skyCol = (length(refractedRay) > 0.0) ? textureCube(sky, refractedRay).rgb : underwaterColor;
    vec3 color = mix(underwaterColor * 0.9, skyCol, (1.0 - fresnel) * length(refractedRay));
    gl_FragColor = vec4(color, 0.45);
  } else {
    // Viewing from above water
    vec3 reflectedRay = reflect(incomingRay, normal);
    float fresnel = mix(0.15, 0.95, pow(1.0 - max(0.0, dot(normal, -incomingRay)), 3.0));

    vec3 reflectedSky = textureCube(sky, reflectedRay).rgb;
    
    // Sunlight specular glint on waves
    float specular = pow(max(0.0, dot(reflectedRay, normalize(light))), 40.0) * 1.6;
    reflectedSky += specular * vec3(1.0, 0.95, 0.85);

    // Water surface color tint (shallow tropical cyan)
    vec3 waterSurfaceTint = vec3(0.05, 0.35, 0.45);
    vec3 surfaceColor = mix(waterSurfaceTint, reflectedSky, fresnel) + specular;

    // Semi-transparent surface allowing shark and pool tiles to show through clearly
    float alpha = mix(0.35, 0.92, fresnel);
    gl_FragColor = vec4(surfaceColor, alpha);
  }
}
            `
        } );

        let waterGeometry = new PlaneGeometry(2, 2, 200, 200);
        super(waterGeometry, material);
    }
}
