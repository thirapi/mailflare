"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ASCII_SCENES, type AsciiSceneName } from "./ascii-scenes-utils";
import { readAsciiAnimationEnabled, ASCII_ANIMATION_CHANGED_EVENT } from "./ascii-preferences";

const FONT_SIZE = 13;
const FONT = `${FONT_SIZE}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.25);
/** Retro pace: smooth enough to read as motion, cheap enough to leave running. */
const FPS = 15;
/** The frame shown when motion is off: chosen so the scene reads well standing still. */
const STILL_TIME = 2400;

type Props = {
	scene: AsciiSceneName;
	rows?: number;
	maxCols?: number;
	className?: string;
};

/**
 * Decorative ASCII animation on a canvas, drawn in the element's text colour (the theme accent by default).
 * It is aria-hidden; the surrounding text carries the meaning. Motion stops for prefers-reduced-motion, when the
 * user turned animations off, while the tab is hidden and while the canvas is scrolled out of view.
 */
export function AsciiArt({ scene, rows = 14, maxCols = 72, className }: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !context) return;
		const draw = ASCII_SCENES[scene];
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let cols = 0;
		let cellWidth = 8;
		let visible = true;
		let frameId: number | null = null;
		let lastDrawn = -Infinity;
		const startedAt = performance.now();

		const layout = () => {
			const ratio = window.devicePixelRatio || 1;
			context.font = FONT;
			cellWidth = context.measureText("M").width || FONT_SIZE * 0.6;
			const available = canvas.parentElement?.clientWidth ?? canvas.clientWidth;
			cols = Math.max(24, Math.min(maxCols, Math.floor(available / cellWidth)));
			const width = Math.ceil(cols * cellWidth);
			const height = rows * LINE_HEIGHT;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			canvas.width = Math.ceil(width * ratio);
			canvas.height = Math.ceil(height * ratio);
			context.setTransform(ratio, 0, 0, ratio, 0, 0);
		};

		const render = (time: number) => {
			const frame = draw(time, cols, rows);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.font = FONT;
			context.textBaseline = "top";
			context.fillStyle = getComputedStyle(canvas).color;
			for (let y = 0; y < frame.rows; y++) {
				for (let x = 0; x < frame.cols; x++) {
					const cell = frame.cells[y * frame.cols + x];
					if (cell.ch === " " || cell.alpha <= 0) continue;
					context.globalAlpha = cell.alpha;
					context.fillText(cell.ch, x * cellWidth, y * LINE_HEIGHT);
				}
			}
			context.globalAlpha = 1;
		};

		const animating = () => !reducedMotion.matches && readAsciiAnimationEnabled() && visible && document.visibilityState === "visible";

		const loop = (now: number) => {
			frameId = null;
			if (!animating()) return;
			if (now - lastDrawn >= 1000 / FPS) {
				lastDrawn = now;
				render(now - startedAt);
			}
			frameId = requestAnimationFrame(loop);
		};

		const restart = () => {
			if (frameId !== null) cancelAnimationFrame(frameId);
			frameId = null;
			if (animating()) frameId = requestAnimationFrame(loop);
			else render(STILL_TIME);
		};

		layout();
		render(STILL_TIME);
		restart();

		const resize = new ResizeObserver(() => {
			layout();
			render(animating() ? performance.now() - startedAt : STILL_TIME);
		});
		if (canvas.parentElement) resize.observe(canvas.parentElement);
		const intersection = new IntersectionObserver(([entry]) => {
			visible = entry?.isIntersecting ?? true;
			restart();
		});
		intersection.observe(canvas);
		document.addEventListener("visibilitychange", restart);
		reducedMotion.addEventListener("change", restart);
		window.addEventListener(ASCII_ANIMATION_CHANGED_EVENT, restart);
		// Theme or style switches change the ink colour; redraw on the next frame.
		window.addEventListener("mailflare:theme-changed", restart);
		window.addEventListener("mailflare:style-changed", restart);
		return () => {
			if (frameId !== null) cancelAnimationFrame(frameId);
			resize.disconnect();
			intersection.disconnect();
			document.removeEventListener("visibilitychange", restart);
			reducedMotion.removeEventListener("change", restart);
			window.removeEventListener(ASCII_ANIMATION_CHANGED_EVENT, restart);
			window.removeEventListener("mailflare:theme-changed", restart);
			window.removeEventListener("mailflare:style-changed", restart);
		};
	}, [scene, rows, maxCols]);

	return (
		<div className={cn("flex justify-center overflow-hidden text-blue-600", className)} aria-hidden="true">
			<canvas ref={canvasRef} className="block max-w-full" />
		</div>
	);
}
