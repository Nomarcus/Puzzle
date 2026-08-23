/**
 * Burst particles.
 *
 * Cleared blocks do not simply vanish — they break into sweets that fly out,
 * tumble and fall. The direction is radial, away from the hub, so a ring
 * clearing throws its debris outwards like a wheel and a bullseye throws the
 * whole disc at once.
 *
 * Purely cosmetic: the engine has already moved on by the time any of this
 * draws, and the list is hard-capped so a full-board sweep cannot bog down a
 * phone.
 */

import type { Theme } from "./theme.js";
import { drawCandySquare } from "./candy.js";

/** Above this the frame rate matters more than the confetti. */
const MAX_PARTICLES = 420;
const GRAVITY = 1400;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  colour: number;
  angle: number;
  spin: number;
  life: number;
  maxLife: number;
}

export interface BurstOptions {
  readonly count?: number;
  readonly speed?: number;
  readonly size?: number;
  /** Pushes the debris away from this point rather than in all directions. */
  readonly awayFrom?: { x: number; y: number };
}

/**
 * Deterministic scatter rather than Math.random: the same clear looks the same
 * every time, which makes a recorded clip reproducible and keeps the engine's
 * no-randomness rule honest even in the cosmetic layer.
 */
function scatter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function burst(
  particles: Particle[],
  x: number,
  y: number,
  colour: number,
  options: BurstOptions = {},
): void {
  const count = options.count ?? 6;
  const speed = options.speed ?? 210;
  const size = options.size ?? 11;

  // Radial direction from the hub, so debris flies outwards off the disc.
  let baseAngle = scatter(x * 3.1 + y) * Math.PI * 2;
  if (options.awayFrom) {
    baseAngle = Math.atan2(y - options.awayFrom.y, x - options.awayFrom.x);
  }

  for (let i = 0; i < count; i++) {
    if (particles.length >= MAX_PARTICLES) return;

    const jitter = scatter(x + y * 7.7 + i * 1.37);
    const jitter2 = scatter(x * 2.3 + y + i * 5.11);
    const angle = baseAngle + (jitter - 0.5) * 2.4;
    const power = speed * (0.45 + jitter2 * 0.9);
    const life = 0.5 + jitter * 0.45;

    particles.push({
      x,
      y,
      vx: Math.cos(angle) * power,
      vy: Math.sin(angle) * power - 90,
      size: size * (0.6 + jitter2 * 0.7),
      colour,
      angle: jitter * Math.PI,
      spin: (jitter2 - 0.5) * 14,
      life,
      maxLife: life,
    });
  }
}

export function stepParticles(particles: Particle[], dtMs: number): Particle[] {
  const dt = dtMs / 1000;
  const alive: Particle[] = [];

  for (const p of particles) {
    p.life -= dt;
    if (p.life <= 0) continue;
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.angle += p.spin * dt;
    alive.push(p);
  }

  return alive;
}

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: readonly Particle[],
  theme: Theme,
): void {
  for (const p of particles) {
    // Fade only over the last third, so the burst reads as solid confetti
    // rather than a puff of smoke.
    const t = p.life / p.maxLife;
    const alpha = t > 0.34 ? 1 : t / 0.34;
    drawCandySquare(ctx, p.x, p.y, p.size, p.angle, p.colour, theme, alpha);
  }
}
