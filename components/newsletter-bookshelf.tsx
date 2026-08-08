"use client";

/*
 * Vendored from componentry.dev's `newsletter-bookshelf` registry entry:
 *   pnpm dlx shadcn@latest add @componentry/newsletter-bookshelf
 *
 * No longer byte-identical to upstream. Local deltas, each marked inline with
 * a `Local delta:` comment — re-check them when re-pulling:
 *   1. `roundedRect` falls back to arcTo (Safari 16.0-16.3 throws on roundRect).
 *   2. `addTexture` repeats one cached noise tile instead of walking every
 *      pixel of every face (~626k iterations per book, synchronous at mount).
 *   3. `Book` clears the body cursor on unmount.
 *   4. The camera resets only when the set of books changes; a resize clamps
 *      the existing position instead of jumping back to the start.
 *   5. Wheel panning uses a native non-passive listener (React's onWheel is
 *      passive, so preventDefault was a no-op).
 *   6. Added the `onCurrentChange` prop so a parent can mirror which book the
 *      camera is nearest.
 */

/* eslint-disable react/no-unknown-property */

import { cn } from "@/lib/utils";
import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export interface NewsletterBookshelfItem {
  id: string;
  title: string;
  date: string;
  subtitle?: string;
  href?: string;
  color?: string;
  foil?: string;
}

export interface NewsletterBookshelfProps {
  items?: NewsletterBookshelfItem[];
  className?: string;
  height?: number | string;
  brand?: string;
  onSelect?: (item: NewsletterBookshelfItem, index: number) => void;
  /**
   * Local delta: fires whenever the camera settles nearest a different book,
   * including on load, on scroll, and after Escape closes a focused cover.
   * Pass a stable callback — it runs from an effect.
   */
  onCurrentChange?: (item: NewsletterBookshelfItem, index: number) => void;
}

type BookLayout = NewsletterBookshelfItem & {
  x: number;
  width: number;
  bookHeight: number;
  depth: number;
  motif: number;
  color: string;
  foil: string;
};

const PALETTE = [
  "#0b1e4b",
  "#16277a",
  "#2233b8",
  "#4040ff",
  "#6b7bff",
  "#9fb0ff",
  "#dce4ff",
  "#faf7ee",
  "#efe8d4",
  "#f4f2ec",
  "#25252a",
  "#3a3a40",
];

const defaultTitles = [
  "The systems issue",
  "A field guide to good taste",
  "The small team advantage",
  "Notes on building in public",
  "A better creative workflow",
  "The useful AI playbook",
  "Designing for momentum",
  "The quiet automation stack",
  "How ideas become products",
  "The founder's operating manual",
  "A week of useful experiments",
  "The leverage edition",
  "What we learned shipping early",
  "Tools worth keeping",
  "The case for fewer meetings",
  "A practical guide to agents",
  "Making software feel human",
  "The compounding details",
  "Build the smallest useful thing",
  "The creative director in your pocket",
  "Signals from the frontier",
  "A calmer way to move fast",
  "The prototype-first company",
  "Workflows that actually stick",
  "The one-person studio",
  "Notes from a strange future",
  "The high-agency handbook",
  "A new interface for work",
  "The craft issue",
  "Ideas with a pulse",
  "The independent builder",
  "A map for the next chapter",
];

export const defaultNewsletterBooks: NewsletterBookshelfItem[] =
  defaultTitles.map((title, index) => ({
    id: `edition-${defaultTitles.length - index}`,
    title,
    date: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
      .format(new Date(Date.UTC(2026, 6, 31 - index * 7, 12)))
      .toUpperCase(),
    subtitle:
      "A concise collection of practical notes, experiments, and ideas for people building what comes next.",
  }));

