"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent } from "react";
import type { ResizeHandleProps } from "./resize-handle-types";

/**
 * While a column is dragged, `data-resizing` on <html> switches off layout transitions (globals.css) so the
 * column follows the pointer instead of easing towards it, and pointer moves are coalesced to one update per frame.
 */
export function ResizeHandle({ label, onResizeStart, onResize, onResizeEnd, placement = "edge" }: ResizeHandleProps) {
	const startX = useRef<number | null>(null);
	const pendingDelta = useRef<number | null>(null);
	const frame = useRef<number | null>(null);

	function flush() {
		frame.current = null;
		if (pendingDelta.current === null) return;
		const delta = pendingDelta.current;
		pendingDelta.current = null;
		onResize(delta);
	}

	function stopResizing() {
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		frame.current = null;
		delete document.documentElement.dataset.resizing;
	}

	useEffect(() => stopResizing, []);

	function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
		if (event.button !== 0) return;
		startX.current = event.clientX;
		event.currentTarget.setPointerCapture(event.pointerId);
		document.documentElement.dataset.resizing = "";
		onResizeStart?.();
		event.preventDefault();
	}

	function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
		if (startX.current === null) return;
		pendingDelta.current = event.clientX - startX.current;
		if (frame.current === null) frame.current = requestAnimationFrame(flush);
	}

	function handlePointerEnd() {
		if (startX.current === null) return;
		startX.current = null;
		// Apply the last position before saving it.
		if (frame.current !== null) cancelAnimationFrame(frame.current);
		flush();
		stopResizing();
		onResizeEnd?.();
	}

	return (
		<div
			role="separator"
			aria-label={label}
			aria-orientation="vertical"
			className={`absolute inset-y-0 right-0 z-20 cursor-col-resize touch-none transition-colors hover:bg-blue-500/20 active:bg-blue-500/30 ${placement === "inside" ? "w-2" : "w-2 translate-x-1/2"}`}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={handlePointerEnd}
			onPointerCancel={handlePointerEnd}
			onLostPointerCapture={handlePointerEnd}
		/>
	);
}
