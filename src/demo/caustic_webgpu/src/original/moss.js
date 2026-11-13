import {
  color,
  float,
  mix,
  mx_noise_float,
  normalWorldGeometry,
  positionWorld,
  texture,
} from "../../vendor/three/build/three.tsl.js";
import { DataTexture, RedFormat, LinearFilter } from "../../vendor/three/build/three.webgpu.js";
import {
  TERRACE_START,
  TERRACE_WIDTH,
  TERRACE_RISE,
  TERRACE_COUNT,
  PLINTH_RADIUS,
} from "./architecture.js";

export function createRootCover() {
  const size = 512,
    extent = 24,
    data = new Uint8Array(size * size);
  const map = new DataTexture(data, size, size, RedFormat);
  map.minFilter = map.magFilter = LinearFilter;
  map.needsUpdate = true;
  return {
    map,
    grow(roots) {
      data.fill(0);
      for (const { x, z, radius } of roots) {
        const cx = (x / extent + 0.5) * size,
          cy = (z / extent + 0.5) * size;
        const r = (radius / extent) * size;
        for (
          let y = Math.max(0, Math.floor(cy - r));
          y <= Math.min(size - 1, Math.ceil(cy + r));
          y++
        )
          for (
            let x = Math.max(0, Math.floor(cx - r));
            x <= Math.min(size - 1, Math.ceil(cx + r));
            x++
          ) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
            const weight = Math.max(0, 1 - d * d);
            const i = y * size + x;
            data[i] = Math.max(data[i], Math.round(weight * weight * 255));
          }
      }
      map.needsUpdate = true;
    },
  };
}

export function createMoss(field, amount, rootMap) {
  const p = positionWorld,
    radius = p.xz.length();
  const terrace = radius.sub(TERRACE_START).div(TERRACE_WIDTH);
  const fraction = terrace.fract();
  const stairEdge = fraction
    .min(fraction.oneMinus())
    // Beyond the last riser there is one continuous shelf, not more seams.
    .max(terrace.sub(TERRACE_COUNT - 1).max(0))
    .mul(TERRACE_WIDTH);
  const platformEdge = radius
    .sub(3.55)
    .abs()
    .min(radius.sub(3.8).abs())
    .min(radius.sub(4.05).abs())
    .min(radius.sub(PLINTH_RADIUS).abs());
  const edge = radius
    .greaterThan(TERRACE_START)
    .select(stairEdge, platformEdge);
  const patch = mx_noise_float(p.mul(0.9), 0.5, 0.5)
    .mul(0.65)
    .add(field.a.mul(0.35));
  const grain = field.b.mul(0.65).add(field.g.mul(0.35));
  const width = patch.mul(0.14).add(0.015);
  const seam = edge.smoothstep(0.004, width).oneMinus();
  const floor = radius
    .greaterThanEqual(TERRACE_START)
    .select(
      terrace.floor().add(1).min(TERRACE_COUNT).mul(TERRACE_RISE),
      radius
        .lessThan(3.55)
        .select(
          0.2,
          radius
            .lessThan(3.8)
            .select(0.12, radius.lessThan(4.05).select(0.06, 0)),
        ),
    );
  const upright = normalWorldGeometry.y.abs().smoothstep(0.35, 0.8).oneMinus();
  const foot = p.y
    .sub(floor)
    .max(0)
    .smoothstep(0.015, 0.34)
    .oneMinus()
    .mul(upright);
  const rooted = texture(rootMap, p.xz.div(24).add(0.5)).r.mul(
    p.y.sub(floor).abs().smoothstep(0.06, 0.32).oneMinus(),
  );
  const mask = seam
    .mul(upright.oneMinus())
    .max(foot)
    .mul(patch.smoothstep(0.43, 0.61))
    .max(rooted.mul(patch.smoothstep(0.25, 0.6)))
    .mul(grain.smoothstep(0.2, 0.63))
    .mul(amount)
    .clamp();
  return {
    mask,
    grain,
    color: mix(
      color("#23471a"),
      color("#7b873b"),
      grain.mul(0.7).add(patch.mul(0.3)),
    ),
    roughness: float(0.94),
  };
}
