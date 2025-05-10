import {
  BoxGeometry, BufferAttribute, CylinderGeometry, DoubleSide, Group, InterleavedBufferAttribute, Mesh, MeshLambertMaterial,
  MeshPhongMaterial, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Scene,
  SphereGeometry, SRGBColorSpace,
  TextureLoader, Vector2,
  Vector3,
  WebGLRenderer
} from 'three/src/Three';
import PhysicsHandler from '../../../../shared/physics/cannon/PhysicsHandler';
import SceneManagerParent from '../../../../shared/scene/SceneManagerParent';
import HandPoseWithoutPhysicsManager from "../../../../shared/hands/HandPoseWithoutPhysicsManager";
import {GestureType, HandTrackingResult} from "../../../../shared/scene/SceneManagerInterface";
import {ConvexGeometry} from "three/examples/jsm/geometries/ConvexGeometry";
import Perlin from './perlin';

// Seed value is optional, default is 0.
const seed = Math.random();
const noise = new Perlin(seed);
let time = 0;

export default class SceneManager extends SceneManagerParent {
  private handPoseManager2: HandPoseWithoutPhysicsManager;

  // Ground
  private pos = new Vector3();
  private pos2: BufferAttribute | InterleavedBufferAttribute;
  private quat = new Quaternion();
  private textureLoader = new TextureLoader();
  private flag: Mesh;
  private flagGeom: PlaneGeometry;
  private v = new Vector3();
  private flagMat: MeshStandardMaterial;
  private ship: Mesh;
  private plank: Mesh;
  private group = new Group();
  private animation: boolean = true;
  private canFire = true;

  build(camera: PerspectiveCamera, scene: Scene, renderer: WebGLRenderer, physicsHandler: PhysicsHandler) {
    super.build(camera, scene, renderer, physicsHandler);

    this.handPoseManager2 = new HandPoseWithoutPhysicsManager(this.scene);

    this.ammoHandler.init()
        .then(() => {
      this.createObjects();
    })

    this.sceneHelper.addLight(true);
  }

  createObject( mass, halfExtents, pos, quat, material ): Mesh {
    const object = new Mesh( new BoxGeometry( halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2 ), material );
    object.position.copy( pos );
    object.quaternion.copy( quat );
    this.ammoHandler.prepareBreakableObject( object, mass, new Vector3(), new Vector3(), true );
    return object;
  }

  createObject2( mass, halfExtents, pos, quat, material , parent: Group): Mesh {
    const object = new Mesh( new BoxGeometry( halfExtents.x * 2, halfExtents.y * 2, halfExtents.z * 2 ), material );
    //parent.add(object);
    object.parent = parent;
    object.position.copy( pos );
    object.quaternion.copy( quat );
    // object.position.copy( parent.position );
    // object.quaternion.copy( parent.quaternion );
    this.ammoHandler.prepareBreakableObject3( object, parent, mass, new Vector3(), new Vector3(), true );
    return object;
  }

  createCylinder(mass, halfExtents, pos, quat, material ) {
    const object = new Mesh( new CylinderGeometry( halfExtents.x * 2, halfExtents.x * 2, halfExtents.y ), material );
    object.position.copy( pos );
    object.quaternion.copy( quat );
    this.ammoHandler.prepareBreakableObject2( object, mass, new Vector3(), new Vector3(), false );
  }

  createObjects() {
    // Ground
    this.pos.set( 0, - 1, 0 );
    this.quat.set( 0, 0, 0, 1 );
    const ground = this.createParalellepipedWithPhysics( 40, 0.5, 40, 0, this.pos, this.quat, new MeshPhongMaterial( { color: 0xFFFFFF } ) );
    ground.receiveShadow = true;
    this.textureLoader.load( '/textures/grid.png', function ( texture ) {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.repeat.set( 40, 40 );
      ground.material.map = texture;
      ground.material.needsUpdate = true;
    } );

    // Ship keel
    const shipMass = 100;
    const shipHalfExtents = new Vector3( 0, 0, 0 );
    this.pos.set( 1, shipHalfExtents.y * 0.5, - 1 );
    this.quat.set( 0, 0, 0, 1 );
    let shipPoints = [];
    const keelLength = 30;
    const keelWidth = 0.5;
    shipPoints.push( new Vector3( -keelLength/2, 1, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2, 1, -keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2, 0, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2, 0, -keelWidth/2) );

    shipPoints.push( new Vector3( keelLength/2, 1, keelWidth/2) );
    shipPoints.push( new Vector3( keelLength/2, 1, -keelWidth/2) );
    shipPoints.push( new Vector3( keelLength/2, 0, keelWidth/2) );
    shipPoints.push( new Vector3( keelLength/2, 0, -keelWidth/2) );

    const baseMaterial = new MeshPhongMaterial( { color: 0x606060 } );
    let ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );

