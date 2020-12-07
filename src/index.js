/**
 * @license
 * Copyright 2020 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import * as handpose from '@tensorflow-models/handpose';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import {VrInitializer} from "./webxr/VrInitializer";
import SceneManager from './scene/sceneManager';
import {fingerLookupIndices, VIDEO_HEIGHT, VIDEO_WIDTH} from "./shared/hands/HandPoseManager";

let videoWidth, videoHeight, rafID, ctx, canvas, ANCHOR_POINTS,
    scatterGLHasInitialized = false, scatterGL;

const state = {
    backend: 'webgl',
    renderPointCloud: true,
    pauseVideo: false
};

const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

function setupDatGui() {
    const gui = new dat.GUI();
    gui.add(state, 'renderPointCloud').onChange(render => {
        document.querySelector('#scatter-gl-container').style.display =
            render ? 'inline-block' : 'none';
    });
    gui.add(state, 'pauseVideo').onChange(() => {
        state.pauseVideo = !!state.pauseVideo;
    });
}

function drawPoint(y, x, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
}

function drawKeyPoints(keypoints) {
    const keypointsArray = keypoints;

    for (let i = 0; i < keypointsArray.length; i++) {
        const y = keypointsArray[i][0];
        const x = keypointsArray[i][1];
        drawPoint(x - 2, y - 2, 3);
    }

    const fingers = Object.keys(fingerLookupIndices);
    for (let i = 0; i < fingers.length; i++) {
        const finger = fingers[i];
        const points = fingerLookupIndices[finger].map(idx => keypoints[idx]);
        drawPath(points, false);
    }
}

function drawPath(points, closePath) {
    const region = new Path2D();
    region.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
        const point = points[i];
        region.lineTo(point[0], point[1]);
    }

    if (closePath) {
        region.closePath();
    }
    ctx.stroke(region);
}

let model;

async function setupCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Browser API navigator.mediaDevices.getUserMedia not available');
    }

    const video = document.getElementById('video');
    video.srcObject = await navigator.mediaDevices.getUserMedia({
        'audio': false,
        'video': {
            facingMode: 'user',
            width: VIDEO_WIDTH,
            height: VIDEO_HEIGHT
        },
    });

    return new Promise((resolve) => {
        video.onloadedmetadata = () => {
            resolve(video);
        };
    });
}

async function loadVideo() {
    const video = await setupCamera();
    video.play();
    return video;
}

let sceneManager = new SceneManager();

async function main() {
    let initializer = new VrInitializer(sceneManager);
    initializer.init();

    try {
        let video = await loadVideo();
        await tf.setBackend(state.backend);
        model = await handpose.load();
        setupDatGui();

        videoWidth = video.videoWidth;
        videoHeight = video.videoHeight;

        canvas = document.getElementById('output');
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        video.width = videoWidth;
        video.height = videoHeight;
        ctx = canvas.getContext('2d');
        if (!state.pauseVideo) {
            ctx.clearRect(0, 0, videoWidth, videoHeight);
            ctx.strokeStyle = 'red';
            ctx.fillStyle = 'red';
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }

        // These anchor points allow the hand pointcloud to resize according to its
        // position in the input.
        ANCHOR_POINTS = [
            [0, 0, 0], [0, -VIDEO_HEIGHT, 0], [-VIDEO_WIDTH, 0, 0],
            [-VIDEO_WIDTH, -VIDEO_HEIGHT, 0]
        ];

        if (state.renderPointCloud) {
            document.querySelector('#scatter-gl-container').style =
                `width: ${VIDEO_WIDTH}px; height: ${VIDEO_HEIGHT}px;`;

            scatterGL = new ScatterGL(
                document.querySelector('#scatter-gl-container'),
                {'rotateOnStart': false, 'selectEnabled': false});
        }

        landmarksRealTime(video);
    } catch (e) {
        let info = document.getElementById('info');
        info.textContent = e.message;
        info.style.display = 'block';
        throw e;
    }
}

const landmarksRealTime = async (video) => {
    async function frameLandmarks() {
        stats.begin();
        if (!state.pauseVideo) {
            ctx.drawImage(
                video, 0, 0, videoWidth, videoHeight, 0, 0, canvas.width,
                canvas.height);
        }
        const predictions = await model.estimateHands(video);
        if (predictions.length > 0) {
            const result = predictions[0].landmarks;
            if (!state.pauseVideo) {
                drawKeyPoints(result, predictions[0].annotations);
            }

            if (state.renderPointCloud === true && scatterGL != null) {
                const pointsData = result.map(point => {
                    return [-point[0], -point[1], -point[2]];
                });

                const dataset = new ScatterGL.Dataset([...pointsData, ...ANCHOR_POINTS]);

                if (!scatterGLHasInitialized) {
                    scatterGL.render(dataset);

                    const fingers = Object.keys(fingerLookupIndices);

                    scatterGL.setSequences(
                        fingers.map(finger => ({indices: fingerLookupIndices[finger]})));
                    scatterGL.setPointColorer((index) => {
                        if (index === 0) {
                            return 'purple';
                        } else if (index < pointsData.length && index > 0) {
                            return 'steelblue';
                        }
                        return 'black';
                    });
                    scatterGLHasInitialized = true;
                } else {
                    scatterGL.updateDataset(dataset);
                }
            }

            sceneManager.updateHandPose(result);

        }
        stats.end();
        rafID = requestAnimationFrame(frameLandmarks);
    }

    frameLandmarks();
};

navigator.getUserMedia = navigator.getUserMedia ||
    navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

main();
