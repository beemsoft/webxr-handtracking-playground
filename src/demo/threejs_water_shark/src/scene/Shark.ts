import {
    BufferAttribute,
    BufferGeometry,
    FrontSide,
    Mesh,
    ShaderMaterial,
    TextureLoader
} from "three";

const light = [0.7559289460184544, 0.7559289460184544, -0.3779644730092272];

class Shark extends Mesh {

    constructor() {

        const vertices = new Float32Array([
            -1, -1, -1,
            -1, -1, 1,
            -1, 1, -1,
            -1, 1, 1,
            1, -1, -1,
            1, 1, -1,
            1, -1, 1,
            1, 1, 1,
            -1, -1, -1,
            1, -1, -1,
            -1, -1, 1,
            1, -1, 1,
            -1, 1, -1,
            -1, 1, 1,
            1, 1, -1,
            1, 1, 1,
            -1, -1, -1,
            -1, 1, -1,
            1, -1, -1,
            1, 1, -1,
            -1, -1, 1,
            1, -1, 1,
            -1, 1, 1,
            1, 1, 1
        ]);
        const indices = new Uint32Array([
            0, 1, 2,
            2, 1, 3,
            4, 5, 6,
            6, 5, 7,
            12, 13, 14,
            14, 13, 15,
            16, 17, 18,
            18, 17, 19,
            20, 21, 22,
            22, 21, 23
        ]);



        const textureloader = new TextureLoader();

        // https://discourse.threejs.org/t/gltf-and-custom-shader-now-with-live-example/6003
        // https://discourse.threejs.org/t/skinnedmesh-gltf-with-shadermaterial-doesnt-respond-to-blender-animations/35912
        // https://stackoverflow.com/questions/66677427/understand-gltf-jointmatrix
        // https://github.com/KhronosGroup/glTF-Tutorials/blob/master/gltfTutorial/gltfTutorial_020_Skins.md

        // v - TODO: 0: use shark gltf
        // TODO: 1a: custom shader for gltf (using original texture) without caustics
           // similar to pool texture
           // replace gltf material with custom material/shader
           // https://threejs.org/docs/#examples/en/loaders/GLTFLoader
        // --> flipY ?
          // --> use MeshStandardMaterial instead of ShaderMaterial to solve texture mapping issue
          // https://medium.com/@pailhead011/extending-three-js-materials-with-glsl-78ea7bbb9270
          // https://codesandbox.io/s/github/FarazzShaikh/THREE-CustomShaderMaterial/tree/main/examples/caustics
        // TODO: 1b: custom shader for gltf (using original texture) with caustics
           // caustics + only geometry already done in other demo
        // TODO: 2: custom shader for gltf (using original texture) + animated (boneMatrix in shader)
        // TODO: 3: custom shader for gltf (using original texture) + animated (boneMatrix in shader) + caustics effect
        // TODO: 4: custom shader for gltf (using original texture) + animated (boneMatrix in shader) + caustics effect + moving in circle
        // TODO: 5: custom shader for gltf (using original texture) + animated (boneMatrix in shader) + caustics effect + moving in circle + react to hand movement
        // TODO: 6: fix refraction for shark below water (is working in other demo)
        // TODO: 7: nice to have: shadow (is working in other demo)
        const skin = textureloader.load('assets/shark/shark_material.001_basecolor.png');

        const material = new ShaderMaterial( {
            name: 'SharkShader',
            uniforms: {
                light: { value: light },
                skin: { value: skin },
                water: { value: null },
                causticTex: { value: null },
            },
            vertexShader: /* glsl */`
#include <utils>

varying vec3 pos;


void main() {
  pos = position.xyz;
  pos.y = ((1.0 - pos.y) * (7.0 / 12.0) - 1.0) * poolHeight;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
		`,

            fragmentShader: /* glsl */`
precision highp float;
precision highp int;

#include <utils>

varying vec3 pos;


void main() {
  gl_FragColor = vec4(getWallColor(pos), 1.0);

  vec4 info = texture2D(water, pos.xz * 0.5 + 0.5);

  if (pos.y < info.r) {
    gl_FragColor.rgb *= underwaterColor * 1.2;
  }
}
		`,
            side: FrontSide
        } );

        let poolGeometry = new BufferGeometry();
        poolGeometry.setAttribute('position', new BufferAttribute(vertices, 3));
        poolGeometry.setIndex(new BufferAttribute(indices, 1));
        super(poolGeometry, material);
    }

}

// @ts-ignore
Shark.prototype.isShark = true;

export { Shark };
