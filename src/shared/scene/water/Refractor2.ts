import {
    Color,
    Matrix4,
    Mesh,
    PerspectiveCamera,
    Plane,
    Quaternion,
    ShaderMaterial,
    UniformsUtils,
    Vector3,
    Vector4,
    WebGLRenderTarget,
    HalfFloatType, Texture
} from 'three';

class Refractor extends Mesh {
    private camera: PerspectiveCamera;
    private renderTarget: WebGLRenderTarget;
    private virtualCamera: PerspectiveCamera;
    private refractorPlane = new Plane();
    private clipBias: number;
    private textureMatrix = new Matrix4();

    constructor( geometry, options = {
        color: undefined,
        textureWidth: 0,
        textureHeight: 0,
        clipBias: 0,
        shader: undefined,
        multisample: undefined
    } ) {

        super( geometry );

        // @ts-ignore
        this.type = 'Refractor';
        this.camera = new PerspectiveCamera();

        const color = ( options.color !== undefined ) ? new Color( options.color ) : new Color( 0x7F7F7F );
        const textureWidth = options.textureWidth || 512;
        const textureHeight = options.textureHeight || 512;
        this.clipBias = options.clipBias || 0;
        // @ts-ignore
        const shader = options.shader || Refractor.RefractorShader;
        const multisample = ( options.multisample !== undefined ) ? options.multisample : 4;


        this.virtualCamera = this.camera;
        this.virtualCamera.matrixAutoUpdate = false;
        this.virtualCamera.userData.refractor = true;

        // render target
        this.renderTarget = new WebGLRenderTarget( textureWidth, textureHeight, { samples: multisample, type: HalfFloatType } );

        // material
        // @ts-ignore
        this.material = new ShaderMaterial( {
            uniforms: UniformsUtils.clone( shader.uniforms ),
            vertexShader: shader.vertexShader,
            fragmentShader: shader.fragmentShader,
            transparent: true // ensures, refractors are drawn from farthest to closest
        } );

        // @ts-ignore
        this.material.uniforms[ 'color' ].value = color;
        // @ts-ignore
        this.material.uniforms[ 'tDiffuse' ].value = this.renderTarget.texture;
        // @ts-ignore
        this.material.uniforms[ 'textureMatrix' ].value = this.textureMatrix;
    }

    visible2(camera) {

        const refractorWorldPosition = new Vector3();
        const cameraWorldPosition = new Vector3();
        const rotationMatrix = new Matrix4();

        const view = new Vector3();
        const normal = new Vector3();

        // @ts-ignore
        refractorWorldPosition.setFromMatrixPosition(this.matrixWorld);
        cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

        view.subVectors(refractorWorldPosition, cameraWorldPosition);
        // @ts-ignore
        rotationMatrix.extractRotation(this.matrixWorld);

        normal.set(0, 0, 1);
        normal.applyMatrix4(rotationMatrix);

        return view.dot(normal) < 0;
    }

        render( renderer, scene, camera ) {
            // @ts-ignore
            this.visible = false;

            const currentRenderTarget = renderer.getRenderTarget();
            const currentXrEnabled = renderer.xr.enabled;
            const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

            // renderer.xr.enabled = false; // avoid camera modification
            renderer.shadowMap.autoUpdate = false; // avoid re-computing shadows

            renderer.setRenderTarget( this.renderTarget );
            renderer.state.buffers.depth.setMask( true ); // make sure the depth buffer is writable so it can be properly cleared, see #18897
            if ( renderer.autoClear === false ) renderer.clear();
            renderer.render( scene, this.virtualCamera );
            // renderer.render( scene, this.camera );

            // renderer.xr.enabled = currentXrEnabled;
            renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;
            renderer.setRenderTarget( currentRenderTarget );

            // restore viewport

            // const viewport = camera.viewport;
            //
            // if ( viewport !== undefined ) {
            //
            //     renderer.state.viewport( viewport );
            //
            // }
            // @ts-ignore
            this.visible = true;

        }

        updateRefractorPlane() {

            const normal = new Vector3();
            const position = new Vector3();
            const quaternion = new Quaternion();
            const scale = new Vector3();

            // @ts-ignore
                this.matrixWorld.decompose( position, quaternion, scale );
                normal.set( 0, 0, 1 ).applyQuaternion( quaternion ).normalize();

                // flip the normal because we want to cull everything above the plane

                normal.negate();

                this.refractorPlane.setFromNormalAndCoplanarPoint( normal, position );


        }

