import {
    Color,
    Matrix4,
    Mesh,
    PerspectiveCamera,
    Plane,
    ShaderMaterial,
    UniformsUtils,
    Vector3,
    Vector4,
    WebGLRenderTarget,
    HalfFloatType
} from 'three';

class Reflector extends Mesh {
    private camera = new PerspectiveCamera();
    private static ReflectorShader: any;
    private reflectorWorldPosition = new Vector3();
    private cameraWorldPosition= new Vector3();
    private rotationMatrix = new Matrix4();
    private normal= new Vector3();
    private view= new Vector3();
    private lookAtPosition = new Vector3( 0, 0, - 1 );
    private target= new Vector3();
    private virtualCamera = this.camera;
    private textureMatrix= new Matrix4();
    private reflectorPlane= new Plane();
    private clipPlane= new Vector4();
    private clipBias: number;
    private q = new Vector4()
    private renderTarget: WebGLRenderTarget;

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
        this.type = 'Reflector';
        this.camera = new PerspectiveCamera();

        const color = ( options.color !== undefined ) ? new Color( options.color ) : new Color( 0x7F7F7F );
        const textureWidth = options.textureWidth || 512;
        const textureHeight = options.textureHeight || 512;
        this.clipBias = options.clipBias || 0;
        const shader = options.shader || Reflector.ReflectorShader;
        const multisample = ( options.multisample !== undefined ) ? options.multisample : 4;


        const textureMatrix = new Matrix4();

        this.renderTarget = new WebGLRenderTarget( textureWidth, textureHeight, { samples: multisample, type: HalfFloatType } );

        const material = new ShaderMaterial( {
            name: ( shader.name !== undefined ) ? shader.name : 'unspecified',
            uniforms: UniformsUtils.clone( shader.uniforms ),
            fragmentShader: shader.fragmentShader,
            vertexShader: shader.vertexShader
        } );

        material.uniforms[ 'tDiffuse' ].value = this.renderTarget.texture;
        material.uniforms[ 'color' ].value = color;
        material.uniforms[ 'textureMatrix' ].value = textureMatrix;

