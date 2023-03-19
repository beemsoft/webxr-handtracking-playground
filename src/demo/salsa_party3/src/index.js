import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { VRMLoaderPlugin, VRMUtils} from "@pixiv/three-vrm";
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import SkeletonHelper from "../../../shared/model/SkeletonHelper";
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader';
import VrmSkeletonUtils from "../../salsa_party2/src/worker/VrmSkeletonUtils";

let container;
let camera, scene, renderer;
let hand1, hand2;
let controller1, controller2;
let controllerGrip1, controllerGrip2;

const handModels = {
    left: null,
    right: null
};

let controls;

const modelNames = [
    // { leader: "kenji", follower: "female_redshirt", offsetX: -2.2, offsetZ: -1.5, rotationY: Math.PI / 6 },
    // { leader: "eric", follower: "kat", offsetX: 0, offsetZ: -3, rotationY: Math.PI / 6 },
];

init();
animate();


function createPointLight(color) {

    const light = new THREE.PointLight( color, 0.6 );
    light.castShadow = true;
    light.shadow.camera.top = 2;
    light.shadow.camera.bottom = - 2;
    light.shadow.camera.right = 2;
    light.shadow.camera.left = - 2;
    light.shadow.mapSize.set( 4096, 4096 );
    return light;

}

function init() {

    container = document.createElement( 'div' );
    document.body.appendChild( container );

    scene = new THREE.Scene();
    // window.scene = scene;
    scene.background = new THREE.Color( 0x444444 );

    camera = new THREE.PerspectiveCamera( 70, window.innerWidth / window.innerHeight, 0.1, 20 );
    camera.position.set( 0, 1.6, 3 );

    controls = new OrbitControls( camera, container );
    controls.target.set( 0, 1.6, 0 );
    controls.update();

    const floorGeometry = new THREE.PlaneGeometry( 20, 20 );
    const floorMaterial = new THREE.MeshStandardMaterial( { color: 0x222222 } );
    const floor = new THREE.Mesh( floorGeometry, floorMaterial );
    floor.position.y = -0.4;
    floor.rotation.x = - Math.PI / 2;
    floor.receiveShadow = true;
    scene.add( floor );

    // Models
    loadModels();

    const pointLight1 = createPointLight( 0xFF7F00 );
    const pointLight2 = createPointLight( 0x00FF7F );
    const pointLight3 = createPointLight( 0x7F00FF );
    pointLight1.position.set( 3, 2, 3 );
    pointLight2.position.set( 4, 2, 0 );
    pointLight3.position.set( -3, 2, -3 );
    scene.add( pointLight1, pointLight2, pointLight3 );

    //

    renderer = new THREE.WebGLRenderer( { antialias: true } );
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setSize( window.innerWidth, window.innerHeight );
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.xr.enabled = true;

    container.appendChild( renderer.domElement );

    document.body.appendChild( VRButton.createButton( renderer ) );

    // controllers

    controller1 = renderer.xr.getController( 0 );
    scene.add( controller1 );

    controller2 = renderer.xr.getController( 1 );
    scene.add( controller2 );

    const controllerModelFactory = new XRControllerModelFactory();
    const handModelFactory = new XRHandModelFactory();

    // Hand 1

    controllerGrip1 = renderer.xr.getControllerGrip( 0 );
    controllerGrip1.add( controllerModelFactory.createControllerModel( controllerGrip1 ) );
    scene.add( controllerGrip1 );

    hand1 = renderer.xr.getHand( 0 );
    hand1.userData.currentHandModel = 0;
    scene.add( hand1 );

    handModels.left = [
        handModelFactory.createHandModel( hand1, 'boxes' ),
        handModelFactory.createHandModel( hand1, 'spheres' ),
        handModelFactory.createHandModel( hand1, 'mesh' )
    ];

    for ( let i = 0; i < 3; i ++ ) {

        const model = handModels.left[ i ];
        model.visible = i == 0;
        hand1.add( model );

    }

    hand1.addEventListener( 'pinchend', function () {

        handModels.left[ this.userData.currentHandModel ].visible = false;
        this.userData.currentHandModel = ( this.userData.currentHandModel + 1 ) % 3;
        handModels.left[ this.userData.currentHandModel ].visible = true;

    } );

    // Hand 2

    controllerGrip2 = renderer.xr.getControllerGrip( 1 );
    controllerGrip2.add( controllerModelFactory.createControllerModel( controllerGrip2 ) );
    scene.add( controllerGrip2 );

    hand2 = renderer.xr.getHand( 1 );
    hand2.userData.currentHandModel = 0;
    scene.add( hand2 );

    handModels.right = [
        handModelFactory.createHandModel( hand2, 'boxes' ),
        handModelFactory.createHandModel( hand2, 'spheres' ),
        handModelFactory.createHandModel( hand2, 'mesh' )
    ];

    for ( let i = 0; i < 3; i ++ ) {

        const model = handModels.right[ i ];
        model.visible = i == 0;
        hand2.add( model );

    }

    hand2.addEventListener( 'pinchend', function () {

        handModels.right[ this.userData.currentHandModel ].visible = false;
        this.userData.currentHandModel = ( this.userData.currentHandModel + 1 ) % 3;
        handModels.right[ this.userData.currentHandModel ].visible = true;

    } );

    //

    const geometry = new THREE.BufferGeometry().setFromPoints( [ new THREE.Vector3( 0, 0, 0 ), new THREE.Vector3( 0, 0, - 1 ) ] );

    const line = new THREE.Line( geometry );
    line.name = 'line';
    line.scale.z = 5;

    controller1.add( line.clone() );
    controller2.add( line.clone() );

    //

    window.addEventListener( 'resize', onWindowResize );

}

