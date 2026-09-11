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
    element.id = 'vr-button-container';
    element.style.position = 'fixed';
    element.style.top = '20px';
    element.style.left = '20px';
    element.style.zIndex = '999999';
    element.style.pointerEvents = 'auto';
    document.body.appendChild(element);

    const button = document.createElement('button');
    button.id = 'vrButton';
    button.style.display = 'inline-block';
    button.style.margin = '0';
    button.style.padding = '12px 20px';
    button.style.border = '1px solid #ffffff';
    button.style.borderRadius = '6px';
    button.style.backgroundColor = '#000000';
    button.style.color = '#ffffff';
    button.style.fontFamily = 'sans-serif';
    button.style.fontSize = '14px';
    button.style.fontWeight = 'bold';
    button.style.fontStyle = 'normal';
    button.style.textAlign = 'center';
    button.style.cursor = 'pointer';
    button.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.7)';
    button.style.pointerEvents = 'auto';
    button.textContent = 'ENTER VR';

    button.addEventListener('click', () => {
      if (element && element.parentElement) {
        element.parentElement.removeChild(element);
      }
      new WebXRManager(this.sceneManager, useDefaultHandGestures, useAmmoLib);
    });
    element.appendChild(button);
    return button;
  }
}


