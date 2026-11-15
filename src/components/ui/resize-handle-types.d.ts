export type ResizeHandleProps = {
	label: string;
	onResizeStart?: () => void;
	onResize: (delta: number) => void;
	onResizeEnd?: () => void;
	/**
	 * "edge" (default) straddles the column's right edge; "inside" keeps the whole hit area within the column,
	 * for columns that clip their overflow and would otherwise cut the handle in half.
	 */
	placement?: "edge" | "inside";
};
