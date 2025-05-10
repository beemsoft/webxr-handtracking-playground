import {
    BoxGeometry,
    BufferGeometry,
    Color,
    Mesh,
    MeshBasicMaterial,
    MeshPhongMaterial,
    Quaternion,
    Scene,
    Vector3
} from "three/src/Three";
import * as Ammo from 'ammo.js';
import {ConvexObjectBreaker} from "three/examples/jsm/misc/ConvexObjectBreaker";
import {Object3D} from "three";

// Physics variables
const gravityConstant = 7.8;
const margin = 0.05;

const BODYFLAG_RESPONSE_OBJECT = 0;
const BODYFLAG_STATIC_OBJECT = 1;
const BODYFLAG_KINEMATIC_OBJECT = 2;
const BODYFLAG_NORESPONSE_OBJECT = 4;

const BODYSTATE_DISABLE_DEACTIVATION = 4;

export default class AmmoHandler {
    private scene: Scene;
    private physicsWorld;
    private convexBreaker: ConvexObjectBreaker;
    private tempBtVec3_1;
    private transformAux1;
    // Rigid bodies include all movable objects
    private rigidBodies = [];
    private dispatcher: Ammo.btCollisionDispatcher;
    private impactPoint = new Vector3();
    private impactNormal = new Vector3();
    private objectsToRemove = [];
    private numObjectsToRemove = 0;
    private clothMesh: Mesh;
    private armBody: Ammo.btRigidBody;
    private hinge: Ammo.btHingeConstraint;
    private movableMesh: Mesh;

    constructor(scene: Scene) {
        this.scene = scene;
        this.convexBreaker = new ConvexObjectBreaker();

        for ( let i = 0; i < 500; i ++ ) {
            this.objectsToRemove[ i ] = null;
        }
    }

    init() {
        return Ammo()
            .then(  ( AmmoLib ) => {
            // @ts-ignore
            Ammo = AmmoLib;
            let collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
            this.dispatcher = new Ammo.btCollisionDispatcher( collisionConfiguration );
            let broadphase = new Ammo.btDbvtBroadphase();
            let solver = new Ammo.btSequentialImpulseConstraintSolver();
            const softBodySolver = new Ammo.btDefaultSoftBodySolver();
            this.physicsWorld = new Ammo.btSoftRigidDynamicsWorld( this.dispatcher, broadphase, solver, collisionConfiguration, softBodySolver );
            this.physicsWorld.setGravity( new Ammo.btVector3( 0, - gravityConstant, 0 ) );
            this.physicsWorld.getWorldInfo().set_m_gravity( new Ammo.btVector3( 0, gravityConstant, 0 ) );
            this.transformAux1 = new Ammo.btTransform();
            this.tempBtVec3_1 = new Ammo.btVector3( 0, 0, 0 );
        } );
    }

    prepareBreakableObject(object: Object3D, mass, vector3: Vector3, vector32: Vector3, breakable: boolean) {
        // @ts-ignore
        if (object.parent && object.parent.isGroup) {
            console.log('add breakable object with group');
            this.convexBreaker.prepareBreakableObject( object.parent, mass, new Vector3(), new Vector3(), breakable );
        } else {
            this.convexBreaker.prepareBreakableObject(object, mass, new Vector3(), new Vector3(), breakable);
        }
        this.createDebrisFromBreakableObject(object, breakable ? BODYFLAG_KINEMATIC_OBJECT : BODYFLAG_STATIC_OBJECT, breakable);
    }

    prepareBreakableObject2(object: Object3D, mass, vector3: Vector3, vector32: Vector3, breakable: boolean) {
        this.convexBreaker.prepareBreakableObject( object, mass, new Vector3(), new Vector3(), breakable );
        this.createDebrisFromBreakableObject2( object, BODYFLAG_RESPONSE_OBJECT, false );
    }