function onWindowResize() {

    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize( window.innerWidth, window.innerHeight );

}
//

function animate() {

    renderer.setAnimationLoop( render );

}

let clock = new THREE.Clock();
let mixerDance1, mixerDance2;
let isAnimationPaused = false;
let person1, person2;

const options1 = {
    hip: "hip",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    rotateModel: true,
    names: {
        "Normalized_J_Bip_C_Hips": "hip",
        "Normalized_J_Bip_C_Chest": "abdomen",
        "Normalized_J_Bip_C_UpperChest": "chest",
        "Normalized_J_Bip_C_Neck": "neck",
        "Normalized_J_Bip_C_Head": "head",

        "Normalized_J_Bip_R_Shoulder": "rCollar",
        "Normalized_J_Bip_R_UpperArm": "rShldr",
        "Normalized_J_Bip_R_LowerArm": "rForeArm",
        "Normalized_J_Bip_R_Hand": "rHand",

        "Normalized_J_Bip_L_Shoulder": "lCollar",
        "Normalized_J_Bip_L_UpperArm": "lShldr",
        "Normalized_J_Bip_L_LowerArm": "lForeArm",
        "Normalized_J_Bip_L_Hand": "lHand",

        "Normalized_J_Bip_R_UpperLeg": "rThigh",
        "Normalized_J_Bip_R_LowerLeg": "rShin",
        "Normalized_J_Bip_R_Foot": "rFoot",

        "Normalized_J_Bip_L_UpperLeg": "lThigh",
        "Normalized_J_Bip_L_LowerLeg": "lShin",
        "Normalized_J_Bip_L_Foot": "lFoot"
    }
};

const options = {
    hip: "hip",
    preservePosition: false,
    preserveHipPosition: false,
    useTargetMatrix: true,
    rotateModel: false,
    names: {
        "Normalized_J_Bip_C_Hips": "hip",
        "Normalized_J_Bip_C_Chest": "abdomen",
        "Normalized_J_Bip_C_UpperChest": "chest",
        "Normalized_J_Bip_C_Neck": "neck",
        "Normalized_J_Bip_C_Head": "head",

        "Normalized_J_Bip_R_Shoulder": "rCollar",
        "Normalized_J_Bip_R_UpperArm": "rShldr",
        "Normalized_J_Bip_R_LowerArm": "rForeArm",
        "Normalized_J_Bip_R_Hand": "rHand",

        "Normalized_J_Bip_L_Shoulder": "lCollar",
        "Normalized_J_Bip_L_UpperArm": "lShldr",
        "Normalized_J_Bip_L_LowerArm": "lForeArm",
        "Normalized_J_Bip_L_Hand": "lHand",

        "Normalized_J_Bip_R_UpperLeg": "rThigh",
        "Normalized_J_Bip_R_LowerLeg": "rShin",
        "Normalized_J_Bip_R_Foot": "rFoot",

        "Normalized_J_Bip_L_UpperLeg": "lThigh",
        "Normalized_J_Bip_L_LowerLeg": "lShin",
        "Normalized_J_Bip_L_Foot": "lFoot"
    }
};

