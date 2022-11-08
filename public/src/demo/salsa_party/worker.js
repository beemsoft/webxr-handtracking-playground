import {Matrix4,Quaternion} from "three";

onmessage = (e) => {
    console.log('Message received from main script: ' + e.data);
    // const workerResult = `Result: ${e.data[0] * e.data[1]}`;
    console.log('Posting message back to main script');
    const workerResult = "Testje";
    const quat = new Quaternion(),
        relativeMatrix = new Matrix4(),
        globalMatrix = new Matrix4();

    postMessage(workerResult);
}