    prepareBreakableObject3(object: Object3D, parent: Object3D, mass, vector3: Vector3, vector32: Vector3, breakable: boolean) {
        console.log(object);
        // @ts-ignore
        if (object.parent && object.parent.isGroup) {
            console.log('add breakable object with group');
            this.convexBreaker.prepareBreakableObject( object, mass, new Vector3(), new Vector3(), breakable );
        } else {
            this.convexBreaker.prepareBreakableObject(object, mass, new Vector3(), new Vector3(), breakable);
        }
        this.createDebrisFromBreakableObject(object, breakable ? BODYFLAG_KINEMATIC_OBJECT : BODYFLAG_STATIC_OBJECT, breakable);
    }

    private createDebrisFromBreakableObject2( object, bodyFlag, disableDeactivation: boolean ) {

        object.castShadow = true;
        object.receiveShadow = true;

        // object.position.y = 15;

        const shape = this.createConvexHullPhysicsShape( object.geometry.attributes.position.array );
        shape.setMargin( margin );

        const body = this.createRigidBody( object, shape, object.userData.mass, null, null, object.userData.velocity, object.userData.angularVelocity );

        // Set pointer back to the three object only in the debris objects
        const btVecUserData = new Ammo.btVector3( 0, 0, 0 );
        btVecUserData.threeObject = object;
        body.setUserPointer( btVecUserData );
        // body.setCollisionFlags(body.getCollisionFlags() | BODYFLAG_KINEMATIC_OBJECT);
        if (disableDeactivation) {
             body.setActivationState(BODYSTATE_DISABLE_DEACTIVATION);
        }
        body.setCollisionFlags(body.getCollisionFlags() | bodyFlag);
        // body.setActivationState(BODYSTATE_DISABLE_DEACTIVATION);
        console.log(body);
        body.setWorldTransform();
        // body.position.y = 5;
    }

    private createDebrisFromBreakableObject( object, bodyFlag, disableDeactivation: boolean ) {

        object.castShadow = true;
        object.receiveShadow = true;

        // object.position.y = 7;

        const shape = this.createConvexHullPhysicsShape( object.geometry.attributes.position.array );
        shape.setMargin( margin );

        const body = this.createRigidBody( object, shape, object.userData.mass, null, null, object.userData.velocity, object.userData.angularVelocity );

        // Set pointer back to the three object only in the debris objects
        const btVecUserData = new Ammo.btVector3( 0, 0, 0 );
        btVecUserData.threeObject = object;
        body.setUserPointer( btVecUserData );
        // body.setCollisionFlags(body.getCollisionFlags() | BODYFLAG_KINEMATIC_OBJECT);
        if (disableDeactivation) {
            body.setActivationState(BODYSTATE_DISABLE_DEACTIVATION);
        }
        body.setCollisionFlags(body.getCollisionFlags() | bodyFlag);
        // body.setActivationState(BODYSTATE_DISABLE_DEACTIVATION);


        // body.position.y = 5;
    }

    private createConvexHullPhysicsShape( coords ) {
        const shape = new Ammo.btConvexHullShape();
        for ( let i = 0, il = coords.length; i < il; i += 3 ) {
            this.tempBtVec3_1.setValue( coords[ i ], coords[ i + 1 ], coords[ i + 2 ] );
            const lastOne = ( i >= ( il - 3 ) );
            shape.addPoint( this.tempBtVec3_1, lastOne );
        }
        return shape;
    }

    createRigidBody( object, physicsShape, mass, pos, quat, vel, angVel ) {
        if ( pos ) {
            object.position.copy( pos );
        } else {
            pos = object.position;
        }
        if ( quat ) {
            object.quaternion.copy( quat );
        } else {
            quat = object.quaternion;
        }
        if (object.parent && object.parent.isGroup) {
            console.log('add rigid body with group');
        }

        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin( new Ammo.btVector3( pos.x, pos.y, pos.z ) );
        transform.setRotation( new Ammo.btQuaternion( quat.x, quat.y, quat.z, quat.w ) );
        const motionState = new Ammo.btDefaultMotionState( transform );

        const localInertia = new Ammo.btVector3( 0, 0, 0 );
        physicsShape.calculateLocalInertia( mass, localInertia );

        const rbInfo = new Ammo.btRigidBodyConstructionInfo( mass, motionState, physicsShape, localInertia );
        const body = new Ammo.btRigidBody( rbInfo );

        body.setFriction( 0.5 );

        if ( vel ) {
            body.setLinearVelocity( new Ammo.btVector3( vel.x, vel.y, vel.z ) );
        }
        if ( angVel ) {
            body.setAngularVelocity( new Ammo.btVector3( angVel.x, angVel.y, angVel.z ) );
        }

        object.userData.physicsBody = body;
        object.userData.collided = false;
        this.scene.add( object );
        if ( mass > 0 ) {
            this.rigidBodies.push( object );
            // Disable deactivation
          //  body.setActivationState( BODYSTATE_DISABLE_DEACTIVATION );
        }
        this.physicsWorld.addRigidBody( body );
        return body;
    }

