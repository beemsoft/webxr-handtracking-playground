import {
    BufferAttribute,
    BufferGeometry,
    FrontSide,
    Mesh,
    ShaderMaterial,
    TextureLoader
} from "three/src/Three";

const light = [0.7559289460184544, 0.7559289460184544, -0.3779644730092272];

class Pool extends Mesh {

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

        const tiles = textureloader.load('tiles.jpg');

        const material = new ShaderMaterial( {
            name: 'PoolShader',
            uniforms: {
                light: { value: light },
                tiles: { value: tiles },
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
Pool.prototype.isPool = true;

export { Pool };
