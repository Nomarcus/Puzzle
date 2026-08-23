/**
 * Art direction.
 *
 * Hard rule, from the brief: this must look like a toy, not like a dashboard.
 * That means NO indigo/violet gradients, NO dark slate background, NO neon
 * glow, NO glassmorphism — the whole default "AI app" palette is off limits.
 *
 * What we want instead is Block Blast: a bright background, fat rounded
 * shapes, and saturated candy colours with a light top edge and a darker
 * bottom edge so every block reads as a little 3D sweet.
 */

export interface BlockColour {
  readonly base: string;
  readonly light: string;
  readonly dark: string;
}

export interface Theme {
  readonly id: string;
  readonly label: string;
  /** Page background, painted as a vertical gradient. */
  readonly backdrop: readonly [string, string];
  /** The disc the puzzle sits on. */
  readonly plate: string;
  readonly plateEdge: string;
  /** An unfilled cell. */
  readonly empty: string;
  readonly emptyEdge: string;
  /** Outline drawn around every filled block. */
  readonly blockOutline: string;
  readonly text: string;
  readonly textSoft: string;
  /** Index 0 is unused — colour ids start at 1 to keep 0 meaning "empty". */
  readonly blocks: readonly BlockColour[];
}

function candy(base: string, light: string, dark: string): BlockColour {
  return { base, light, dark };
}

/**
 * Eight blocks, spaced around the wheel and also separated by lightness, so
 * they stay distinguishable for colour-blind players rather than relying on
 * hue alone.
 */
const CANDY_BLOCKS: readonly BlockColour[] = [
  candy("#FF4D5E", "#FF8A95", "#D62A3D"), // 1 strawberry
  candy("#FF8A1F", "#FFB264", "#D96706"), // 2 orange
  candy("#FFC61A", "#FFDD70", "#D9A000"), // 3 lemon
  candy("#5FCC28", "#93E066", "#3EA111"), // 4 apple
  candy("#00C3BE", "#5BDCD8", "#009B97", ), // 5 mint
  candy("#2E8BFF", "#77B4FF", "#1568D6"), // 6 blueberry
  candy("#9B5DE5", "#BE93F0", "#7638C4"), // 7 grape
  candy("#FF5FA2", "#FF97C2", "#DB3A7E"), // 8 bubblegum
];

/** Bright sky. Reads instantly as a mobile puzzle game. */
export const SKY: Theme = {
  id: "sky",
  label: "Sky",
  backdrop: ["#63CDFF", "#2E9BE8"],
  plate: "#F3FAFF",
  plateEdge: "#C2E4F7",
  empty: "#DCEBF5",
  emptyEdge: "#C3DCEC",
  blockOutline: "rgba(28, 52, 74, 0.20)",
  text: "#12384F",
  textSoft: "#5B8AA6",
  blocks: CANDY_BLOCKS,
};

/** Warm cream. Softer and more "wooden toy" than the sky. */
export const CREAM: Theme = {
  id: "cream",
  label: "Cream",
  backdrop: ["#FFE9BF", "#FFC377"],
  plate: "#FFFBF0",
  plateEdge: "#F0DCB8",
  empty: "#EFE0C6",
  emptyEdge: "#DCC8A6",
  blockOutline: "rgba(90, 60, 20, 0.20)",
  text: "#5A3B14",
  textSoft: "#A5824F",
  blocks: CANDY_BLOCKS,
};

/** Fresh mint. Cooler, a little more grown-up, still nowhere near techy. */
export const MINT: Theme = {
  id: "mint",
  label: "Mint",
  backdrop: ["#B8F2D8", "#63D6A8"],
  plate: "#F4FFFA",
  plateEdge: "#BCE8D3",
  empty: "#D9EFE4",
  emptyEdge: "#BADCC9",
  blockOutline: "rgba(20, 66, 48, 0.20)",
  text: "#14513A",
  textSoft: "#579B7C",
  blocks: CANDY_BLOCKS,
};

export const THEMES: readonly Theme[] = [SKY, CREAM, MINT];

export function blockColour(theme: Theme, colourId: number): BlockColour {
  return theme.blocks[(colourId - 1) % theme.blocks.length]!;
}
