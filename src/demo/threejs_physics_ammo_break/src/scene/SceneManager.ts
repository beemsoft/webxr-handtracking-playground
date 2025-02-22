import {
  BoxGeometry,
  Mesh,
  MeshPhongMaterial,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  TextureLoader,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import HandPoseWithoutPhysicsManager from "../../../../shared/hands/HandPoseWithoutPhysicsManager";
import {GestureType, HandTrackingResult} from "../../../../shared/scene/SceneManagerInterface";
import {ConvexGeometry} from "three/examples/jsm/geometries/ConvexGeometry";
import {Quaternion} from "cannon-es";

export default class SceneManager extends SceneManagerParent {
  private handPoseManager2: HandPoseWithoutPhysicsManager;

  // Ground
  private pos = new Vector3();
  private quat = new Quaternion();
  private textureLoader = new TextureLoader();

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    this.handPoseManager2 = new HandPoseWithoutPhysicsManager(this.scene);

    this.ammoHandler.init()
        .then(() => {
      this.createObjects();
    })

    this.sceneHelper.addLight(true);
    this.sceneHelper.addMessage('Open your hand in order to make some impact!', renderer.capabilities.getMaxAnisotropy());
  }

  createObject( mass, halfExtents, pos, quat, material ) {
    const object = new Mesh( new BoxGeometry( halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2 ), material );
    object.position.copy( pos );
    object.quaternion.copy( quat );
    this.ammoHandler.prepareBreakableObject( object, mass, new Vector3(), new Vector3(), true );
  }

  createObjects() {
    // Ground
    this.pos.set( 0, - 0.5, 0 );
    this.quat.set( 0, 0, 0, 1 );
    const ground = this.createParalellepipedWithPhysics( 40, 1, 40, 0, this.pos, this.quat, new MeshPhongMaterial( { color: 0xFFFFFF } ) );
    ground.receiveShadow = true;
    this.textureLoader.load( '/textures/grid.png', function ( texture ) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set( 40, 40 );
      ground.material.map = texture;
      ground.material.needsUpdate = true;
    } );

    // Tower 1
    const towerMass = 1000;
    const towerHalfExtents = new Vector3( 2, 5, 2 );
    this.pos.set( - 8, 5, 0 );
    this.quat.set( 0, 0, 0, 1 );
    this.createObject( towerMass, towerHalfExtents, this.pos, this.quat, this.createMaterial( 0xB03014 ) );

    // Tower 2
    this.pos.set( 8, 5, 0 );
    this.quat.set( 0, 0, 0, 1 );
    this.createObject( towerMass, towerHalfExtents, this.pos, this.quat, this.createMaterial( 0xB03214 ) );

    //Bridge
    const bridgeMass = 100;
    const bridgeHalfExtents = new Vector3( 7, 0.2, 1.5 );
    this.pos.set( 0, 10.2, 0 );
    this.quat.set( 0, 0, 0, 1 );
    this.createObject( bridgeMass, bridgeHalfExtents, this.pos, this.quat, this.createMaterial( 0xB3B865 ) );

    // Stones
    const stoneMass = 120;
    const stoneHalfExtents = new Vector3( 1, 2, 0.15 );
    const numStones = 8;
    this.quat.set( 0, 0, 0, 1 );
    for ( let i = 0; i < numStones; i ++ ) {
      this.pos.set( 0, 2, 15 * ( 0.5 - i / ( numStones + 1 ) ) );
      this.createObject( stoneMass, stoneHalfExtents, this.pos, this.quat, this.createMaterial( 0xB0B0B0 ) );

    }

    // Mountain
    const mountainMass = 860;
    const mountainHalfExtents = new Vector3( 4, 5, 4 );
    this.pos.set( 5, mountainHalfExtents.y * 0.5, - 7 );
    this.quat.set( 0, 0, 0, 1 );
    const mountainPoints = [];
    mountainPoints.push( new Vector3( mountainHalfExtents.x, - mountainHalfExtents.y, mountainHalfExtents.z ) );
    mountainPoints.push( new Vector3( - mountainHalfExtents.x, - mountainHalfExtents.y, mountainHalfExtents.z ) );
    mountainPoints.push( new Vector3( mountainHalfExtents.x, - mountainHalfExtents.y, - mountainHalfExtents.z ) );
    mountainPoints.push( new Vector3( - mountainHalfExtents.x, - mountainHalfExtents.y, - mountainHalfExtents.z ) );
    mountainPoints.push( new Vector3( 0, mountainHalfExtents.y, 0 ) );
    const mountain = new Mesh( new ConvexGeometry( mountainPoints ), this.createMaterial( 0xB03814 ) );
    mountain.position.copy( this.pos );
    mountain.quaternion.copy( this.quat );
    this.ammoHandler.prepareBreakableObject( mountain, mountainMass, new Vector3(), new Vector3(), true );
  }

  createParalellepipedWithPhysics( sx, sy, sz, mass, pos, quat, material ) {
    const object = new Mesh( new BoxGeometry( sx, sy, sz, 1, 1, 1 ), material );
    this.ammoHandler.createRigidBody2( sx, sy, sz, object, mass, pos, quat );
    return object;
  }

  private createRandomColor() {
    return Math.floor( Math.random() * ( 1 << 24 ) );
  }

  private createMaterial( color ) {
    color = color || this.createRandomColor();
    return new MeshPhongMaterial( { color: color } );
  }

  update() {
    const deltaTime = this.clock.getDelta();
    this.ammoHandler.updatePhysics( deltaTime );
  }

  updateHandPose(result) {
    if (this.handPoseManager2) {
      let offset = new Vector3(0, 10, 20);
      this.handPoseManager2.renderHands(result, offset);
      if (this.handPoseManager2.isOpenHand()) {
        this.fire(offset);
      }
    }
  }

  handleGesture(gesture: HandTrackingResult) {
    if (gesture.gestureType == GestureType.Open_Hand) {
      this.fire(gesture.position);
    }
  }

  private fire(pos: Vector3) {
    const ballRadius = 0.4;
    const ballMaterial = new MeshPhongMaterial( { color: 0x202020 } );
    const ball = new Mesh( new SphereGeometry( ballRadius, 14, 10 ), ballMaterial );
    ball.castShadow = true;
    ball.receiveShadow = true;
    ball.position.add(pos);
    this.scene.add(ball);
    this.ammoHandler.fire(ball, ballRadius)
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 11, 22);
  }
}
