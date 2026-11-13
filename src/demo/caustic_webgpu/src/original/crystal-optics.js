import { Fn, If, refract, struct } from "../../vendor/three/build/three.tsl.js";

export const CRYSTAL_DISPERSION = 0.006;

const CrystalRay = struct({
  origin: "vec3",
  direction: "vec3",
  glassDistance: "float",
});

// Trace the front and back walls of a water-filled glass globe. At grazing
// angles a ray may stay in the solid annulus rather than entering the core.
// The same construction drives the visible refraction and the photon sheet.
export const traceCrystal = Fn(
  ([entry, incident, eta, center, radius, thickness]) => {
    const normal = entry.sub(center).normalize();
    const inside = refract(incident, normal, eta.reciprocal()).toVar();
    const distance = entry.sub(center).dot(inside).mul(-2).toVar();
    const exit = entry.add(inside.mul(distance)).toVar();
    const outgoing = refract(
      inside,
      exit.sub(center).normalize().negate(),
      eta,
    ).toVar();
    const innerRadius = radius.sub(thickness).max(0);
    const q = entry.sub(center),
      b = q.dot(inside);
    const discriminant = b.pow2().sub(q.dot(q)).add(innerRadius.pow2());
    If(innerRadius.greaterThan(0.001).and(discriminant.greaterThan(0)), () => {
      const entryDistance = b.negate().sub(discriminant.sqrt());
      const innerEntry = entry.add(inside.mul(entryDistance));
      const coreRay = refract(inside, innerEntry.sub(center).normalize(), eta);
      If(coreRay.dot(coreRay).greaterThan(0.5), () => {
        const coreDistance = innerEntry.sub(center).dot(coreRay).mul(-2);
        const innerExit = innerEntry.add(coreRay.mul(coreDistance));
        const shellRay = refract(
          coreRay,
          innerExit.sub(center).normalize().negate(),
          eta.reciprocal(),
        );
        const v = innerExit.sub(center),
          dot = v.dot(shellRay);
        const exitDistance = dot
          .negate()
          .add(dot.pow2().sub(v.dot(v)).add(radius.pow2()).max(0).sqrt());
        exit.assign(innerExit.add(shellRay.mul(exitDistance)));
        outgoing.assign(
          refract(shellRay, exit.sub(center).normalize().negate(), eta),
        );
        distance.assign(entryDistance.add(exitDistance));
      });
    });
    return CrystalRay(exit, outgoing, distance);
  },
);