    createRigidBody2(sx, sy, sz, object, mass, pos, quat ) {
        const shape = new Ammo.btBoxShape( new Ammo.btVector3( sx * 0.5, sy * 0.5, sz * 0.5 ) );
        shape.setMargin( margin );

        // @ts-ignore
        return this.createRigidBody( object, shape, mass, pos, quat );
    }

    updatePhysics( deltaTime ): boolean {
        let hit = false;
        if (this.physicsWorld) {
        // Step world
        this.physicsWorld.stepSimulation( deltaTime, 10 );

            // Update cloth
            if (this.clothMesh) {
                this.hinge.enableAngularMotor( true, 0, 50 );
                const softBody = this.clothMesh.userData.physicsBody;

                const clothPositions = this.clothMesh.geometry.attributes.position.array;
                const numVerts = clothPositions.length / 3;
                const nodes = softBody.get_m_nodes();
                let indexFloat = 0;

                for (let i = 0; i < numVerts; i++) {

                    const node = nodes.at(i);
                    const nodePos = node.get_m_x();
                    clothPositions[indexFloat++] = nodePos.x();
                    clothPositions[indexFloat++] = nodePos.y();
                    clothPositions[indexFloat++] = nodePos.z();

                }

                this.clothMesh.geometry.computeVertexNormals();
                this.clothMesh.geometry.attributes.position.needsUpdate = true;
                this.clothMesh.geometry.attributes.normal.needsUpdate = true;

                // Update rigid bodies
                   for (let i = 0, il = this.rigidBodies.length; i < il; i++) {

                    const objThree = this.rigidBodies[i];
                    let p = this.transformAux1.getOrigin();
                    if (objThree.userData.movableMesh) {
                        console.log('rigid body is movable 1')

                        const objPhys = objThree.userData.physicsBody;
                        const ms = objPhys.getMotionState();
                        if (ms) {
                            ms.getWorldTransform(this.transformAux1);
                            let p = this.transformAux1.getOrigin();
                            const q = this.transformAux1.getRotation();
                            if (objThree.userData.movableMesh) {
                                console.log('rigid body is movable 2')
                            }
                            p = objThree.userData.movableMesh.position;
                            objThree.position.set(p.x, p.y, p.z);
                            // }
                            objThree.quaternion.set(q.x(), q.y(), q.z(), q.w());
                            objThree.userData.collided = false;
                        }
                    } else {
                        const objPhys = objThree.userData.physicsBody;
                        const ms = objPhys.getMotionState();
                        if (ms) {
                            ms.getWorldTransform(this.transformAux1);
                            let p = this.transformAux1.getOrigin();
                            const q = this.transformAux1.getRotation();
                            if (objThree.userData.movableMesh) {
                                console.log('rigid body is movable 2')
                            }

                            objThree.position.set(p.x(), p.y(), p.z());
                            objThree.quaternion.set(q.x(), q.y(), q.z(), q.w());
                            objThree.userData.collided = false;
                        }
                    }
                }

            }

            // Update movable rigid bodies position/rotation
            for (let i = 0; i < this.rigidBodies.length; i ++) {
                if (this.rigidBodies[i].parent && this.rigidBodies[i].parent.isGroup) {
                    // console.log(this.rigidBodies[i].userData.physicsBody.getWorldTransform());
                    let pos2 = this.rigidBodies[i].position;
                    let quat2 = this.rigidBodies[i].quaternion;
                    if (!this.movableMesh) {
                        this.movableMesh = new Mesh(
                            new BoxGeometry( 2, 2.3, 0.1, 8, 8, 1 ),
                            new MeshBasicMaterial( { color: Color.NAMES.red, transparent: false, wireframe: true, opacity: 0 } )
                        );
                        this.movableMesh.position.copy(pos2);
                        this.movableMesh.quaternion.copy(quat2);
                        this.scene.add(this.movableMesh);
                        console.log('Add shadow box');
                        this.rigidBodies[i].userData.movableMesh = this.movableMesh;
                        console.log(this.rigidBodies[i]);
                    } else {
                        let quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI/2);
                        // quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI/2.1));
                        // let q2 = this.rigidBodies[i].parent.quaternion.multiply(quat);
                        // const q = new Ammo.btQuaternion(q2.x, q2.y, q2.z, q2.w);
                        // worldTrans.setRotation(q)
                        // this.movableMesh.position.copy(this.rigidBodies[i].parent.position).add(this.rigidBodies[i].position);
                         this.movableMesh.position.copy(this.rigidBodies[i].parent.position);                    /** This moves the mesh to rigid body parent position **/
                         this.movableMesh.quaternion.copy(this.rigidBodies[i].parent.quaternion);                /** This rotates the mesh to rigid body parent quaternion, but mesh is now invisible (inside other moving mesh) **/
                        // this.rigidBodies[i].position.copy(this.movableMesh.parent.position);
                        // worldTrans.setOrigin(this.movableMesh.position);
                        // Works for Dynamic, but not for Kinematic bodies
                        const worldTrans = new Ammo.btTransform();
                        worldTrans.setIdentity();
                        worldTrans.setOrigin( new Ammo.btVector3( this.movableMesh.position.x, this.movableMesh.position.y, this.movableMesh.position.z ) );
                        let q2 = this.movableMesh.quaternion;
                        worldTrans.setRotation(new Ammo.btQuaternion(q2.x, q2.y, q2.z, q2.w));                   /** This applies rotation **/
                        // this.rigidBodies[i].userData.physicsBody.setWorldTransform(worldTrans);
                        //this.rigidBodies[i].userData.movableMesh = { dummy: true };
                        // this.rigidBodies[i].userData.movableMesh = this.movableMesh;
                        let p = this.movableMesh.parent.position;
// Works for Kinematic, but not for Dynamic bodies
                        this.rigidBodies[i].userData.physicsBody.getMotionState().setWorldTransform(worldTrans);  /** This moves the rigid body **/
                        this.rigidBodies[i].position.set(p.x, p.y, p.z);                                          /** This moves the rigid body **/
//                         this.rigidBodies[i].userData.physicsBody.setWorldTransform();
                    }



                }
            }

        for ( let i = 0, il = this.dispatcher.getNumManifolds(); i < il; i ++ ) {


            const contactManifold = this.dispatcher.getManifoldByIndexInternal(i);
            const rb0 = Ammo.castObject(contactManifold.getBody0(), Ammo.btRigidBody);
            const rb1 = Ammo.castObject(contactManifold.getBody1(), Ammo.btRigidBody);

            const threeObject0 = Ammo.castObject(rb0.getUserPointer(), Ammo.btVector3).threeObject;
            const threeObject1 = Ammo.castObject(rb1.getUserPointer(), Ammo.btVector3).threeObject;

            if (!threeObject0 && !threeObject1) {
                continue;
            }

            const userData0 = threeObject0 ? threeObject0.userData : null;
            const userData1 = threeObject1 ? threeObject1.userData : null;

            const breakable0 = true; //  userData0 ? userData0.breakable : false;
            const breakable1 = true; //  = userData1 ? userData1.breakable : false;

            const collided0 = userData0 ? userData0.collided : false;
            const collided1 = userData1 ? userData1.collided : false;

            if ((!breakable0 && !breakable1) || (collided0 && collided1)) {
                continue;
            }

            let contact = false;
            let maxImpulse = 0;
            for (let j = 0, jl = contactManifold.getNumContacts(); j < jl; j++) {

                const contactPoint = contactManifold.getContactPoint(j);

                if (contactPoint.getDistance() < 0) {

                    contact = true;
                    const impulse = contactPoint.getAppliedImpulse();

                    if (impulse > maxImpulse) {
                        maxImpulse = impulse;
                        const pos = contactPoint.get_m_positionWorldOnB();
                        const normal = contactPoint.get_m_normalWorldOnB();
                        this.impactPoint.set(pos.x(), pos.y(), pos.z());
                        this.impactNormal.set(normal.x(), normal.y(), normal.z());
                    }

                    break;
                }
            }

            // If no point has contact, abort
            if (!contact) continue;

            // Subdivision

            const fractureImpulse = 250;

            if (threeObject0 && breakable0 && !collided0 && maxImpulse > fractureImpulse) {
                console.log('break object 0');
                console.log(threeObject0);
                const objPhys = threeObject0.userData.physicsBody;
                const ms = objPhys.getMotionState();
                if (ms) {
                    ms.getWorldTransform(this.transformAux1);
                    let p = this.transformAux1.getOrigin();
                    p = threeObject0.userData.movableMesh.position;
                    const q = this.transformAux1.getRotation();
                    let breakingMesh = new Mesh(
                        new BoxGeometry( 2, 2.3, 0.1, 8, 8, 1 ),
                        new MeshBasicMaterial( { color: Color.NAMES.blue, transparent: false, wireframe: true, opacity: 0 } )
                    );
                    breakingMesh.position.set(p.x, p.y, p.z);
                    breakingMesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
                    this.scene.add(breakingMesh);
                    console.log('Add breaking mesh');
                    threeObject0.position.set(p.x, p.y, p.z);
                    threeObject0.quaternion.set(q.x(), q.y(), q.z(), q.w());
                    threeObject0.rotation.needsUpdate = true;
                    threeObject0.position.needsUpdate = true;
                 }

                // @ts-ignore
                const debris = this.convexBreaker.subdivideByImpact(threeObject0, this.impactPoint, this.impactNormal, 1, 2, 1.5);
                const numObjects = debris.length;
                for (let j = 0; j < numObjects; j++) {

                    const vel = rb0.getLinearVelocity();
                    const angVel = rb0.getAngularVelocity();
                    const fragment = debris[j];
                    fragment.userData.velocity.set(vel.x(), vel.y(), vel.z());
                    fragment.userData.angularVelocity.set(angVel.x(), angVel.y(), angVel.z());

                    this.createDebrisFromBreakableObject(fragment, BODYFLAG_RESPONSE_OBJECT, true);
                }

                this.objectsToRemove[this.numObjectsToRemove++] = threeObject0;
                userData0.collided = true;
                hit = true;
                // threeObject0.material.color = Color.NAMES.blue;
            }

            if (threeObject1 && breakable1 && !collided1 && maxImpulse > fractureImpulse) {
                console.log('break object 1');
                console.log(threeObject1);
                const objPhys = threeObject1.userData.physicsBody;
                // const ms = objPhys.getMotionState();
                // if (ms) {
                objPhys.getWorldTransform(this.transformAux1);
                const p = this.transformAux1.getOrigin();
                const q = this.transformAux1.getRotation();
                threeObject1.position.set(p.x(), p.y(), p.z());
                threeObject1.quaternion.set(q.x(), q.y(), q.z(), q.w());
                threeObject1.rotation.needsUpdate = true;
                threeObject1.position.needsUpdate = true;

                // @ts-ignore
                const debris = this.convexBreaker.subdivideByImpact(threeObject1, this.impactPoint, this.impactNormal, 1, 2, 1.5);

                const numObjects = debris.length;
                for (let j = 0; j < numObjects; j++) {

                    const vel = rb1.getLinearVelocity();
                    const angVel = rb1.getAngularVelocity();
                    const fragment = debris[j];
                    fragment.userData.velocity.set(vel.x(), vel.y(), vel.z());
                    fragment.userData.angularVelocity.set(angVel.x(), angVel.y(), angVel.z());

                    this.createDebrisFromBreakableObject(fragment, BODYFLAG_RESPONSE_OBJECT, true);
                }

                this.objectsToRemove[this.numObjectsToRemove++] = threeObject1;
                userData1.collided = true;
                hit = true;
            }
        }

        }

