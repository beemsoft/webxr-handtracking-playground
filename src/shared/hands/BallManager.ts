import { MathUtils, Vector3 } from 'three/src/Three';
import PhysicsHandler from '../physics/cannon/PhysicsHandler';
import ProjectileMotionHelper from '../physics/cannon/ProjectileMotionHelper';
import { Vec3 } from 'cannon-es';

export default class BallManager {
  private physicsHandler: PhysicsHandler;
  private projectileMotionHelper = new ProjectileMotionHelper();
  private ballInMotion = false;
  canFixBall = true;
  private fixHand = "";

  constructor(physicsHandler: PhysicsHandler) {
    this.physicsHandler = physicsHandler;
  }

  public moveBall(pinkPosition: Vector3, thumbPosition: Vector3, handPosition: Vec3) {
    if (MathUtils.radToDeg(pinkPosition.angleTo(thumbPosition)) > 70) {
      this.physicsHandler.handMeshMaterial.color.set(0x42f587);
      console.log("Move ball! location: " + this.physicsHandler.bodyControlledByHandGesture.position.x + ", " + this.physicsHandler.bodyControlledByHandGesture.position.y
        + ", " + this.physicsHandler.bodyControlledByHandGesture.position.z);
      if (!this.ballInMotion) {
        this.ballInMotion = true;
        this.projectileMotionHelper.applyMotion(handPosition, this.physicsHandler.bodyControlledByHandGesture);
      } else {
        if (this.physicsHandler.bodyControlledByHandGesture.position.y < -1.1) {
          this.ballInMotion = false;
        }
      }
    }
  }

  public checkBall(wristPosition: Vector3) {
    let ballPosition = new Vector3(this.physicsHandler.bodyControlledByHandGesture.position.x, this.physicsHandler.bodyControlledByHandGesture.position.y, this.physicsHandler.bodyControlledByHandGesture.position.z);
    if (this.fixHand == "" && wristPosition.distanceTo(ballPosition) < 0.25) {
      this.canFixBall = false;
      this.physicsHandler.handMeshMaterial.color.set(0xFF3333);
    } else {
      if (wristPosition.distanceTo(ballPosition) > 0.5)
        this.canFixBall = true;
    }
  }

}