    this.ship = ship;

    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );

    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2, 0.5, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2+1, 0.5, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2, 3, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 3, 5) );

    shipPoints.push( new Vector3( -keelLength/2, 1, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2+1, 1, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2, 3.5, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 3.5, 5) );

    ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );
    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );
    this.ship.add(ship);
    this.group.add(this.ship);

    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2, 3, -5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 3, -5) );
    shipPoints.push( new Vector3( -keelLength/2, 3.5, -5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 3.5, -5) );
    shipPoints.push( new Vector3( -keelLength/2, 5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2, 5, -6) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5, -6) );

    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2, 5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2, 5, -6) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5, -6) );

    shipPoints.push( new Vector3( -keelLength/2, 3, -5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 3, -5) );
    shipPoints.push( new Vector3( -keelLength/2, 3.5, -5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 3.5, -5) );

    ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );
    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );

    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2, 5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2, 5.5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5.5, -6.5) );

    shipPoints.push( new Vector3( -keelLength/2, 5, 0) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5, 0) );
    shipPoints.push( new Vector3( -keelLength/2, 5.5, 0) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5.5, 0) );

    ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );
    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );


    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2, 5.5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5.5, -6.5) );
    shipPoints.push( new Vector3( -keelLength/2, 5.5, -6) );
    shipPoints.push( new Vector3( -keelLength/2+1, 5.5, -6) );

    shipPoints.push( new Vector3( -keelLength/2, 7, -5.5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 7, -5.5) );
    shipPoints.push( new Vector3( -keelLength/2, 7, -5) );
    shipPoints.push( new Vector3( -keelLength/2+1, 7, -5) );

    ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );
    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );

    shipPoints = [];
    let ribDistance = 10;
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 0.5, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 0.5, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 3, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 3, 5) );

    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 1, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 1, keelWidth/2) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 3.5, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 3.5, 5) );

    ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );
    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );

    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 3, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 3, 5) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 3.5, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 3.5, 5) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5, 6) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5, 6) );

    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5, 6) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5, 6) );

    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 3, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 3, 5) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 3.5, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 3.5, 5) );

    ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );
    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );

    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5.5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5.5, 6.5) );

    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5, 0) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5, 0) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5.5, 0) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5.5, 0) );

    ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );
    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );


    shipPoints = [];
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5.5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5.5, 6.5) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 5.5, 6) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 5.5, 6) );

    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 7, 5.5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 7, 5.5) );
    shipPoints.push( new Vector3( -keelLength/2 + ribDistance, 7, 5) );
    shipPoints.push( new Vector3( -keelLength/2+1 + ribDistance, 7, 5) );

    ship = new Mesh( new ConvexGeometry( shipPoints ), baseMaterial); // this.createMaterial( 0xB03814 ) );
    ship.position.copy( this.pos );
    ship.quaternion.copy( this.quat );
    this.ammoHandler.createParalellepiped2(ship, 5, 0.2, 1, 0, this.pos, this.quat, baseMaterial );

    //



    const stoneMass = 50;
    let stoneHalfExtents = new Vector3( 2, 2.3, 0.1 );
    this.quat.set( 0, 0, 0, 1 );
    // this.quat.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI/2);
    // this.pos.set( -3.7, -7.5, 5.7 );
    this.pos.set( -3.7, 5.7, 5.7 );
    // this.plank = this.createObject(stoneMass, stoneHalfExtents, this.pos, this.quat, this.createMaterial(0xB0B0B0));
    this.plank = this.createObject2(stoneMass, stoneHalfExtents, this.pos, this.quat, this.createMaterial(0xB0B0B0), this.group);

    // this.group = new Group();
    this.group.add(this.plank);

    // The cloth
    // Cloth graphic object
    const clothWidth = 4;
    const clothHeight = 6;
    const clothNumSegmentsZ = clothWidth * 5;
    const clothNumSegmentsY = clothHeight * 5;
    const clothPos = new Vector3( -15, 0, -15 );

    const clothGeometry = new PlaneGeometry( clothWidth, clothHeight, clothNumSegmentsZ, clothNumSegmentsY );
    clothGeometry.translate( clothPos.x, clothPos.y + clothHeight * 0.5, clothPos.z - clothWidth * 0.5 );
    // clothGeometry.rotateY(-Math.PI/4);
    // clothGeometry.rotateZ(-Math.PI/4);

    const clothMaterial = new MeshLambertMaterial( { color: 0xFFFFFF, side: DoubleSide } );
    let cloth = new Mesh( clothGeometry, clothMaterial );
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    this.scene.add( cloth );
    this.textureLoader.load( '/textures/Prinsenvlag.svg.png', texture => {

      texture.colorSpace = SRGBColorSpace;
      // texture.rotation = Math.PI/2;
      texture.center = new Vector2(0.5, 0.5);
      cloth.material.map = texture;
      cloth.material.needsUpdate = true;

    });
    this.ammoHandler.createCloth(cloth, clothPos, clothHeight, clothWidth, clothNumSegmentsZ, clothNumSegmentsY);
    // cloth.rotation.z = Math.PI / 2;

    this.flagGeom = new PlaneGeometry(4, 2, 40, 20);
    this.flagGeom.translate(2, 1, 0);
    this.pos2 = this.flagGeom.attributes.position;
    this.flagGeom.userData = {
      init: []
    }
    for(let i = 0; i < this.pos2.count; i++){
      this.flagGeom.userData.init.push(new Vector3().fromBufferAttribute(this.pos2, i));
    }
    this.flag = new Mesh( this.flagGeom, clothMaterial);
    this.scene.add(this.flag);
    //this.flag.rotation.x = degToRad(-18);
    // this.flag.rotation.y = - Math.PI;
    this.flag.position.set(0,3,5);

    this.scene.add(this.group);
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
    const time2 = performance.now() * 0.001;

    if (this.ship) {
      // this.ship.rotation.x = Math.sin(time2) * 0.02 - Math.PI/2;
      // this.ship.rotation.y = Math.sin(time2) * 0.02;

      // this.plank.quaternion.copy(this.ship.quaternion);
      // this.plank.matrixWorldNeedsUpdate = true;
      // this.plank.rotation.x = Math.sin(time2) * 0.02 - Math.PI/2;
      // this.plank.rotation.y = Math.sin(time2) * 0.02;
    }
    if (this.group && this.animation) {
      this.group.rotation.x = Math.sin(time2) * 0.2 - Math.PI/2;
      this.group.rotation.y = Math.sin(time2) * 0.2;
      this.group.position.x = Math.cos(time2) * 10;
    }


    const deltaTime = this.clock.getDelta();

    time += deltaTime;
    if (this.animation) {
      let hit = this.ammoHandler.updatePhysics(deltaTime);
      if (hit) {
        // this.animation = false;
      }
    }

    // TODO: refactor shader to separate class
    if (this.flagGeom) {
      this.flagGeom.userData.init.forEach((vi, idx) => {

        this.v.copy(vi);
        let yFade = Math.sin(this.v.y / this.flagGeom.parameters.height * Math.PI) * 0.25;
        this.v.x = this.v.x + yFade;
        let xFade = (this.v.x / this.flagGeom.parameters.width);
         this.v.z = noise.perlin2((this.v.x - (time * 2)) / this.flagGeom.parameters.width * 4, this.v.y / this.flagGeom.parameters.height * 2) * xFade;

        this.pos2.setXYZ(idx, this.v.x, this.v.y, this.v.z);
        // this.pos2.set(this.v.x, this.v.y, this.v.z);
      });
      this.flagGeom.computeVertexNormals();
      this.pos2.needsUpdate = true;
      // this.flagMat.needsUpdate = true;
    }
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
      if (this.canFire) {
        this.fire(gesture.position);
        this.canFire = false;
        setTimeout(() => {
              this.canFire = true;
            }, 1000
        )
      }
    }
  }

  private fire(pos: Vector3) {
    const ballRadius = 0.2;
    const ballMaterial = new MeshPhongMaterial( { color: 0x202020 } );
    const ball = new Mesh( new SphereGeometry( ballRadius, 14, 10 ), ballMaterial );
    ball.castShadow = true;
    ball.receiveShadow = true;
    ball.position.add(pos);
    this.scene.add(ball);
    const position2 = new Vector3(pos.x, pos.y, pos.z);
    const position = new Vector3(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    let direction = position2.sub(position);
    this.ammoHandler.fire(ball, ballRadius, direction)
  }

  getInitialCameraPosition(): Vector3 {
    return new Vector3(0, 11, 22);
  }
}