function render() {

    let delta = clock.getDelta();
    if (mixerDance1 && mixerDance2) {
        mixerDance1.update(delta/slowDownFactor);
        mixerDance2.update(delta/slowDownFactor);
        if (!isAnimationPaused) {
            VrmSkeletonUtils.retarget(person1.scene.children[5], source1SkeletonHelper, options1);
            VrmSkeletonUtils.retarget(person2.scene.children[5], source2SkeletonHelper, options);
            if (danceCouples && danceCouples.length > 0) {
                for (let i = 0; i < danceCouples.length; i++) {
                    VrmSkeletonUtils.retarget(danceCouples[i].leader.scene.children[5], source1SkeletonHelper, options1);
                    VrmSkeletonUtils.retarget(danceCouples[i].follower.scene.children[5], source2SkeletonHelper, options1);
                }
            }
            if (person1) {
                person1.update(delta);
            }
            if (person2) {
                person2.update(delta);
            }
            if (danceCouples && danceCouples.length > 0) {
                for (let i = 0; i < danceCouples.length; i++) {
                    danceCouples[i].leader.update(delta);
                    danceCouples[i].follower.update(delta);
                }
            }
            // if (this.animationMixersEndOfDance.length > 0) {
            //     for (let i = 0; i < this.animationMixersEndOfDance.length; i++) {
            //         this.animationMixersEndOfDance[i].update(delta);
            //     }
            // }
        }
    }


    renderer.render( scene, camera );

}

//

const slowDownFactor = 1.8;
let danceCouples = [];
    // { leader: "kenji", follower: "female_redshirt", offsetX: -2.2, offsetZ: -1.5, rotationY: Math.PI / 6 },
    // { leader: "eric", follower: "kat", offsetX: 0, offsetZ: -3, rotationY: Math.PI / 6 },
// ];

function loadModels2(modelNames) {
    let gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    for (let i = 0; i < modelNames.length; i ++) {
        console.log('Loading model ' + modelNames[i].leader);
        gltfLoader.loadAsync('/shared/vrm/' + modelNames[i].leader + '.vrm').then((gltf) => {
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.removeUnnecessaryJoints(gltf.scene);
            scene.add(gltf.userData.vrm.scene);
            gltf.scene.children[5].position.x = modelNames[i].offsetX;
            gltf.scene.children[5].position.z = modelNames[i].offsetZ;
            gltf.scene.traverse( function( object ) {
                object.frustumCulled = false;
                object.castShadow = true;
            } );
            // this.initHappyAnimation(gltf.userData.vrm);
            // this.initBlinkAnimation(gltf.userData.vrm);
            console.log('Loading model ' + modelNames[i].follower);
            gltfLoader.loadAsync('/shared/vrm/' + modelNames[i].follower + '.vrm').then((gltf2) => {
                VRMUtils.removeUnnecessaryVertices(gltf2.scene);
                VRMUtils.removeUnnecessaryJoints(gltf2.scene);
                gltf2.scene.children[5].position.x = modelNames[i].offsetX;
                gltf2.scene.children[5].position.z = modelNames[i].offsetZ;
                gltf2.scene.traverse( function( object ) {
                    object.frustumCulled = false;
                    object.castShadow = true;
                } );
                // this.initHappyAnimation(gltf2.userData.vrm);
                // this.initBlinkAnimation(gltf2.userData.vrm);
                danceCouples.push({ leader: gltf.userData.vrm, follower: gltf2.userData.vrm });
                scene.add(gltf2.userData.vrm.scene);
            });
        });
    }
}

