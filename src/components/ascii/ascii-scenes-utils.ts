/**
 * ASCII scenes: pure functions from (time, grid size) to characters and their ink strength. They hold no state and
 * read no clock or Math.random, so a given time always draws the same frame (tests and reduced motion rely on it).
 */

export type AsciiCell = { ch: string; alpha: number };
export type AsciiFrame = { cols: number; rows: number; cells: AsciiCell[] };
export type AsciiSceneName = "envelope" | "signal-lost" | "not-found";
export type AsciiScene = (time: number, cols: number, rows: number) => AsciiFrame;

/** Dark to light: denser glyphs carry more ink. */
export const RAMP = " .:-=+*#%@";

export function rampChar(level: number): string {
	const clamped = Math.min(1, Math.max(0, level));
	return RAMP[Math.round(clamped * (RAMP.length - 1))];
}

/** Integer hash to [0, 1): deterministic "randomness" per cell and frame. */
export function hash(x: number, y: number, seed = 0): number {
	let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

function blank(cols: number, rows: number): AsciiFrame {
	return { cols, rows, cells: Array.from({ length: cols * rows }, () => ({ ch: " ", alpha: 0 })) };
}

function put(frame: AsciiFrame, x: number, y: number, ch: string, alpha: number) {
	if (x < 0 || y < 0 || x >= frame.cols || y >= frame.rows || ch === " ") return;
	frame.cells[y * frame.cols + x] = { ch, alpha };
}

function stamp(frame: AsciiFrame, sprite: readonly string[], left: number, top: number, alpha: number) {
	sprite.forEach((line, dy) => {
		for (let dx = 0; dx < line.length; dx++) put(frame, left + dx, top + dy, line[dx], alpha);
	});
}

const ENVELOPE = [
	" ________________ ",
	"|\\              /|",
	"| \\            / |",
	"|  \\          /  |",
	"|   \\________/   |",
	"|                |",
	"|________________|",
] as const;

/**
 * Inbox zero: an envelope bobbing over a calm sea of ramp characters, with a few twinkles around it.
 * Character cells are about twice as tall as wide, so vertical distances are doubled in the wave maths.
 */
export const envelopeScene: AsciiScene = (time, cols, rows) => {
	const frame = blank(cols, rows);
	const seaTop = Math.floor(rows * 0.68);
	for (let y = seaTop; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const depth = (y - seaTop) / Math.max(1, rows - seaTop);
			const wave = Math.sin(x * 0.16 + time * 0.0011) * 0.5 + Math.sin(x * 0.05 - time * 0.0007 + y * 0.9) * 0.5;
			const level = (wave + 1) / 2 * (0.35 + depth * 0.65);
			if (level < 0.12) continue;
			put(frame, x, y, rampChar(level), 0.18 + level * 0.32);
		}
	}
	const width = ENVELOPE[0].length;
	const left = Math.floor((cols - width) / 2);
	const bob = Math.round(Math.sin(time * 0.0016) * 1.2);
	const top = Math.max(0, seaTop - ENVELOPE.length - 2 + bob);
	stamp(frame, ENVELOPE, left, top, 1);
	// Twinkles: each slot lights for part of a slow cycle, at a fixed spot around the envelope.
	for (let i = 0; i < 9; i++) {
		const phase = (time * 0.0006 + hash(i, 7) * 10) % 1;
		if (phase > 0.45) continue;
		const x = Math.floor(hash(i, 1) * cols);
		const y = Math.floor(hash(i, 2) * Math.max(1, seaTop - 1));
		if (x >= left - 1 && x <= left + width && y >= top - 1 && y <= top + ENVELOPE.length) continue;
		put(frame, x, y, phase < 0.15 || phase > 0.3 ? "." : phase < 0.22 ? "+" : "*", 0.55);
	}
	return frame;
};

/** 5×5 block glyphs, each pixel drawn two characters wide to keep the square look in tall cells. */
const GLYPHS: Record<string, readonly string[]> = {
	"4": ["#..#.", "#..#.", "#####", "...#.", "...#."],
	"0": [".###.", "#...#", "#...#", "#...#", ".###."],
};

function stampText(frame: AsciiFrame, text: string, top: number, time: number) {
	const glyphWidth = 5 * 2;
	const gap = 2;
	const total = text.length * glyphWidth + (text.length - 1) * gap;
	let left = Math.floor((frame.cols - total) / 2);
	for (const char of text) {
		const glyph = GLYPHS[char];
		if (glyph) {
			glyph.forEach((line, dy) => {
				for (let dx = 0; dx < 5; dx++) {
					if (line[dx] !== "#") continue;
					// Now and then a pixel drops out, as if the signal flickered.
					const flicker = hash(left + dx, dy, Math.floor(time / 90)) < 0.06;
					for (let k = 0; k < 2; k++) put(frame, left + dx * 2 + k, top + dy, flicker ? ":" : "#", flicker ? 0.4 : 1);
				}
			});
		}
		left += glyphWidth + gap;
	}
}

/**
 * Static and drifting glitch bands, the look of a lost signal. `label` (e.g. "404") is drawn large in the middle;
 * without one a flat line is drawn instead, the trace of a connection that went quiet.
 */
function glitchScene(label: string | null): AsciiScene {
	return (time, cols, rows) => {
		const frame = blank(cols, rows);
		const tick = Math.floor(time / 70);
		const band = Math.floor((time / 40) % (rows + 8)) - 4;
		for (let y = 0; y < rows; y++) {
			const shift = Math.abs(y - band) < 2 ? Math.floor(hash(y, tick, 3) * 6) - 3 : 0;
			for (let x = 0; x < cols; x++) {
				const noise = hash(x + shift, y, tick);
				if (noise < 0.82) continue;
				const level = (noise - 0.82) / 0.18;
				put(frame, x, y, rampChar(level * 0.7), 0.12 + level * 0.28 + (shift ? 0.15 : 0));
			}
		}
		const middle = Math.floor(rows / 2);
		if (label) {
			stampText(frame, label, middle - 3, time);
		} else {
			// A pulse that travels along a flat line and fades, then the line stays quiet.
			const pulseX = Math.floor(((time * 0.02) % (cols + 30)) - 15);
			for (let x = 0; x < cols; x++) {
				const distance = x - pulseX;
				const blip = distance >= 0 && distance < 6 ? [-1, -2, 2, 1, 0, 0][distance] : 0;
				put(frame, x, middle + blip, blip ? (blip < 0 ? "^" : "v") : "_", blip ? 1 : 0.7);
			}
		}
		return frame;
	};
}

export const signalLostScene: AsciiScene = glitchScene(null);
export const notFoundScene: AsciiScene = glitchScene("404");

export const ASCII_SCENES: Record<AsciiSceneName, AsciiScene> = {
	envelope: envelopeScene,
	"signal-lost": signalLostScene,
	"not-found": notFoundScene,
};

/** A frame as plain text, one line per row: the static fallback for screen readers and tests. */
export function frameToText(frame: AsciiFrame): string {
	const lines: string[] = [];
	for (let y = 0; y < frame.rows; y++) {
		lines.push(frame.cells.slice(y * frame.cols, (y + 1) * frame.cols).map((cell) => cell.ch).join("").trimEnd());
	}
	return lines.join("\n");
}
