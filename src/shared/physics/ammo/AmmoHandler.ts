import {Mesh, Scene, Vector3} from "three/src/Three";
import * as Ammo from 'ammo.js';
import {ConvexObjectBreaker} from "three/examples/jsm/misc/ConvexObjectBreaker";
import {Object3D} from "three";

// Physics variables
const gravityConstant = 7.8;
const margin = 0.05;

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
            // console.log(Ammo);
            console.log('Ammo loaded!');
            let collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
            this.dispatcher = new Ammo.btCollisionDispatcher( collisionConfiguration );
            let broadphase = new Ammo.btDbvtBroadphase();
            let solver = new Ammo.btSequentialImpulseConstraintSolver();
            this.physicsWorld = new Ammo.btDiscreteDynamicsWorld( this.dispatcher, broadphase, solver, collisionConfiguration );
            this.physicsWorld.setGravity( new Ammo.btVector3( 0, - gravityConstant, 0 ) );
            this.transformAux1 = new Ammo.btTransform();
            this.tempBtVec3_1 = new Ammo.btVector3( 0, 0, 0 );
        } );
    }

    prepareBreakableObject(object: Object3D, mass, vector3: Vector3, vector32: Vector3, b: boolean) {
        this.convexBreaker.prepareBreakableObject( object, mass, new Vector3(), new Vector3(), true );
        this.createDebrisFromBreakableObject( object );
    }

    private createDebrisFromBreakableObject( object ) {

        object.castShadow = true;
        object.receiveShadow = true;

        const shape = this.createConvexHullPhysicsShape( object.geometry.attributes.position.array );
        shape.setMargin( margin );

        const body = this.createRigidBody( object, shape, object.userData.mass, null, null, object.userData.velocity, object.userData.angularVelocity );

        // Set pointer back to the three object only in the debris objects
        const btVecUserData = new Ammo.btVector3( 0, 0, 0 );
        btVecUserData.threeObject = object;
        body.setUserPointer( btVecUserData );
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
            body.setActivationState( 4 );
        }
        this.physicsWorld.addRigidBody( body );
        return body;
    }

    createRigidBody2(sx, sy, sz, object, mass, pos, quat ) {
        const shape = new Ammo.btBoxShape( new Ammo.btVector3( sx * 0.5, sy * 0.5, sz * 0.5 ) );
        shape.setMargin( margin );

        // @ts-ignore
        this.createRigidBody( object, shape, mass, pos, quat );
    }

    updatePhysics( deltaTime ) {
        if (this.physicsWorld) {
        // Step world
        this.physicsWorld.stepSimulation( deltaTime, 10 );

        // Update rigid bodies
        for ( let i = 0, il = this.rigidBodies.length; i < il; i ++ ) {

            const objThree = this.rigidBodies[ i ];
            const objPhys = objThree.userData.physicsBody;
            const ms = objPhys.getMotionState();
            if ( ms ) {
                ms.getWorldTransform( this.transformAux1 );
                const p = this.transformAux1.getOrigin();
                const q = this.transformAux1.getRotation();
                objThree.position.set( p.x(), p.y(), p.z() );
                objThree.quaternion.set( q.x(), q.y(), q.z(), q.w() );
                objThree.userData.collided = false;
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

            const breakable0 = userData0 ? userData0.breakable : false;
            const breakable1 = userData1 ? userData1.breakable : false;

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

            if (breakable0 && !collided0 && maxImpulse > fractureImpulse) {

                // @ts-ignore
                const debris = this.convexBreaker.subdivideByImpact(threeObject0, this.impactPoint, this.impactNormal, 1, 2, 1.5);

                const numObjects = debris.length;
                for (let j = 0; j < numObjects; j++) {

                    const vel = rb0.getLinearVelocity();
                    const angVel = rb0.getAngularVelocity();
                    const fragment = debris[j];
                    fragment.userData.velocity.set(vel.x(), vel.y(), vel.z());
                    fragment.userData.angularVelocity.set(angVel.x(), angVel.y(), angVel.z());

                    this.createDebrisFromBreakableObject(fragment);
                }

                this.objectsToRemove[this.numObjectsToRemove++] = threeObject0;
                userData0.collided = true;
            }

            if (breakable1 && !collided1 && maxImpulse > fractureImpulse) {

                // @ts-ignore
                const debris = this.convexBreaker.subdivideByImpact(threeObject1, this.impactPoint, this.impactNormal, 1, 2, 1.5);

                const numObjects = debris.length;
                for (let j = 0; j < numObjects; j++) {

                    const vel = rb1.getLinearVelocity();
                    const angVel = rb1.getAngularVelocity();
                    const fragment = debris[j];
                    fragment.userData.velocity.set(vel.x(), vel.y(), vel.z());
                    fragment.userData.angularVelocity.set(angVel.x(), angVel.y(), angVel.z());

                    this.createDebrisFromBreakableObject(fragment);
                }

                this.objectsToRemove[this.numObjectsToRemove++] = threeObject1;
                userData1.collided = true;
            }
        }

        }

        for ( let i = 0; i < this.numObjectsToRemove; i ++ ) {
            this.removeDebris( this.objectsToRemove[ i ] );
        }

        this.numObjectsToRemove = 0;

    }

    removeDebris( object ) {
        this.scene.remove( object );
        this.physicsWorld.removeRigidBody( object.userData.physicsBody );
    }

    fire(ball: Mesh, ballRadius: number) {
        const ballShape = new Ammo.btSphereShape( ballRadius );
        ballShape.setMargin( margin );
        const ballMass = 35;
        // this.pos.copy( raycaster.ray.direction );
        // this.pos.add( raycaster.ray.origin );
        // this.quat.set( 0, 0, 0, 1 );
        // @ts-ignore
        const ballBody = this.createRigidBody( ball, ballShape, ballMass, this.pos, this.quat );
        const rndX = Math.floor(Math.random() * 15) - 7;
        const rndY = Math.floor(Math.random() * 15) - 7;
        let pos = new Vector3(rndX, rndY, -15);
        // this.pos.copy( raycaster.ray.direction );
        // this.pos.multiplyScalar( 24 );
        ballBody.setLinearVelocity( new Ammo.btVector3( pos.x, pos.y, pos.z ) );
    }
}