function hash(input: string) {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function luminance(hex: string) {
  const color = Number.parseInt(hex.slice(1), 16);
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return (
    channel((color >> 16) & 255) * 0.2126 +
    channel((color >> 8) & 255) * 0.7152 +
    channel(color & 255) * 0.0722
  );
}

function deriveLayout(items: NewsletterBookshelfItem[]) {
  let cursor = 0;
  return items.map<BookLayout>((item) => {
    const random = seeded(hash(item.id));
    const fallbackColor = PALETTE[Math.floor(random() * PALETTE.length)]!;
    const width = 0.34 + random() * 0.3;
    const bookHeight = 3.65 + (random() * 2 - 1) * 0.22;
    const color = item.color ?? fallbackColor;
    const foil =
      item.foil ?? (luminance(color) < 0.5 ? "#f2ead8" : "#3030ff");
    if (random() < 0.14) cursor += 0.2;
    const x = cursor + width / 2;
    cursor += width + 0.065;
    return {
      ...item,
      x,
      width,
      bookHeight,
      depth: bookHeight * 0.67,
      motif: Math.floor(random() * 8),
      color,
      foil,
    };
  });
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  // Local delta: Safari 16.0-16.3 exposes roundRect but can throw on it, so
  // fall back to an equivalent arcTo path. Reached via motif 2.
  if (typeof context.roundRect === "function") {
    try {
      context.roundRect(x, y, width, height, radius);
      return;
    } catch {
      // Fall through to the manual path.
    }
  }
  const capped = Math.min(radius, width / 2, height / 2);
  context.moveTo(x + capped, y);
  context.arcTo(x + width, y, x + width, y + height, capped);
  context.arcTo(x + width, y + height, x, y + height, capped);
  context.arcTo(x, y + height, x, y, capped);
  context.arcTo(x, y, x + width, y, capped);
  context.closePath();
}

function drawMotif(
  context: CanvasRenderingContext2D,
  motif: number,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  context.save();
  context.translate(x + size / 2, y + size / 2);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = Math.max(2, size * 0.035);

  if (motif === 0) {
    for (let index = -2; index <= 2; index += 1) {
      context.beginPath();
      context.arc(0, 0, size * (0.12 + index * 0.035), 0, Math.PI * 2);
      context.stroke();
    }
  } else if (motif === 1) {
    context.rotate(Math.PI / 4);
    for (let index = -1; index <= 1; index += 1) {
      context.strokeRect(
        -size * (0.24 + index * 0.055),
        -size * (0.24 + index * 0.055),
        size * (0.48 + index * 0.11),
        size * (0.48 + index * 0.11),
      );
    }
  } else if (motif === 2) {
    for (let index = 0; index < 6; index += 1) {
      context.rotate(Math.PI / 3);
      roundedRect(context, -size * 0.045, -size * 0.36, size * 0.09, size * 0.28, size * 0.04);
      context.fill();
    }
    context.beginPath();
    context.arc(0, 0, size * 0.11, 0, Math.PI * 2);
    context.fill();
  } else if (motif === 3) {
    context.beginPath();
    for (let index = 0; index < 12; index += 1) {
      const radius = index % 2 ? size * 0.17 : size * 0.35;
      const angle = -Math.PI / 2 + (index * Math.PI) / 6;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.stroke();
  } else if (motif === 4) {
    for (let row = -2; row <= 2; row += 1) {
      for (let column = -2; column <= 2; column += 1) {
        if ((row + column) % 2 === 0) {
          context.beginPath();
          context.arc(column * size * 0.13, row * size * 0.13, size * 0.035, 0, Math.PI * 2);
          context.fill();
        }
      }
    }
  } else if (motif === 5) {
    for (let index = -2; index <= 2; index += 1) {
      context.beginPath();
      context.moveTo(-size * 0.34, index * size * 0.12);
      context.bezierCurveTo(
        -size * 0.12,
        index * size * 0.12 - size * 0.11,
        size * 0.12,
        index * size * 0.12 + size * 0.11,
        size * 0.34,
        index * size * 0.12,
      );
      context.stroke();
    }
  } else if (motif === 6) {
    context.beginPath();
    context.moveTo(0, -size * 0.37);
    context.lineTo(size * 0.34, size * 0.28);
    context.lineTo(-size * 0.34, size * 0.28);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.arc(0, size * 0.02, size * 0.11, 0, Math.PI * 2);
    context.fill();
  } else {
    context.rotate(Math.PI / 4);
    context.fillRect(-size * 0.035, -size * 0.36, size * 0.07, size * 0.72);
    context.fillRect(-size * 0.36, -size * 0.035, size * 0.72, size * 0.07);
    context.beginPath();
    context.arc(0, 0, size * 0.25, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();
}

const NOISE_TILE = 128;
let noiseTile: HTMLCanvasElement | null = null;

/**
 * Local delta: one grain tile, built once per page and repeated, replacing a
 * per-pixel getImageData walk that ran three times per book (~626k iterations
 * each) synchronously while the shelf mounted.
 */
function getNoiseTile() {
  if (noiseTile) return noiseTile;
  const canvas = document.createElement("canvas");
  canvas.width = NOISE_TILE;
  canvas.height = NOISE_TILE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(NOISE_TILE, NOISE_TILE);
  const random = seeded(0x9e3779b9);
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const value = random() < 0.5 ? 0 : 255;
    image.data[offset] = value;
    image.data[offset + 1] = value;
    image.data[offset + 2] = value;
    // Matches the roughly +/-2.5 per-channel jitter of the original walk.
    image.data[offset + 3] = 8;
  }
  context.putImageData(image, 0, 0);
  noiseTile = canvas;
  return canvas;
}

function addTexture(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
) {
  const tile = getNoiseTile();
  if (!tile) return;
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) return;
  // Offset the tile per face so neighbouring books don't share a grain phase.
  const random = seeded(seed);
  const shiftX = Math.floor(random() * NOISE_TILE);
  const shiftY = Math.floor(random() * NOISE_TILE);
  context.save();
  context.translate(-shiftX, -shiftY);
  context.fillStyle = pattern;
  context.fillRect(0, 0, width + NOISE_TILE, height + NOISE_TILE);
  context.restore();
}

function drawClothWeave(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
) {
  const random = seeded(seed);
  context.save();
  context.lineCap = "round";

  context.globalCompositeOperation = "multiply";
  for (let x = 0.5; x < width; x += 3) {
    context.strokeStyle = `rgba(18, 16, 14, ${0.03 + random() * 0.035})`;
    context.lineWidth = 0.35 + random() * 0.3;
    context.beginPath();
    context.moveTo(x + (random() - 0.5) * 0.5, 0);
    context.lineTo(x + (random() - 0.5) * 0.5, height);
    context.stroke();
  }

  context.globalCompositeOperation = "screen";
  for (let y = 0.5; y < height; y += 3) {
    context.strokeStyle = `rgba(255, 248, 232, ${0.035 + random() * 0.03})`;
    context.lineWidth = 0.3 + random() * 0.25;
    context.beginPath();
    context.moveTo(0, y + (random() - 0.5) * 0.5);
    context.lineTo(width, y + (random() - 0.5) * 0.5);
    context.stroke();
  }

  context.globalCompositeOperation = "overlay";
  for (let index = 0; index < Math.floor((width * height) / 850); index += 1) {
    const x = random() * width;
    const y = random() * height;
    const length = 3 + random() * 13;
    context.strokeStyle = `rgba(255, 255, 255, ${0.035 + random() * 0.055})`;
    context.lineWidth = 0.35 + random() * 0.4;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (random() - 0.5) * 2, y + length);
    context.stroke();
  }

  context.globalCompositeOperation = "source-over";
  const edgeShade = context.createLinearGradient(0, 0, width, 0);
  edgeShade.addColorStop(0, "rgba(0,0,0,.16)");
  edgeShade.addColorStop(0.045, "rgba(0,0,0,.025)");
  edgeShade.addColorStop(0.5, "rgba(255,255,255,.025)");
  edgeShade.addColorStop(0.955, "rgba(0,0,0,.025)");
  edgeShade.addColorStop(1, "rgba(0,0,0,.18)");
  context.fillStyle = edgeShade;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function paperTexture(book: BookLayout) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 768;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const random = seeded(hash(`${book.id}-paper`));

  context.fillStyle = "#eee9dc";
  context.fillRect(0, 0, canvas.width, canvas.height);
  addTexture(context, canvas.width, canvas.height, hash(`${book.id}-paper-noise`));

  for (let y = 0.5; y < canvas.height; y += 2) {
    const warm = Math.floor(116 + random() * 35);
    context.strokeStyle = `rgba(${warm}, ${warm - 6}, ${warm - 17}, ${0.09 + random() * 0.1})`;
    context.lineWidth = random() > 0.94 ? 1 : 0.42;
    context.beginPath();
    context.moveTo((random() - 0.5) * 4, y);
    context.bezierCurveTo(
      canvas.width * 0.33,
      y + (random() - 0.5) * 0.8,
      canvas.width * 0.66,
      y + (random() - 0.5) * 0.8,
      canvas.width + (random() - 0.5) * 4,
      y,
    );
    context.stroke();
  }

  for (let x = 0.5; x < canvas.width; x += 4) {
    context.strokeStyle = `rgba(124, 103, 72, ${0.025 + random() * 0.04})`;
    context.lineWidth = 0.35;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + (random() - 0.5) * 1.5, canvas.height);
    context.stroke();
  }

  for (let index = 0; index < 170; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    context.fillStyle = `rgba(112, 91, 59, ${0.025 + random() * 0.055})`;
    context.fillRect(x, y, 0.5 + random() * 1.2, 0.5 + random() * 2.5);
  }

  const edgeShade = context.createLinearGradient(0, 0, canvas.width, 0);
  edgeShade.addColorStop(0, "rgba(96,72,42,.2)");
  edgeShade.addColorStop(0.08, "rgba(138,112,72,.035)");
  edgeShade.addColorStop(0.5, "rgba(255,255,255,.16)");
  edgeShade.addColorStop(0.92, "rgba(138,112,72,.035)");
  edgeShade.addColorStop(1, "rgba(96,72,42,.18)");
  context.fillStyle = edgeShade;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function coverTexture(book: BookLayout, brand: string, face: "cover" | "spine") {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = face === "cover" ? 512 : 112;
  canvas.height = 768;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = book.color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  addTexture(
    context,
    canvas.width,
    canvas.height,
    hash(`${book.id}-${face}-noise`),
  );
  drawClothWeave(
    context,
    canvas.width,
    canvas.height,
    hash(`${book.id}-${face}-weave`),
  );
  context.fillStyle = book.foil;
  context.strokeStyle = book.foil;
  context.textBaseline = "top";
  context.shadowColor = "rgba(0, 0, 0, .3)";
  context.shadowBlur = 1.4;
  context.shadowOffsetX = 0.8;
  context.shadowOffsetY = 1.1;

  if (face === "cover") {
    const margin = 58;
    context.font = "500 21px ui-monospace, SFMono-Regular, monospace";
    context.fillText(book.date, margin, 58);
    context.font = "700 54px Georgia, serif";
    const words = book.title.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width < canvas.width - margin * 2 || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    lines.slice(0, 5).forEach((text, index) => context.fillText(text, margin, 180 + index * 61));
    context.fillRect(margin, 180 + Math.min(lines.length, 5) * 61 + 24, 92, 5);
    drawMotif(context, book.motif, 316, 510, 130, book.foil);
    context.font = "700 19px ui-monospace, SFMono-Regular, monospace";
    context.fillText(brand.toUpperCase(), margin, 690);
  } else {
    const gradient = context.createLinearGradient(0, 0, canvas.width, 0);
    gradient.addColorStop(0, "rgba(0,0,0,.28)");
    gradient.addColorStop(0.18, "rgba(0,0,0,0)");
    gradient.addColorStop(0.82, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,.28)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = book.foil;
    context.fillRect(22, 26, canvas.width - 44, 3);
    context.fillRect(22, 704, canvas.width - 44, 3);
    context.save();
    context.translate(canvas.width / 2, 58);
    context.rotate(Math.PI / 2);
    context.font = "700 37px Georgia, serif";
    const title = book.title.length > 36 ? `${book.title.slice(0, 34)}…` : book.title;
    context.fillText(title, 0, 13);
    context.restore();
    drawMotif(context, book.motif, 29, 625, 54, book.foil);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function damp(current: number, target: number, speed: number, delta: number) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * delta));
}

