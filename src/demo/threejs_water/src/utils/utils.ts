import {FileLoader} from "three";

export function loadFile(filename) {
    console.log('Loading file: ' + filename);
    return new Promise((resolve, reject) => {
        const loader = new FileLoader();

        loader.load(filename, (data) => {
            resolve(data);
        });
    });
}
