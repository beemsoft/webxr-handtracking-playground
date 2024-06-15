import {loadFile} from "../utils/utils";
import {
    FloatType,
    Mesh,
    OrthographicCamera,
    PlaneGeometry,
    ShaderMaterial,
    WebGLRenderTarget
} from "three/src/Three";

export class WaterSimulation {
    private _camera: OrthographicCamera;
    private _geometry: PlaneGeometry;
    private _textureA: WebGLRenderTarget;
    private _textureB: WebGLRenderTarget;

    texture: WebGLRenderTarget;
    loaded: Promise<void>;
    _dropMesh: Mesh<PlaneGeometry, ShaderMaterial>;
    _normalMesh: Mesh<PlaneGeometry, ShaderMaterial>;
    _updateMesh: Mesh<PlaneGeometry, ShaderMaterial>;

    constructor() {
        this._camera = new OrthographicCamera(0, 1, 1, 0, 0, 2000);

        this._geometry = new PlaneGeometry(2, 2);

        this._textureA = new WebGLRenderTarget(256, 256, {type: FloatType});
        this._textureB = new WebGLRenderTarget(256, 256, {type: FloatType});
        this.texture = this._textureA;

        const shadersPromises = [
            loadFile('shaders/simulation/vertex.glsl'),
            loadFile('shaders/simulation/drop_fragment.glsl'),
            loadFile('shaders/simulation/normal_fragment.glsl'),
            loadFile('shaders/simulation/update_fragment.glsl'),
        ];

        this.loaded = Promise.all(shadersPromises)
            .then(([vertexShader, dropFragmentShader, normalFragmentShader, updateFragmentShader]) => {
                const dropMaterial = new ShaderMaterial({
                    uniforms: {
                        center: { value: [0, 0] },
                        radius: { value: 0 },
                        strength: { value: 0 },
                        texture2: { value: null },
                    },
                    // @ts-ignore
                    vertexShader: vertexShader,
                    // @ts-ignore
                    fragmentShader: dropFragmentShader,
                });

                const normalMaterial = new ShaderMaterial({
                    uniforms: {
                        delta: { value: [1 / 512, 1 / 512] },  // TODO: Remove this useless uniform and hardcode it in shaders?
                        texture2: { value: null },
                    },
                    // @ts-ignore
                    vertexShader: vertexShader,
                    // @ts-ignore
                    fragmentShader: normalFragmentShader,
                });

                const updateMaterial = new ShaderMaterial({
                    uniforms: {
                        delta: { value: [1 / 512, 1 / 512] },  // TODO: Remove this useless uniform and hardcode it in shaders?
                        texture2: { value: null },
                    },
                    // @ts-ignore
                    vertexShader: vertexShader,
                    // @ts-ignore
                    fragmentShader: updateFragmentShader,
                });
                this._dropMesh = new Mesh(this._geometry, dropMaterial);
                this._normalMesh = new Mesh(this._geometry, normalMaterial);
                this._updateMesh = new Mesh(this._geometry, updateMaterial);
            });
    }

    // Add a drop of water at the (x, y) coordinate (in the range [-1, 1])
    addDrop(renderer, x, y, radius, strength) {
        this._dropMesh.material.uniforms['center'].value = [x, y];
        this._dropMesh.material.uniforms['radius'].value = radius;
        this._dropMesh.material.uniforms['strength'].value = strength;

        this._render(renderer, this._dropMesh);
    }

    stepSimulation(renderer) {
        this._render(renderer, this._updateMesh);
    }

    updateNormals(renderer) {
        this._render(renderer, this._normalMesh);
    }

    _render(renderer, mesh) {
        // Swap textures
        const oldTexture = this.texture;
        const newTexture = this.texture === this._textureA ? this._textureB : this._textureA;

        mesh.material.uniforms['texture2'].value = oldTexture.texture;

        renderer.setRenderTarget(newTexture);

        // TODO Camera is useless here, what should be done?
        renderer.render(mesh, this._camera);

        this.texture = newTexture;
        renderer.setRenderTarget(null);
    }

}
