/* Copyright 2023 The MediaPipe Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License. */

import {
    AnimationMixer,
    AmbientLight,
    Bone,
    Clock,
    ColorManagement,
    DirectionalLight,
    Euler,
    Material,
    MathUtils,
    Matrix4,
    Mesh,
    MeshBasicMaterial,
    PerspectiveCamera,
    PlaneGeometry,
    Quaternion,
    Scene,
    sRGBEncoding,
    Vector2,
    Vector3,
    VideoTexture,
    WebGLRenderer
} from 'three/src/Three';

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

import {
    GLTFLoader,
    GLTF
} from 'three/examples/jsm/loaders/GLTFLoader';
import { Classifications, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import Stats from "three/examples/jsm/libs/stats.module";

/**
 * Returns the world-space dimensions of the viewport at `depth` units away from
 * the camera.
 */
function getViewportSizeAtDepth(
    camera: PerspectiveCamera,
    depth: number
): Vector2 {
    const viewportHeightAtDepth =
        2 * depth * Math.tan(MathUtils.degToRad(0.5 * camera.fov));
    const viewportWidthAtDepth = viewportHeightAtDepth * camera.aspect;
    return new Vector2(viewportWidthAtDepth, viewportHeightAtDepth);
}

/**
 * Creates a `THREE.Mesh` which fully covers the `camera` viewport, is `depth`
 * units away from the camera and uses `material`.
 */
function createCameraPlaneMesh(
    camera: PerspectiveCamera,
    depth: number,
    material: Material
): Mesh {
    if (camera.near > depth || depth > camera.far) {
        console.warn("Camera plane geometry will be clipped by the `camera`!");
    }
    const viewportSize = getViewportSizeAtDepth(camera, depth);
    const cameraPlaneGeometry = new PlaneGeometry(
        viewportSize.width,
        viewportSize.height
    );
    cameraPlaneGeometry.translate(0, 0, -depth);

    return new Mesh(cameraPlaneGeometry, material);
}

type RenderCallback = (delta: number) => void;

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

class BasicScene {
    scene: Scene;
    width: number;
    height: number;
    camera: PerspectiveCamera;
    renderer: WebGLRenderer;
    controls: OrbitControls;
    lastTime: number = 0;
    callbacks: RenderCallback[] = [];

    constructor() {
        // Initialize the canvas with the same aspect ratio as the video input
        this.height = window.innerHeight;
        this.width = (this.height * 1280) / 720;
        // Set up the Three.js scene, camera, and renderer
        this.scene = new Scene();
        this.camera = new PerspectiveCamera(
            60,
            this.width / this.height,
            0.01,
            5000
        );

        this.renderer = new WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.width, this.height);
        ColorManagement.legacy = false;
        this.renderer.outputEncoding = sRGBEncoding;
        document.body.appendChild(this.renderer.domElement);

        // Set up the basic lighting for the scene
        const ambientLight = new AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);
        const directionalLight = new DirectionalLight(0xffffff, 0.5);
        directionalLight.position.set(0, 1, 0);
        this.scene.add(directionalLight);

        // Set up the camera position and controls
        this.camera.position.z = 0;
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        let orbitTarget = this.camera.position.clone();
        orbitTarget.z -= 5;
        this.controls.target = orbitTarget;
        this.controls.update();

        // Add a video background
        const video = document.getElementById("video") as HTMLVideoElement;
        const inputFrameTexture = new VideoTexture(video);
        if (!inputFrameTexture) {
            throw new Error("Failed to get the 'input_frame' texture!");
        }
        inputFrameTexture.encoding = sRGBEncoding;
        const inputFramesDepth = 500;
        const inputFramesPlane = createCameraPlaneMesh(
            this.camera,
            inputFramesDepth,
            new MeshBasicMaterial({ map: inputFrameTexture })
        );
        this.scene.add(inputFramesPlane);

        // Render the scene
        this.render();

        window.addEventListener("resize", this.resize.bind(this));
    }

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.renderer.render(this.scene, this.camera);
    }

    render(time: number = this.lastTime): void {
        const delta = (time - this.lastTime) / 1000;
        this.lastTime = time;
        // Call all registered callbacks with deltaTime parameter
        for (const callback of this.callbacks) {
            callback(delta);
        }
        // Render the scene
        this.renderer.render(this.scene, this.camera);
        // Request next frame
        requestAnimationFrame((t) => this.render(t));
    }
}

