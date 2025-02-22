import WebXRManager from '../web-managers/WebXRManager';
import {SceneManagerInterface} from '../scene/SceneManagerInterface';

let element: HTMLElement;

export class VrInitializer {
  private readonly sceneManager: SceneManagerInterface;

  constructor(sceneManager: SceneManagerInterface, useDefaultHandGestures: boolean, useAmmoLib: boolean) {
    this.sceneManager = sceneManager;
    this.addVrButton(useDefaultHandGestures, useAmmoLib);
  }

  addVrButton(useDefaultHandGestures: boolean, useAmmoLib: boolean) {
    element = document.createElement('div');
    document.body.appendChild(element);
    const button = document.createElement('button');
    button.style.display = 'inline-block';
    button.style.margin = '5px';
    button.style.width = '120px';
    button.style.border = '0';
    button.style.padding = '8px';
    button.style.cursor = 'pointer';
    button.style.backgroundColor = '#000';
    button.style.color = '#fff';
    button.style.fontFamily = 'sans-serif';
    button.style.fontSize = '13px';
    button.style.fontStyle = 'normal';
    button.style.textAlign = 'center';
    button.textContent = 'ENTER VR';
    button.addEventListener('click', () => {
      new WebXRManager(this.sceneManager, useDefaultHandGestures, useAmmoLib);
    });
    element.appendChild(button);
    return button;
  }
}