const BOOK_ENTER_DURATION = 520;
const BOOK_EXIT_DURATION = 400;

function bezierCoordinate(t: number, point1: number, point2: number) {
  const inverse = 1 - t;
  return (
    3 * inverse * inverse * t * point1 +
    3 * inverse * t * t * point2 +
    t * t * t
  );
}

function easeSmoothOut(progress: number) {
  let t = progress;
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const x = bezierCoordinate(t, 0.22, 0.36);
    const inverse = 1 - t;
    const slope =
      3 * inverse * inverse * 0.22 +
      6 * inverse * t * (0.36 - 0.22) +
      3 * t * t * (1 - 0.36);
    if (Math.abs(slope) < 0.0001) break;
    t = THREE.MathUtils.clamp(t - (x - progress) / slope, 0, 1);
  }
  return bezierCoordinate(t, 1, 1);
}

function easeInOutCubic(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - ((-2 * progress + 2) ** 3) / 2;
}

function Book({
  book,
  index,
  hovered,
  selected,
  reducedMotion,
  cameraX,
  orbit,
  brand,
  onHover,
  onSelect,
}: {
  book: BookLayout;
  index: number;
  hovered: boolean;
  selected: boolean;
  reducedMotion: boolean;
  cameraX: React.MutableRefObject<number>;
  orbit: React.MutableRefObject<{ yaw: number; pitch: number }>;
  brand: string;
  onHover: (index: number | null) => void;
  onSelect: (index: number) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const focusFlight = useRef<{
    startedAt: number;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: number;
  } | null>(null);
  const exitFlight = useRef<{
    startedAt: number;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    scale: number;
  } | null>(null);
  const selectedAt = useRef(0);
  const wasSelected = useRef(false);
  const textures = useMemo(
    () => ({
      cover: coverTexture(book, brand, "cover"),
      spine: coverTexture(book, brand, "spine"),
      paper: paperTexture(book),
    }),
    [book, brand],
  );

  const geometry = useMemo(
    () =>
      new RoundedBoxGeometry(
        book.width,
        book.bookHeight,
        book.depth,
        2,
        Math.min(book.width, 0.09),
      ),
    [book.bookHeight, book.depth, book.width],
  );

  useEffect(() => {
    return () => {
      Object.values(textures).forEach((texture) => texture?.dispose());
      geometry.dispose();
    };
  }, [geometry, textures]);

  // Local delta: a book deleted while hovered never fires pointerleave, which
  // would strand the pointer cursor over the whole page.
  useEffect(
    () => () => {
      document.body.style.cursor = "";
    },
    [],
  );

  useEffect(() => {
    const node = group.current;
    if (selected && node) {
      selectedAt.current = performance.now();
      focusFlight.current = {
        startedAt: selectedAt.current,
        position: node.position.clone(),
        rotation: node.rotation.clone(),
        scale: node.scale.x,
      };
      exitFlight.current = null;
    } else if (wasSelected.current && node) {
      exitFlight.current = {
        startedAt: performance.now(),
        position: node.position.clone(),
        rotation: node.rotation.clone(),
        scale: node.scale.x,
      };
      focusFlight.current = null;
    } else {
      focusFlight.current = null;
    }
    wasSelected.current = selected;
  }, [selected]);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    const motion = reducedMotion ? 1000 : selected ? 7 : 11;
    const selectedFor = (performance.now() - selectedAt.current) / 1000;
    const autoYaw =
      selected && !reducedMotion
        ? Math.sin(selectedFor * 0.85) * 0.3
        : 0;
    const autoPitch =
      selected && !reducedMotion
        ? Math.sin(selectedFor * 0.55) * 0.04
        : 0;
    const targetX = selected ? cameraX.current : book.x;
    const targetY = selected
      ? 2.06
      : book.bookHeight / 2 + (hovered ? 0.25 : 0);
    const targetZ = selected ? 1.8 : hovered ? 0.22 : 0;
    const targetScale = selected ? 0.96 : 1;
    const targetRotationY = selected
      ? -Math.PI / 2 + orbit.current.yaw + autoYaw
      : 0;
    const targetRotationX = selected ? orbit.current.pitch + autoPitch : 0;

    const flight = selected ? focusFlight.current : null;
    if (flight) {
      const progress = reducedMotion
        ? 1
        : Math.min(
            1,
            (performance.now() - flight.startedAt) / BOOK_ENTER_DURATION,
          );
      const depthProgress = easeSmoothOut(progress);
      const travelProgress = easeSmoothOut(
        THREE.MathUtils.clamp((progress - 0.06) / 0.94, 0, 1),
      );
      const turnProgress = easeInOutCubic(progress);
      const depthArc = Math.sin(Math.PI * progress) * 0.12;
      node.position.set(
        THREE.MathUtils.lerp(flight.position.x, targetX, travelProgress),
        THREE.MathUtils.lerp(flight.position.y, targetY, travelProgress),
        THREE.MathUtils.lerp(flight.position.z, targetZ, depthProgress) +
          depthArc,
      );
      node.rotation.x = THREE.MathUtils.lerp(
        flight.rotation.x,
        targetRotationX,
        turnProgress,
      );
      node.rotation.y = THREE.MathUtils.lerp(
        flight.rotation.y,
        targetRotationY,
        turnProgress,
      );
      node.rotation.z = THREE.MathUtils.lerp(
        flight.rotation.z,
        0,
        turnProgress,
      );
      const scale = THREE.MathUtils.lerp(
        flight.scale,
        targetScale,
        turnProgress,
      );
      node.scale.setScalar(scale);
      if (progress >= 1) focusFlight.current = null;
    } else if (!selected && exitFlight.current) {
      const exit = exitFlight.current;
      const progress = reducedMotion
        ? 1
        : Math.min(
            1,
            (performance.now() - exit.startedAt) / BOOK_EXIT_DURATION,
          );
      const alignProgress = easeSmoothOut(progress);
      const slotProgress = easeSmoothOut(
        THREE.MathUtils.clamp((progress - 0.3) / 0.7, 0, 1),
      );
      node.position.set(
        THREE.MathUtils.lerp(exit.position.x, book.x, alignProgress),
        THREE.MathUtils.lerp(
          exit.position.y,
          book.bookHeight / 2,
          alignProgress,
        ),
        THREE.MathUtils.lerp(exit.position.z, 0, slotProgress),
      );
      node.rotation.x = THREE.MathUtils.lerp(
        exit.rotation.x,
        0,
        alignProgress,
      );
      node.rotation.y = THREE.MathUtils.lerp(
        exit.rotation.y,
        0,
        alignProgress,
      );
      node.rotation.z = THREE.MathUtils.lerp(
        exit.rotation.z,
        0,
        alignProgress,
      );
      const scale = THREE.MathUtils.lerp(exit.scale, 1, alignProgress);
      node.scale.setScalar(scale);
      if (progress >= 1) exitFlight.current = null;
    } else {
      node.position.x = damp(node.position.x, targetX, motion, delta);
      node.position.y = damp(node.position.y, targetY, motion, delta);
      node.position.z = damp(node.position.z, targetZ, motion, delta);
      node.rotation.y = damp(node.rotation.y, targetRotationY, motion, delta);
      node.rotation.x = damp(node.rotation.x, targetRotationX, motion, delta);
      const nextScale = damp(node.scale.x, targetScale, motion, delta);
      node.scale.setScalar(nextScale);
    }

  });

  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(index);
  };

  return (
    <group
      ref={group}
      position={[book.x, book.bookHeight / 2, 0]}
      onPointerEnter={(event) => {
        event.stopPropagation();
        onHover(index);
        document.body.style.cursor = "pointer";
      }}
      onPointerLeave={() => {
        onHover(null);
        document.body.style.cursor = "";
      }}
      onClick={select}
    >
      <mesh geometry={geometry} renderOrder={selected ? 20 : 0}>
        <meshStandardMaterial
          attach="material-0"
          map={textures.cover ?? undefined}
          color={textures.cover ? "#ffffff" : book.color}
          roughness={0.8}
          metalness={0.015}
          bumpMap={textures.cover ?? undefined}
          bumpScale={0.007}
          depthTest={!selected}
          depthWrite={!selected}
        />
        <meshStandardMaterial
          attach="material-1"
          color={book.color}
          roughness={0.84}
          bumpMap={textures.cover ?? undefined}
          bumpScale={0.006}
          depthTest={!selected}
          depthWrite={!selected}
        />
        <meshStandardMaterial
          attach="material-2"
          map={textures.paper ?? undefined}
          color={textures.paper ? "#f1eadc" : "#e9e4d8"}
          roughness={0.93}
          bumpMap={textures.paper ?? undefined}
          bumpScale={0.008}
          depthTest={!selected}
          depthWrite={!selected}
        />
        <meshStandardMaterial
          attach="material-3"
          map={textures.paper ?? undefined}
          color={textures.paper ? "#ece3d3" : "#ddd7ca"}
          roughness={0.96}
          bumpMap={textures.paper ?? undefined}
          bumpScale={0.006}
          depthTest={!selected}
          depthWrite={!selected}
        />
        <meshStandardMaterial
          attach="material-4"
          map={textures.spine ?? undefined}
          color={textures.spine ? "#ffffff" : book.color}
          roughness={0.8}
          metalness={0.015}
          bumpMap={textures.spine ?? undefined}
          bumpScale={0.007}
          depthTest={!selected}
          depthWrite={!selected}
        />
        <meshStandardMaterial
          attach="material-5"
          map={textures.paper ?? undefined}
          color={textures.paper ? "#f3eadc" : "#e6e0d4"}
          roughness={0.94}
          bumpMap={textures.paper ?? undefined}
          bumpScale={0.007}
          depthTest={!selected}
          depthWrite={!selected}
        />
      </mesh>
    </group>
  );
}

