import { Water } from '../scene/water/Water';
import { Matrix4, PerspectiveCamera, Plane, Scene, Vector3, Vector4, WebGLRenderer } from 'three/src/Three';

export default class WaterManager {

  private mirrorPlane = new Plane();
  private normal = new Vector3();
  private mirrorWorldPosition = new Vector3();
  private cameraWorldPosition = new Vector3();
  private rotationMatrix = new Matrix4();
  private lookAtPosition = new Vector3( 0, 0, - 1 );
  private clipPlane = new Vector4();

  private view = new Vector3();
  private target = new Vector3();
  private q = new Vector4();

  private mirrorCamera = new PerspectiveCamera();

  update(water: Water, renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    renderer.setRenderTarget( water.renderTarget );

    this.mirrorWorldPosition.setFromMatrixPosition( water.matrixWorld );
    this.cameraWorldPosition.setFromMatrixPosition( camera.matrixWorld );

    this.rotationMatrix.extractRotation( water.matrixWorld );

    this.normal.set( 0, 0, 1 );
    this.normal.applyMatrix4( this.rotationMatrix );

    this.view.subVectors( this.mirrorWorldPosition, this.cameraWorldPosition );

    // Avoid rendering when mirror is facing away
    if ( this.view.dot( this.normal ) > 0 ) return;

    this.view.reflect( this.normal ).negate();
    this.view.add( this.mirrorWorldPosition );

    this.rotationMatrix.extractRotation( camera.matrixWorld );

    this.lookAtPosition.set( 0, 0, - 1 );
    this.lookAtPosition.applyMatrix4( this.rotationMatrix );
    this.lookAtPosition.add( this.cameraWorldPosition );

    this.target.subVectors( this.mirrorWorldPosition, this.lookAtPosition );
    this.target.reflect( this.normal ).negate();
    this.target.add( this.mirrorWorldPosition );

    this.mirrorCamera.position.copy( this.view );
    this.mirrorCamera.up.set( 0, 1, 0 );
    this.mirrorCamera.up.applyMatrix4( this.rotationMatrix );
    this.mirrorCamera.up.reflect( this.normal );
    this.mirrorCamera.lookAt( this.target );

    this.mirrorCamera.far = camera.far; // Used in WebGLBackground

    this.mirrorCamera.updateMatrixWorld();
    this.mirrorCamera.projectionMatrix.copy( camera.projectionMatrix );

    // Update the texture matrix
    water.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    water.textureMatrix.multiply( this.mirrorCamera.projectionMatrix );
    water.textureMatrix.multiply( this.mirrorCamera.matrixWorldInverse );

    // Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
    // Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
    this.mirrorPlane.setFromNormalAndCoplanarPoint( this.normal, this.mirrorWorldPosition );
    this.mirrorPlane.applyMatrix4( this.mirrorCamera.matrixWorldInverse );

    this.clipPlane.set( this.mirrorPlane.normal.x, this.mirrorPlane.normal.y, this.mirrorPlane.normal.z, this.mirrorPlane.constant );

    const projectionMatrix = this.mirrorCamera.projectionMatrix;

    this.q.x = ( Math.sign( this.clipPlane.x ) + projectionMatrix.elements[ 8 ] ) / projectionMatrix.elements[ 0 ];
    this.q.y = ( Math.sign( this.clipPlane.y ) + projectionMatrix.elements[ 9 ] ) / projectionMatrix.elements[ 5 ];
    this.q.z = - 1.0;
    this.q.w = ( 1.0 + projectionMatrix.elements[ 10 ] ) / projectionMatrix.elements[ 14 ];

    // Calculate the scaled plane vector
    this.clipPlane.multiplyScalar( 2.0 / this.clipPlane.dot( this.q ) );

    // Replacing the third row of the projection matrix
    projectionMatrix.elements[ 2 ] = this.clipPlane.x;
    projectionMatrix.elements[ 6 ] = this.clipPlane.y;
    projectionMatrix.elements[ 10 ] = this.clipPlane.z + 1.0 - water.clipBias;
    projectionMatrix.elements[ 14 ] = this.clipPlane.w;

    water.eye.setFromMatrixPosition( camera.matrixWorld );

    // Render

    water.visible = false;

    renderer.setRenderTarget( water.renderTarget );
    renderer.state.buffers.depth.setMask( true ); // make sure the depth buffer is writable so it can be properly cleared, see #18897
    renderer.clear();
    renderer.render(scene, this.mirrorCamera);

    water.visible = true;

    renderer.setRenderTarget(null);
  }
}
