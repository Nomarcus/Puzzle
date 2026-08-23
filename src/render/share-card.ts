/**
 * The share card.
 *
 * Your final disc, rendered as a square image. Wordle shares a grid of
 * coloured squares; a round board can do better — the mandala you happened to
 * leave behind is different every time and is worth looking at, which is the
 * whole reason anyone posts one.
 *
 * Drawn offscreen with the same renderer as the game, so the picture is the
 * board, not an illustration of it.
 */

import type { Board } from "../engine/board.js";
import { computeLayout, drawBoard, paintBackdrop } from "./canvas.js";
import type { Theme } from "./theme.js";

const SIZE = 1080;
const FONT = '"SF Pro Rounded", ui-rounded, -apple-system, system-ui, sans-serif';

export interface ShareCard {
  readonly title: string;
  readonly score: string;
  /** Short stat pairs shown along the bottom, e.g. [["RINGS", "12"], …]. */
  readonly stats: ReadonlyArray<readonly [string, string]>;
}

function drawCard(ctx: CanvasRenderingContext2D, board: Board, theme: Theme, card: ShareCard): void {
  paintBackdrop(ctx, SIZE, SIZE, theme);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = `900 62px ${FONT}`;
  ctx.fillStyle = theme.text;
  ctx.fillText(card.title, SIZE / 2, 100);

  // The disc, sized to leave room for the score underneath.
  const layout = computeLayout(board.spec, SIZE / 2, 486, 322);
  drawBoard(ctx, board, layout, theme);

  ctx.font = `900 128px ${FONT}`;
  ctx.fillStyle = theme.text;
  ctx.fillText(card.score, SIZE / 2, 878);

  const gap = SIZE / (card.stats.length + 1);
  card.stats.forEach(([label, value], i) => {
    const x = gap * (i + 1);
    ctx.font = `800 46px ${FONT}`;
    ctx.fillStyle = theme.text;
    ctx.fillText(value, x, 972);
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = theme.textSoft;
    ctx.fillText(label, x, 1014);
  });
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  return canvas;
}

/** A PNG blob, or null if the browser refuses to encode one. */
export async function renderShareImage(
  board: Board,
  theme: Theme,
  card: ShareCard,
): Promise<Blob | null> {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  drawCard(ctx, board, theme, card);

  return new Promise((resolve) => {
    // A tainted or oversized canvas resolves null rather than throwing, and a
    // failed share must never take the result screen down with it.
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

/** The same card as a data URL, for previewing it on the result screen. */
export function renderShareDataUrl(board: Board, theme: Theme, card: ShareCard): string | null {
  const canvas = makeCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  drawCard(ctx, board, theme, card);
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}