interface MatrixRetargetOptions {
    decompose?: boolean;
    scale?: number;
}
let vrm;
let mixer;

class Avatar {
    scene: Scene;
    loader: GLTFLoader = new GLTFLoader();
    gltf: GLTF;
    root: Bone;
    neckBone: Bone;
    morphTargetMeshes: Mesh[] = [];
    url: string;

    constructor(url: string, scene: Scene) {
        this.url = url;
        this.scene = scene;
        this.loadModel(this.url);
    }

    loadModel(url: string) {
        this.url = url;
        this.loader.register((parser) => new VRMLoaderPlugin(parser));
        this.loader.load(
          // URL of the model you want to load
          url,
          // Callback when the resource is loaded
          (gltf) => {
              if (this.gltf) {
                  // Reset GLTF and morphTargetMeshes if a previous model was loaded.
                  this.gltf.scene.remove();
                  this.morphTargetMeshes = [];
              }
              this.gltf = gltf;
              vrm = gltf.userData.vrm;
              console.log(vrm);
              mixer = new AnimationMixer( vrm.scene );
              // gltf.scene.scale.set(130, 130, 130);
              this.scene.add(gltf.scene);
              this.init(gltf);
          },

          // Called while loading is progressing
          (progress) =>
            console.log(
              "Loading model...",
              100.0 * (progress.loaded / progress.total),
              "%"
            ),
          // Called when loading has errors
          (error) => console.error(error)
        );
    }

    init(gltf: GLTF) {
        gltf.scene.traverse((object) => {
            // console.log(object);
            // Register first bone found as the root
            if ((object as Bone).isBone && !this.root && object.name === 'J_Bip_C_Neck') {
                this.root = object as Bone;
                // console.log(object);
            }
            // if (!this.root && object.name === 'Face') {
            //     this.root = object as Group;
            //     console.log('Root: '+ object.name);
            // }
            if ((object as Bone).isBone && object.name === 'J_Bip_C_Hips') {
                // this.root = object as Bone;
                console.log('Reverse: ' + object.name);
                object.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
            }

            // Return early if no mesh is found.
            if (!(object as Mesh).isMesh) {
                // console.warn(`No mesh found`);
                return;
            }

            const mesh = object as Mesh;
            // Reduce clipping when model is close to camera.
            mesh.frustumCulled = false;

            // Return early if mesh doesn't include morphable targets
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
                // console.warn(`Mesh ${mesh.name} does not have morphable targets`);
                return;
            }
            this.morphTargetMeshes.push(mesh);
        });
    }

    updateBlendshapes(blendshapes: Map<string, number>) {
        for (const mesh of this.morphTargetMeshes) {
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) {
                // console.warn(`Mesh ${mesh.name} does not have morphable targets`);
                continue;
            }
            for (const [name, value] of blendshapes) {
                if (!Object.keys(mesh.morphTargetDictionary).includes(name)) {
                    // console.warn(`Model morphable target ${name} not found`);
                    continue;
                }

                const idx = mesh.morphTargetDictionary[name];
                mesh.morphTargetInfluences[idx] = value;
            }
        }
    }

    /**
     * Apply a position, rotation, scale matrix to current GLTF.scene
     * @param matrix
     * @param matrixRetargetOptions
     * @returns
     */
    applyMatrix(
      matrix: Matrix4,
      matrixRetargetOptions?: MatrixRetargetOptions
    ): void {
        const {decompose = false, scale = 4} = matrixRetargetOptions || {};
        if (!this.gltf) {
            return;
        }
        this.offsetRoot(new Vector3(0, -1.57, 0));
// Three.js will update the object matrix when it render the page
// according the object position, scale, rotation.
// To manually set the object matrix, you have to set autoupdate to false.
// matrix.scale(new Vector3(scale, scale, scale));
        matrix.scale(new Vector3(130, 130, 130));
        this.gltf.scene.matrixAutoUpdate = false;
// Set new position and rotation from matrix
        this.gltf.scene.matrix.copy(matrix);
    }

    /**
     * Takes the root object in the avatar and offsets its position for retargetting.
     * @param offset
     * @param rotation
     */
    offsetRoot(offset: Vector3, rotation?: Vector3): void {
        if (this.root) {
            this.root.position.copy(offset);
            if (rotation) {
                let offsetQuat = new Quaternion().setFromEuler(
                  new Euler(rotation.x, rotation.y, rotation.z)
                );
                this.root.quaternion.copy(offsetQuat);
            }
        }
    }
}