        updateVirtualCamera(camera) {

            const clipPlane = new Plane();
            const clipVector = new Vector4();
            const q = new Vector4();


                this.virtualCamera.matrixWorld.copy( camera.matrixWorld );
                this.virtualCamera.matrixWorldInverse.copy( this.virtualCamera.matrixWorld ).invert();
                this.virtualCamera.projectionMatrix.copy( camera.projectionMatrix );
                this.virtualCamera.far = camera.far; // used in WebGLBackground

                // The following code creates an oblique view frustum for clipping.
                // see: Lengyel, Eric. “Oblique View Frustum Depth Projection and Clipping”.
                // Journal of Game Development, Vol. 1, No. 2 (2005), Charles River Media, pp. 5–16

                clipPlane.copy( this.refractorPlane );
                clipPlane.applyMatrix4( this.virtualCamera.matrixWorldInverse );

                clipVector.set( clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z, clipPlane.constant );

                // calculate the clip-space corner point opposite the clipping plane and
                // transform it into camera space by multiplying it by the inverse of the projection matrix

                const projectionMatrix = this.virtualCamera.projectionMatrix;

                q.x = ( Math.sign( clipVector.x ) + projectionMatrix.elements[ 8 ] ) / projectionMatrix.elements[ 0 ];
                q.y = ( Math.sign( clipVector.y ) + projectionMatrix.elements[ 9 ] ) / projectionMatrix.elements[ 5 ];
                q.z = - 1.0;
                q.w = ( 1.0 + projectionMatrix.elements[ 10 ] ) / projectionMatrix.elements[ 14 ];

                // calculate the scaled plane vector

                clipVector.multiplyScalar( 2.0 / clipVector.dot( q ) );

                // replacing the third row of the projection matrix

                projectionMatrix.elements[ 2 ] = clipVector.x;
                projectionMatrix.elements[ 6 ] = clipVector.y;
                projectionMatrix.elements[ 10 ] = clipVector.z + 1.0 - this.clipBias;
                projectionMatrix.elements[ 14 ] = clipVector.w;

        }

        // This will update the texture matrix that is used for projective texture mapping in the shader.
        // see: http://developer.download.nvidia.com/assets/gamedev/docs/projective_texture_mapping.pdf

        updateTextureMatrix( camera ) {

            // this matrix does range mapping to [ 0, 1 ]

            this.textureMatrix.set(
                0.5, 0.0, 0.0, 0.5,
                0.0, 0.5, 0.0, 0.5,
                0.0, 0.0, 0.5, 0.5,
                0.0, 0.0, 0.0, 1.0
            );

            // we use "Object Linear Texgen", so we need to multiply the texture matrix T
            // (matrix above) with the projection and view matrix of the virtual camera
            // and the model matrix of the refractor

            this.textureMatrix.multiply( camera.projectionMatrix );
            this.textureMatrix.multiply( camera.matrixWorldInverse );
            // @ts-ignore
            this.textureMatrix.multiply( this.matrixWorld );

        }

        onBeforeRender2( renderer, scene, camera ) {

            // ensure refractors are rendered only once per frame

            if ( camera.userData.refractor === true ) return;

            // avoid rendering when the refractor is viewed from behind

            if ( ! this.visible2( camera ) === true ) return;

            // update

            this.updateRefractorPlane();

            this.updateTextureMatrix( camera );

            this.updateVirtualCamera( camera );
            //
            this.render( renderer, scene, camera );

        };

        getRenderTarget() {

            return this.renderTarget;

        }


}

// @ts-ignore
Refractor.RefractorShader = {

    uniforms: {

        'color': {
            value: null
        },

        'tDiffuse': {
            value: null
        },

        'textureMatrix': {
            value: null
        }

    },

    vertexShader: /* glsl */`

		uniform mat4 textureMatrix;

		varying vec4 vUv;

		void main() {

			vUv = textureMatrix * vec4( position, 1.0 );
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

		}`,

    fragmentShader: /* glsl */`

		uniform vec3 color;
		uniform sampler2D tDiffuse;

		varying vec4 vUv;

		float blendOverlay( float base, float blend ) {

			return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );

		}

		vec3 blendOverlay( vec3 base, vec3 blend ) {

			return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );

		}

		void main() {

			vec4 base = texture2DProj( tDiffuse, vUv );
			gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`

};

export { Refractor };
