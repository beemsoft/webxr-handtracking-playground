import {
    Mesh,
    OrthographicCamera,
    ShaderChunk, ShaderMaterial,
    UnsignedByteType,
    WebGLRenderTarget
} from "three/src/Three";
import {loadFile} from "../utils/utils";

const light = [0.7559289460184544, 0.7559289460184544, -0.3779644730092272];

export class Caustics {
    loaded: Promise<void>;
    private _camera: OrthographicCamera;
    private _geometry: any;
    texture: WebGLRenderTarget;
    private _causticMesh: Mesh<any, ShaderMaterial>;

    constructor(lightFrontGeometry) {
        this._camera = new OrthographicCamera(0, 1, 1, 0, 0, 2000);

        this._geometry = lightFrontGeometry;

        this.texture = new WebGLRenderTarget(1024, 1024, {type: UnsignedByteType});

        loadFile('shaders/utils.glsl').then((utils) => {
            ShaderChunk['utils'] = utils;
            const shadersPromises = [
                loadFile('shaders/caustics/vertex.glsl'),
                loadFile('shaders/caustics/fragment.glsl')
            ];

            this.loaded = Promise.all(shadersPromises)
                .then(([vertexShader, fragmentShader]) => {
                    const material = new ShaderMaterial({
                        uniforms: {
                            light: { value: light },
                            water: { value: null },
                        },
                        // @ts-ignore
                        vertexShader: vertexShader,
                        // @ts-ignore
                        fragmentShader: fragmentShader,
                    });
                    material.extensions.derivatives = true;
                    this._causticMesh = new Mesh(this._geometry, material);
                });
        });


    }

    update(renderer, waterTexture) {
        if (this.loaded && this._causticMesh && this._causticMesh.material) {
            this._causticMesh.material.uniforms['water'].value = waterTexture;
            this._causticMesh.material.extensions.derivatives = true;

            renderer.setRenderTarget(this.texture);

            // TODO Camera is useless here, what should be done?
            renderer.render(this._causticMesh, this._camera);
        }
    }

}