let faceLandmarker: FaceLandmarker;
let video: HTMLVideoElement;

const scene = new BasicScene();
const avatar = new Avatar(
    "models/VRoid_V110_Male_v1.1.3.vrm",
    scene.scene
);

function detectFaceLandmarks(time: DOMHighResTimeStamp): void {
    if (!faceLandmarker) {
        return;
    }
    const landmarks = faceLandmarker.detectForVideo(video, time);

    // Apply transformation
    const transformationMatrices = landmarks.facialTransformationMatrixes;
    if (transformationMatrices && transformationMatrices.length > 0) {
        let matrix = new Matrix4().fromArray(transformationMatrices[0].data);
    //     // Example of applying matrix directly to the avatar
    //     avatar.applyMatrix(matrix, { scale: 40 });
        matrix.scale(new Vector3(130, 130, 130));
        matrix.decompose(avatar.root.position, avatar.root.quaternion, avatar.root.scale);
        // avatar.root.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));


        avatar.root.updateMatrixWorld();
    }
    // if (options.preserveHipPosition && name === options.hip) {
    //     bone.matrix.setPosition(pos.set(0, bone.position.y, 0));
    // }
    // bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);
    // bone.updateMatrixWorld();

    // Apply Blendshapes
    const blendshapes = landmarks.faceBlendshapes;
    if (blendshapes && blendshapes.length > 0) {
        const coefsMap = retarget(blendshapes);
        avatar.updateBlendshapes(coefsMap);
    }
}

function retarget(blendshapes: Classifications[]) {
    const categories = blendshapes[0].categories;
    let coefsMap = new Map<string, number>();
    for (let i = 0; i < categories.length; ++i) {
        const blendshape = categories[i];
        // Adjust certain blendshape values to be less prominent.
        switch (blendshape.categoryName) {
            case "browOuterUpLeft":
                blendshape.score *= 1.2;
                break;
            case "browOuterUpRight":
                blendshape.score *= 1.2;
                break;
            case "eyeBlinkLeft":
                blendshape.score *= 1.2;
                break;
            case "eyeBlinkRight":
                blendshape.score *= 1.2;
                break;
            default:
        }
        coefsMap.set(categories[i].categoryName, categories[i].score);
    }
    return coefsMap;
}

let clock = new Clock();

function onVideoFrame(time: DOMHighResTimeStamp): void {
    stats.begin();
    let delta = clock.getDelta();

    // Do something with the frame.
    detectFaceLandmarks(time);

    if (vrm) {
        // VRM update causes issue with lip sync
        // vrm.update(delta);
    }

    stats.end();
    // Re-register the callback to be notified about the next frame.
    // @ts-ignore
    video.requestVideoFrameCallback(onVideoFrame);
}

// Stream webcam into landmarker loop (and also make video visible)
async function streamWebcamThroughFaceLandmarker(): Promise<void> {
    video = document.getElementById("video") as HTMLVideoElement;

    function onAcquiredUserMedia(stream: MediaStream): void {
        video.srcObject = stream;
        video.onloadedmetadata = () => {
            video.play();
        };
    }

    try {
        const evt = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: "user",
                width: 1280,
                height: 720
            }
        });
        onAcquiredUserMedia(evt);
        // @ts-ignore
        video.requestVideoFrameCallback(onVideoFrame);
    } catch (e: unknown) {
        console.error(`Failed to acquire camera feed: ${e}`);
    }
}

async function runDemo() {
    await streamWebcamThroughFaceLandmarker();
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.1.0-alpha-16/wasm"
    );
    faceLandmarker = await FaceLandmarker.createFromModelPath(
        vision,
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    );
    await faceLandmarker.setOptions({
        baseOptions: {
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true
    });

    console.log("Finished Loading MediaPipe Model.");
}

runDemo();