function CameraRig({ target }: { target: React.MutableRefObject<number> }) {
  const { camera } = useThree();
  useFrame((_, delta) => {
    camera.position.x = damp(camera.position.x, target.current, 8, delta);
    camera.lookAt(camera.position.x, 1.88, 0);
  });
  return null;
}

function Scene({
  books,
  hoveredIndex,
  selectedIndex,
  reducedMotion,
  cameraX,
  orbit,
  brand,
  onHover,
  onSelect,
}: {
  books: BookLayout[];
  hoveredIndex: number | null;
  selectedIndex: number | null;
  reducedMotion: boolean;
  cameraX: React.MutableRefObject<number>;
  orbit: React.MutableRefObject<{ yaw: number; pitch: number }>;
  brand: string;
  onHover: (index: number | null) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <>
      <CameraRig target={cameraX} />
      <ambientLight intensity={1.5} />
      <hemisphereLight args={["#ffffff", "#d7dce8", 1.2]} />
      <directionalLight position={[5, 8, 7]} intensity={2.2} />

      {books.map((book, index) => (
        <Book
          key={book.id}
          book={book}
          index={index}
          hovered={hoveredIndex === index && selectedIndex === null}
          selected={selectedIndex === index}
          reducedMotion={reducedMotion}
          cameraX={cameraX}
          orbit={orbit}
          brand={brand}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function nearestBook(books: BookLayout[], x: number) {
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  books.forEach((book, index) => {
    const next = Math.abs(book.x - x);
    if (next < distance) {
      nearest = index;
      distance = next;
    }
  });
  return nearest;
}

export function NewsletterBookshelf({
  items = defaultNewsletterBooks,
  className,
  height = 620,
  brand = "The Brief",
  onSelect,
  onCurrentChange,
}: NewsletterBookshelfProps) {
  const books = useMemo(
    () => deriveLayout(items.length ? items : defaultNewsletterBooks),
    [items],
  );
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [stageWidth, setStageWidth] = useState(1000);
  const stageRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const cameraX = useRef(0);
  const orbit = useRef({ yaw: 0, pitch: 0 });
  const gesture = useRef<{
    mode: "pending" | "drag" | "orbit";
    x: number;
    y: number;
    startX: number;
    startedAt: number;
  } | null>(null);
  const switchTimer = useRef<number | null>(null);
  const pendingSelection = useRef<number | null>(null);
  const suppressClick = useRef(false);

  const getBounds = useCallback(() => {
    const last = books.at(-1)?.x ?? 0;
    const aspect = stageWidth / Math.max(420, typeof height === "number" ? height : 620);
    const visibleSpan = 2 * 10 * Math.tan((35 * Math.PI) / 360) * aspect;
    const inset = visibleSpan * 0.31;
    const min = Math.min(last / 2, (books[0]?.x ?? 0) + inset);
    const max = Math.max(last / 2, last - inset);
    return max <= min ? { min: last / 2, max: last / 2, visibleSpan } : { min, max, visibleSpan };
  }, [books, height, stageWidth]);

  const moveCamera = useCallback(
    (next: number) => {
      const bounds = getBounds();
      cameraX.current = THREE.MathUtils.clamp(next, bounds.min, bounds.max);
      setCurrentIndex(nearestBook(books, cameraX.current));
    },
    [books, getBounds],
  );

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(motion.matches);
    update();
    motion.addEventListener?.("change", update);
    const stage = stageRef.current;
    if (!stage) return () => motion.removeEventListener?.("change", update);
    const resize = new ResizeObserver(([entry]) => {
      if (entry) setStageWidth(entry.contentRect.width);
    });
    resize.observe(stage);
    return () => {
      resize.disconnect();
      motion.removeEventListener?.("change", update);
    };
  }, []);

  // Local delta: this used to depend on `books` and `getBounds`, so it snapped
  // the camera back to the start of the shelf on every resize and on every
  // change of the `items` prop's identity. Reset only when the shelf's actual
  // contents change...
  const shelfKey = books.map((book) => book.id).join("|");
  const initialised = useRef(false);
  useEffect(() => {
    const bounds = getBounds();
    cameraX.current = bounds.min;
    setCurrentIndex(nearestBook(books, bounds.min));
    initialised.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelfKey]);

  // ...and on resize just keep the reader where they were, within new bounds.
  useEffect(() => {
    if (!initialised.current) return;
    const bounds = getBounds();
    cameraX.current = THREE.MathUtils.clamp(cameraX.current, bounds.min, bounds.max);
    setCurrentIndex(nearestBook(books, cameraX.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageWidth]);

  // Local delta: report which book the camera is nearest so a parent can keep
  // its own UI in step with the shelf in every state, not just on click.
  useEffect(() => {
    const book = books[currentIndex];
    if (book) onCurrentChange?.(book, currentIndex);
  }, [books, currentIndex, onCurrentChange]);

  useEffect(
    () => () => {
      if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
      document.body.style.cursor = "";
    },
    [],
  );

  const presentBook = useCallback(
    (index: number) => {
      moveCamera(books[index]!.x);
      orbit.current = { yaw: 0, pitch: 0 };
      setHoveredIndex(null);
      setSelectedIndex(index);
      onSelect?.(books[index]!, index);
    },
    [books, moveCamera, onSelect],
  );

  const openBook = useCallback(
    (index: number) => {
      const href = books[index]?.href;
      if (!href || typeof window === "undefined") return;
      try {
        const destination = new URL(href, window.location.href);
        if (destination.protocol !== "http:" && destination.protocol !== "https:") return;
        window.location.assign(destination.href);
      } catch {
        // Ignore malformed or unsupported destinations supplied by consumers.
      }
    },
    [books],
  );

  const selectBook = useCallback(
    (index: number) => {
      if (suppressClick.current) return;
      if (selectedIndex === index) {
        openBook(index);
        return;
      }

      if (selectedIndex !== null) {
        pendingSelection.current = index;
        moveCamera(books[index]!.x);
        setHoveredIndex(null);
        setSelectedIndex(null);
        orbit.current = { yaw: 0, pitch: 0 };
        if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
        switchTimer.current = window.setTimeout(() => {
          const next = pendingSelection.current;
          pendingSelection.current = null;
          switchTimer.current = null;
          if (next !== null) presentBook(next);
        }, reducedMotion ? 0 : BOOK_EXIT_DURATION);
        return;
      }

      if (switchTimer.current !== null) {
        pendingSelection.current = index;
        return;
      }

      presentBook(index);
    },
    [books, moveCamera, openBook, presentBook, reducedMotion, selectedIndex],
  );

  const close = useCallback(() => {
    setSelectedIndex(null);
    orbit.current = { yaw: 0, pitch: 0 };
    stageRef.current?.focus({ preventScroll: true });
  }, []);

  const switchFocused = useCallback(
    (direction: number) => {
      if (selectedIndex === null) return;
      const next = THREE.MathUtils.clamp(selectedIndex + direction, 0, books.length - 1);
      if (next !== selectedIndex) {
        selectBook(next);
      }
    },
    [books.length, selectBook, selectedIndex],
  );

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a")) return;
    gesture.current = {
      mode: "pending",
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startedAt: performance.now(),
    };
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (tooltipRef.current && rect) {
      tooltipRef.current.style.left = `${event.clientX - rect.left}px`;
      tooltipRef.current.style.top = `${event.clientY - rect.top}px`;
    }
    const active = gesture.current;
    if (!active) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (active.mode === "pending" && Math.hypot(event.clientX - active.startX, dy) > 7) {
      active.mode = selectedIndex === null ? "drag" : "orbit";
      suppressClick.current = true;
      stageRef.current?.setPointerCapture(event.pointerId);
      setHoveredIndex(null);
    }
    if (active.mode === "drag") {
      moveCamera(cameraX.current - dx * 0.0085);
    } else if (active.mode === "orbit") {
      orbit.current.yaw = THREE.MathUtils.clamp(orbit.current.yaw + dx * 0.006, -0.62, 0.62);
      orbit.current.pitch = THREE.MathUtils.clamp(orbit.current.pitch + dy * 0.004, -0.28, 0.28);
    }
    active.x = event.clientX;
    active.y = event.clientY;
  };

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (stageRef.current?.hasPointerCapture(event.pointerId)) {
      stageRef.current.releasePointerCapture(event.pointerId);
    }
    gesture.current = null;
    window.requestAnimationFrame(() => {
      suppressClick.current = false;
    });
  };

  // Local delta: React attaches `wheel` passively, so the preventDefault in a
  // JSX onWheel handler was a no-op and the page scrolled during a pan.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (selectedIndex !== null) return;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && !event.shiftKey) return;
      event.preventDefault();
      moveCamera(cameraX.current + (horizontal ? event.deltaX : event.deltaY) * 0.012);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [moveCamera, selectedIndex]);

  const selectedBook = selectedIndex === null ? null : books[selectedIndex];
  const hovered = hoveredIndex === null ? null : books[hoveredIndex];
  const bounds = getBounds();
  return (
    <section
      className={cn(
        "relative isolate w-full overflow-hidden bg-[#fbfbfa] text-[#171717] [--shelf-accent:#4040ff] dark:bg-[#111112] dark:text-[#f5f5f3]",
        className,
      )}
      style={{ height } as CSSProperties}
    >
      <div
        ref={stageRef}
        tabIndex={0}
        role="region"
        aria-label={
          selectedBook
            ? `${selectedBook.title} focused. Drag to rotate or activate again to open.`
            : `Interactive archive with ${books.length} editions`
        }
        className="relative h-full w-full touch-pan-y overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--shelf-accent)]"
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
        onPointerLeave={() => {
          gesture.current = null;
          setHoveredIndex(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && selectedIndex !== null) {
            event.preventDefault();
            close();
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            if (selectedIndex !== null) switchFocused(1);
            else moveCamera(cameraX.current + bounds.visibleSpan * 0.23);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            if (selectedIndex !== null) switchFocused(-1);
            else moveCamera(cameraX.current - bounds.visibleSpan * 0.23);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (selectedIndex === null) selectBook(currentIndex);
            else openBook(selectedIndex);
          }
        }}
      >
        <Canvas
          camera={{ fov: 35, near: 0.1, far: 60, position: [cameraX.current, 2.65, 10] }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          onPointerMissed={() => {
            if (selectedIndex !== null) close();
          }}
        >
          <Scene
            books={books}
            hoveredIndex={hoveredIndex}
            selectedIndex={selectedIndex}
            reducedMotion={reducedMotion}
            cameraX={cameraX}
            orbit={orbit}
            brand={brand}
            onHover={setHoveredIndex}
            onSelect={selectBook}
          />
        </Canvas>

        <div
          ref={tooltipRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-20 max-w-[300px] -translate-x-1/2 -translate-y-[calc(100%+16px)] whitespace-nowrap rounded-md bg-[#171717] px-3 py-2 font-mono text-[11px] leading-4 text-white shadow-xl transition-opacity duration-150 dark:bg-white dark:text-[#171717]",
            hovered && selectedIndex === null ? "opacity-100" : "opacity-0",
          )}
        >
          {hovered?.title}
          <span className="block text-white/50 dark:text-black/50">{hovered?.date}</span>
        </div>

      </div>
    </section>
  );
}
