/**
 * Drawing one cell of a round board.
 *
 * Canvas has no primitive for "ring sector with rounded corners", so it has to
 * be built by hand: an arc out along the inner radius, a curve round the
 * corner, a near-radial edge, an arc back along the outer radius, and so on.
 * This is the one genuinely fiddly piece of the renderer, which is why it
 * lives on its own.
 *
 * Angular padding is divided by the radius so that the gap between cells looks
 * the same number of pixels wide on the inner rings as on the outer ones.
 */

export interface SectorGeometry {
  readonly cx: number;
  readonly cy: number;
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly startAngle: number;
  readonly endAngle: number;
  /** Gap between neighbouring cells, in pixels. */
  readonly pad: number;
  /** Corner rounding, in pixels. */
  readonly corner: number;
}

function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/** Lays down the outline of one cell. Does not fill or stroke it. */
export function annularSectorPath(ctx: CanvasRenderingContext2D, g: SectorGeometry): void {
  const ri = g.innerRadius + g.pad;
  const ro = g.outerRadius - g.pad;

  if (ro <= ri) {
    ctx.beginPath();
    return;
  }

  // Shrink the sweep by a constant pixel amount at each radius.
  const ai0 = g.startAngle + g.pad / ri;
  const ai1 = g.endAngle - g.pad / ri;
  const ao0 = g.startAngle + g.pad / ro;
  const ao1 = g.endAngle - g.pad / ro;

  if (ai1 <= ai0 || ao1 <= ao0) {
    ctx.beginPath();
    return;
  }

  // A corner can never eat more than half of the edge it sits on.
  const corner = Math.min(
    g.corner,
    (ro - ri) / 2,
    ((ai1 - ai0) * ri) / 2,
    ((ao1 - ao0) * ro) / 2,
  );
  const ci = corner / ri; // corner size as an angle on the inner arc
  const co = corner / ro; // ...and on the outer arc

  ctx.beginPath();

  // Inner arc, running forwards.
  ctx.arc(g.cx, g.cy, ri, ai0 + ci, ai1 - ci);

  // Corner from the inner arc onto the trailing radial edge.
  let [vx, vy] = polar(g.cx, g.cy, ri, ai1);
  let [px, py] = polar(g.cx, g.cy, ri + corner, ai1);
  ctx.quadraticCurveTo(vx, vy, px, py);

  // Trailing radial edge.
  [px, py] = polar(g.cx, g.cy, ro - corner, ao1);
  ctx.lineTo(px, py);

  // Corner onto the outer arc.
  [vx, vy] = polar(g.cx, g.cy, ro, ao1);
  [px, py] = polar(g.cx, g.cy, ro, ao1 - co);
  ctx.quadraticCurveTo(vx, vy, px, py);

  // Outer arc, running back.
  ctx.arc(g.cx, g.cy, ro, ao1 - co, ao0 + co, true);

  // Corner onto the leading radial edge.
  [vx, vy] = polar(g.cx, g.cy, ro, ao0);
  [px, py] = polar(g.cx, g.cy, ro - corner, ao0);
  ctx.quadraticCurveTo(vx, vy, px, py);

  // Leading radial edge.
  [px, py] = polar(g.cx, g.cy, ri + corner, ai0);
  ctx.lineTo(px, py);

  // Corner back onto the start of the inner arc.
  [vx, vy] = polar(g.cx, g.cy, ri, ai0);
  [px, py] = polar(g.cx, g.cy, ri, ai0 + ci);
  ctx.quadraticCurveTo(vx, vy, px, py);

  ctx.closePath();
}

/**
 * Ring boundary radii, from the inner hole out to the rim.
 *
 * Equal-width rings make the innermost cells cramped and hard to hit with a
 * thumb; equal-area rings fix that but leave the inner cells tall and narrow.
 * `areaBias` blends the two so the choice can be made by how it feels in the
 * hand rather than by which formula is prettier.
 */
export function ringRadii(
  rings: number,
  innerRadius: number,
  outerRadius: number,
  areaBias: number,
): number[] {
  const radii: number[] = [];
  const r0sq = innerRadius * innerRadius;
  const spanSq = outerRadius * outerRadius - r0sq;

  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const equalWidth = innerRadius + t * (outerRadius - innerRadius);
    const equalArea = Math.sqrt(r0sq + t * spanSq);
    radii.push(equalWidth + (equalArea - equalWidth) * areaBias);
  }
  return radii;
}