        for ( let i = 0; i < this.numObjectsToRemove; i ++ ) {
            this.removeDebris( this.objectsToRemove[ i ] );
        }

        this.numObjectsToRemove = 0;

        return hit;

    }

    removeDebris( object ) {
        // object.color = Color.NAMES.blue;
        if (object.parent.isGroup) {
            object.removeFromParent();  // TODO: Document this fix
            this.scene.remove(this.movableMesh);
        }
        this.scene.remove( object );
        this.physicsWorld.removeRigidBody( object.userData.physicsBody );
    }

    fire(ball: Mesh, ballRadius: number, direction: Vector3) {
        const ballShape = new Ammo.btSphereShape( ballRadius );
        ballShape.setMargin( margin );
        const ballMass = 35;
        // this.pos.copy( raycaster.ray.direction );
        // this.pos.add( raycaster.ray.origin );
        // this.quat.set( 0, 0, 0, 1 );
        // @ts-ignore
        const ballBody = this.createRigidBody( ball, ballShape, ballMass, this.pos, this.quat );
        // const rndX = Math.floor(Math.random() * 15) - 7;
        // const rndY = Math.floor(Math.random() * 15) - 7;
        // let pos = new Vector3(rndX, rndY, -25);
        // this.pos.copy( raycaster.ray.direction );
        // this.pos.multiplyScalar( 24 );
        direction.multiplyScalar( 70 );
        console.log(direction);
        ballBody.setLinearVelocity( new Ammo.btVector3( direction.x, direction.y, direction.z ) );
    }

    createCloth(cloth: Mesh, clothPos: Vector3, clothHeight: number, clothWidth: number, clothNumSegmentsZ: number, clothNumSegmentsY: number) {
        this.clothMesh = cloth;
        // Cloth physic object
        const softBodyHelpers = new Ammo.btSoftBodyHelpers();
        const clothCorner00 = new Ammo.btVector3( clothPos.x, clothPos.y + clothHeight, clothPos.z );
        const clothCorner01 = new Ammo.btVector3( clothPos.x, clothPos.y + clothHeight, clothPos.z - clothWidth );
        const clothCorner10 = new Ammo.btVector3( clothPos.x, clothPos.y, clothPos.z );
        const clothCorner11 = new Ammo.btVector3( clothPos.x, clothPos.y, clothPos.z - clothWidth );
        const clothSoftBody = softBodyHelpers.CreatePatch( this.physicsWorld.getWorldInfo(), clothCorner00, clothCorner01, clothCorner10, clothCorner11, clothNumSegmentsZ + 1, clothNumSegmentsY + 1, 0, true );
        const sbConfig = clothSoftBody.get_m_cfg();
        sbConfig.set_viterations( 10 );
        sbConfig.set_piterations( 10 );

        clothSoftBody.setTotalMass( 0.9, false );
        Ammo.castObject( clothSoftBody, Ammo.btCollisionObject ).getCollisionShape().setMargin( margin * 3 );

        // clothSoftBody.setCollisionFlags(clothSoftBody.getCollisionFlags() | BODYFLAG_RESPONSE_OBJECT);
        this.physicsWorld.addSoftBody( clothSoftBody, 1, - 1 );
        cloth.userData.physicsBody = clothSoftBody;
        // Disable deactivation
        clothSoftBody.setActivationState( BODYSTATE_DISABLE_DEACTIVATION );

        const pos = new Vector3();
        let quat = new Quaternion(); // .setFromAxisAngle(new Vector3(0, 1, 0), Math.PI/2);
        // quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI/2.1));

        // The base
        const armMass = 2;
        const armLength = 5 + clothWidth;
        const pylonHeight = clothPos.y + clothHeight;
        const baseMaterial = new MeshPhongMaterial( { color: 0x606060 } );
        pos.set( clothPos.x, 0.1, clothPos.z - armLength );
        quat.set( 0, 0, 0, 1 );
        const base = this.createParalellepiped( 1, 0.2, 1, 0, pos, quat, baseMaterial );
        base.castShadow = true;
        base.receiveShadow = true;
        pos.set( clothPos.x, 0.5 * pylonHeight, clothPos.z - armLength );
        const pylon = this.createParalellepiped( 0.4, pylonHeight, 0.4, 0, pos, quat, baseMaterial );
        // pylon.castShadow = true;
        // pylon.receiveShadow = true;
        pos.set( clothPos.x, pylonHeight + 0.2, clothPos.z - 0.5 * armLength );
        quat = new Quaternion(); //.setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI/2);
        // quat.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI/2.1));
        const arm = this.createParalellepiped( 0.4, 0.4, armLength + 0.4, armMass, pos, quat, baseMaterial );
        // arm.castShadow = true;
        // arm.receiveShadow = true;

        // Glue the cloth to the arm
        const influence = 0.5;
        clothSoftBody.appendAnchor( 0, arm.userData.physicsBody, false, influence );
        clothSoftBody.appendAnchor( clothNumSegmentsZ, arm.userData.physicsBody, false, influence );
        // arm.rotation.x = Math.PI/2;
        // Hinge constraint to move the arm
        const pivotA = new Ammo.btVector3( 0, pylonHeight * 0.5, 0 );
        const pivotB = new Ammo.btVector3( 0, - 0.2, - armLength * 0.5 );
        const axis = new Ammo.btVector3( 0, 1, 0 );
        this.hinge = new Ammo.btHingeConstraint( pylon.userData.physicsBody, arm.userData.physicsBody, pivotA, pivotB, axis, axis, true );
        this.physicsWorld.addConstraint( this.hinge, true );
    }

    public createParalellepiped( sx, sy, sz, mass, pos, quat, material ) {

        const threeObject = new Mesh( new BoxGeometry( sx, sy, sz, 1, 1, 1 ), material );
        const shape = new Ammo.btBoxShape( new Ammo.btVector3( sx * 0.5, sy * 0.5, sz * 0.5 ) );
        shape.setMargin( margin );
        // threeObject.setRotationFromQuaternion(quat);

        this.createRigidBody3( threeObject, shape, mass, pos, quat );

        return threeObject;

    }

    public createParalellepiped2(threeObject: Mesh, sx, sy, sz, mass, pos, quat, material ) {

        // const threeObject = new Mesh( new BoxGeometry( sx, sy, sz, 1, 1, 1 ), material );
        const shape = new Ammo.btBoxShape( new Ammo.btVector3( sx * 0.5, sy * 0.5, sz * 0.5 ) );
        shape.setMargin( margin );
        // threeObject.setRotationFromQuaternion(quat);

        this.createRigidBody3( threeObject, shape, mass, pos, quat );

        return threeObject;

    }

    private createRigidBody3( threeObject, physicsShape, mass, pos, quat ) {

        threeObject.position.copy( pos );
        threeObject.quaternion.copy( quat );

        const transform = new Ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin( new Ammo.btVector3( pos.x, pos.y, pos.z ) );
        transform.setRotation( new Ammo.btQuaternion( quat.x, quat.y, quat.z, quat.w ) );
        const motionState = new Ammo.btDefaultMotionState( transform );

        const localInertia = new Ammo.btVector3( 0, 0, 0 );
       physicsShape.calculateLocalInertia( mass, localInertia );

        const rbInfo = new Ammo.btRigidBodyConstructionInfo( mass, motionState, physicsShape, localInertia );


        const body = new Ammo.btRigidBody( rbInfo );
        this.armBody = body;
        // body.setCollisionFlags(body.getCollisionFlags() | BODYFLAG_KINEMATIC_OBJECT);

        threeObject.userData.physicsBody = body;
        this.scene.add( threeObject );

        if ( mass > 0 ) {

            this.rigidBodies.push( threeObject );

            // Disable deactivation
             body.setActivationState( BODYSTATE_DISABLE_DEACTIVATION );
        }

        this.physicsWorld.addRigidBody( body );

    }
}