function loadModels() {
    const loader = new GLTFLoader();
    loader.load('/shared/models/kleeblatt.gltf', (gltf) => {
        let model = gltf.scene;
        // model.position.y = +3.65;
        // model.position.z = -1;
        model.scale.set(0.03, 0.03, 0.03);
        model.position.y = -0.2;
        // model.position.z = -13;
        // model.position.x = 9;
        // model.rotateY(Math.PI/2);
        scene.add(model);
    });
    loadModels2(modelNames);
    let gltfLoader = new GLTFLoader();
    gltfLoader.register((parser) => new VRMLoaderPlugin(parser));
    gltfLoader.loadAsync('/shared/vrm/mawi.vrm').then((gltf) => {
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        const vrm = gltf.userData.vrm;
        console.log(vrm);
        gltf.scene.children[5].position.x = 2;
        gltf.scene.children[5].position.z = 1;
        person1 = vrm;
        gltf.scene.traverse( function( object ) {
            object.frustumCulled = false;
            object.castShadow = true;
        } );
        scene.add(gltf.userData.vrm.scene);
        // this.initBlinkAnimation(vrm);
        // this.initHappyAnimation(vrm);
        gltfLoader.loadAsync('/shared/vrm/VRM1_Constraint_Twist_Sample.vrm').then((gltf) => {
            VRMUtils.removeUnnecessaryVertices(gltf.scene);
            VRMUtils.removeUnnecessaryJoints(gltf.scene);
            gltf.scene.children[5].position.x = 2;
            gltf.scene.children[5].position.z = 1;
            person2 = gltf.userData.vrm;
            // this.initBlinkAnimation(gltf.userData.vrm);
            // this.initHappyAnimation(gltf.userData.vrm);
            loadBVH(1);
            gltf.scene.traverse( function( object ) {
                object.frustumCulled = false;
                object.castShadow = true;
            } );
            scene.add(gltf.userData.vrm.scene);
            // this.playBlinkAnimations();
            // this.audioElement.play();
        })
    });
}

// Animation

let bvh1, bvh2;
let source1SkeletonHelper, source2SkeletonHelper;

function loadBVH(move) {
    let loader = new BVHLoader();
    let moveStr = move;
    if (move < 10) {
        moveStr = "0" + move;
    }
    loader.load("/shared/bvh/60/60_" + moveStr + "_scaled.bvh", (bvh) => {
        bvh1 = bvh;
        source1SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
        source1SkeletonHelper.skeleton = bvh.skeleton;
        loader.load("/shared/bvh/61/61_" + moveStr + "_scaled.bvh", (bvh) => {
            bvh2 = bvh;
            source2SkeletonHelper = new SkeletonHelper(bvh.skeleton.bones[0]);
            source2SkeletonHelper.skeleton = bvh.skeleton;
            startShow(move);
            preloadBVH(move + 1);
        });
    });
}

let nextBvh1, nextBvh2;

function doNext(move) {
    bvh1 = nextBvh1;
    bvh2 = nextBvh2;
    if (move < 15) {
        preloadBVH(move + 1);
    }
    let source1SkeletonHelper = new SkeletonHelper(bvh1.skeleton.bones[0]);
    source1SkeletonHelper.skeleton = bvh1.skeleton;
    let source2SkeletonHelper = new SkeletonHelper(bvh2.skeleton.bones[0]);
    source2SkeletonHelper.skeleton = bvh2.skeleton;
    startShow(move);
    setTimeout(() => {
        console.log("animation happy");
        // playHappyAnimations();
    }, (bvh1.clip.duration * 1000 * slowDownFactor) - 2000)
}

function preloadBVH(move) {
    let loader = new BVHLoader();
    let moveStr = move;
    if (move < 10) {
        moveStr = "0" + move;
    }
    loader.load("/shared/bvh/60/60_" + moveStr + "_scaled.bvh", (bvh) => {
        nextBvh1 = bvh;
        loader.load("/shared/bvh/61/61_" + moveStr + "_scaled.bvh", (bvh) => {
            nextBvh2 = bvh;
        });
    });
}

function startShow(move) {
    console.log("Play move " + move + " for second: " + bvh1.clip.duration * slowDownFactor);
    // this.isAnimationPaused = false;
    mixerDance1 = new THREE.AnimationMixer(source1SkeletonHelper);
    mixerDance2 = new THREE.AnimationMixer(source2SkeletonHelper);
    console.log("Start animation");
    // this.scene.add(this.person1.scene);
    // this.scene.add(this.person2.scene);
    mixerDance1.clipAction(bvh1.clip).play();
    mixerDance2.clipAction(bvh2.clip).play();
    setTimeout(() => {
        console.log("animation happy");
        // this.playHappyAnimations();
    }, (bvh1.clip.duration * 1000 * slowDownFactor) - 2000)
    setTimeout(() => {
        console.log("Stop animation");
        if (move < 15) {
            doNext(move + 1);
        } else {
            // this.isAnimationPaused = true;
        }
    }, bvh1.clip.duration * 1000 * slowDownFactor)
}


