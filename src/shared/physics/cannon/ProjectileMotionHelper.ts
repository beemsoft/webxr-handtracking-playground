import { Body, Vec3 } from "cannon-es";

export default class ProjectileMotionHelper {

  applyMotion(hand: Vec3, ball: Body) {
    let hand_position = hand.clone();
    hand_position.y = ball.position.y;
    let ball_position = ball.position.clone();
    let distance = hand_position.distanceTo(ball_position);
    let throw_distance;
    if (distance > 3) {
      // throw with bounce
      console.log('Bounce!');
      throw_distance = 2/5 * distance;
    } else {
        throw_distance = distance;
    }
    let max_height = hand.y + distance/10 - ball.position.y;
    // let max_height = hand.y - ball.position.y;
    let time_in_the_air = Math.sqrt(max_height * 8 / 9.8);
    let initial_velocity = Math.sqrt((throw_distance/time_in_the_air)**2 + (9.8*time_in_the_air/2)**2);
    let initial_angle = Math.atan(((9.8 * (time_in_the_air**2))/(2*throw_distance)));
    let y = ball.position.y;
    let x = hand.x - ball.position.x;
    let z = hand.z - ball.position.z;
    let directionNormalized = new Vec3(x, y, z).unit();
    directionNormalized.y = Math.sin(initial_angle);
    ball.velocity = directionNormalized.scale(initial_velocity);
    // ball.velocity = directionNormalized.mult(0.1);
  }
}
