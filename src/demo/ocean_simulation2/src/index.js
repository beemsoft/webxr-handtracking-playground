import SceneManager from './scene/SceneManager';
import { determineVrOrNonVrSetup } from '../../../shared/DetermineVrOrNonVrSetup';

const sceneManager = new SceneManager();

determineVrOrNonVrSetup(sceneManager, false, true);
