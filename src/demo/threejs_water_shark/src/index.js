import SceneManager from './scene/SceneManager';
import {determineVrOrNonVrSetup} from "../../../shared/DetermineVrOrNonVrSetup";

let sceneManager = new SceneManager();

determineVrOrNonVrSetup(sceneManager, false, false);