        // @ts-ignore
        this.material = material;

    }

    getRenderTarget() {

        return this.renderTarget;

    }

    render( renderer, scene, camera ) {

        // @ts-ignore
        this.reflectorWorldPosition.setFromMatrixPosition( this.matrixWorld );
        this.cameraWorldPosition.setFromMatrixPosition( camera.matrixWorld );

        // @ts-ignore
        this.rotationMatrix.extractRotation( this.matrixWorld );

        this.normal.set( 0, 0, 1 );
        this.normal.applyMatrix4( this.rotationMatrix );

        this.view.subVectors( this.reflectorWorldPosition, this.cameraWorldPosition );

        // Avoid rendering when reflector is facing away

        if ( this.view.dot( this.normal ) > 0 ) return;

        this.view.reflect( this.normal ).negate();
        this.view.add( this.reflectorWorldPosition );

        this.rotationMatrix.extractRotation( camera.matrixWorld );

        this.lookAtPosition.set( 0, 0, - 1 );
        this.lookAtPosition.applyMatrix4( this.rotationMatrix );
        this.lookAtPosition.add( this.cameraWorldPosition );

        this.target.subVectors( this.reflectorWorldPosition, this.lookAtPosition );
        this.target.reflect( this.normal ).negate();
        this.target.add( this.reflectorWorldPosition );

        this.virtualCamera.position.copy( this.view );
        this.virtualCamera.up.set( 0, 1, 0 );
        this.virtualCamera.up.applyMatrix4( this.rotationMatrix );
        this.virtualCamera.up.reflect( this.normal );
        this.virtualCamera.lookAt( this.target );

        this.virtualCamera.far = camera.far; // Used in WebGLBackground

        this.virtualCamera.updateMatrixWorld();
        this.virtualCamera.projectionMatrix.copy( camera.projectionMatrix );

        // Update the texture matrix
        this.textureMatrix.set(
            0.5, 0.0, 0.0, 0.5,
            0.0, 0.5, 0.0, 0.5,
            0.0, 0.0, 0.5, 0.5,
            0.0, 0.0, 0.0, 1.0
        );
        this.textureMatrix.multiply( this.virtualCamera.projectionMatrix );
        this.textureMatrix.multiply( this.virtualCamera.matrixWorldInverse );
        // @ts-ignore
        this.textureMatrix.multiply( this.matrixWorld );

        // Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
        // Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
        this.reflectorPlane.setFromNormalAndCoplanarPoint( this.normal, this.reflectorWorldPosition );
        this.reflectorPlane.applyMatrix4( this.virtualCamera.matrixWorldInverse );

        this.clipPlane.set( this.reflectorPlane.normal.x, this.reflectorPlane.normal.y, this.reflectorPlane.normal.z, this.reflectorPlane.constant );

        const projectionMatrix = this.virtualCamera.projectionMatrix;

        this.q.x = ( Math.sign( this.clipPlane.x ) + projectionMatrix.elements[ 8 ] ) / projectionMatrix.elements[ 0 ];
        this.q.y = ( Math.sign( this.clipPlane.y ) + projectionMatrix.elements[ 9 ] ) / projectionMatrix.elements[ 5 ];
        this.q.z = - 1.0;
        this.q.w = ( 1.0 + projectionMatrix.elements[ 10 ] ) / projectionMatrix.elements[ 14 ];

        // Calculate the scaled plane vector
        this.clipPlane.multiplyScalar( 2.0 / this.clipPlane.dot( this.q ) );

        // Replacing the third row of the projection matrix
        projectionMatrix.elements[ 2 ] = this.clipPlane.x;
        projectionMatrix.elements[ 6 ] = this.clipPlane.y;
        projectionMatrix.elements[ 10 ] = this.clipPlane.z + 1.0 - this.clipBias;
        projectionMatrix.elements[ 14 ] = this.clipPlane.w;

        // Render
        // @ts-ignore
        this.visible = false;

        const currentRenderTarget = renderer.getRenderTarget();

        // const currentXrEnabled = renderer.xr.enabled;
        const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

        // renderer.xr.enabled = false; // Avoid camera modification
        renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows

        renderer.setRenderTarget( this.renderTarget );

        renderer.state.buffers.depth.setMask( true ); // make sure the depth buffer is writable so it can be properly cleared, see #18897

        if ( renderer.autoClear === false ) renderer.clear();
        renderer.render( scene, this.virtualCamera );

        // renderer.xr.enabled = currentXrEnabled;
        renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

        renderer.setRenderTarget( currentRenderTarget );

        // Restore viewport

        const viewport = camera.viewport;

        if ( viewport !== undefined ) {

            renderer.state.viewport( viewport );

        }

        // @ts-ignore
        this.visible = true;

    };

}

// @ts-ignore
Reflector.ReflectorShader = {

    name: 'ReflectorShader',

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

		#include <common>
		#include <logdepthbuf_pars_vertex>

		void main() {

			vUv = textureMatrix * vec4( position, 1.0 );

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

			#include <logdepthbuf_vertex>

		}`,

    fragmentShader: /* glsl */`
		uniform vec3 color;
		uniform sampler2D tDiffuse;
		varying vec4 vUv;

		#include <logdepthbuf_pars_fragment>

		float blendOverlay( float base, float blend ) {

			return( base < 0.5 ? ( 2.0 * base * blend ) : ( 1.0 - 2.0 * ( 1.0 - base ) * ( 1.0 - blend ) ) );

		}

		vec3 blendOverlay( vec3 base, vec3 blend ) {

			return vec3( blendOverlay( base.r, blend.r ), blendOverlay( base.g, blend.g ), blendOverlay( base.b, blend.b ) );

		}

		void main() {

			#include <logdepthbuf_fragment>

			vec4 base = texture2DProj( tDiffuse, vUv );
			gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`
};

export { Reflector };
