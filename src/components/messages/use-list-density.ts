import { useCallback, useLayoutEffect, useState } from "react";
import {
	LIST_DENSITY_CHANGE_EVENT,
	LIST_DENSITY_STORAGE_KEY,
	parseListDensity,
	type ListDensity,
} from "./list-density-utils";

function readStored(): ListDensity {
	try {
		return parseListDensity(localStorage.getItem(LIST_DENSITY_STORAGE_KEY));
	} catch {
		return "default";
	}
}

export function useListDensity(): [ListDensity, (density: ListDensity) => void] {
	const [density, setDensity] = useState<ListDensity>("default");

	useLayoutEffect(() => {
		const sync = () => setDensity(readStored());
		sync();
		window.addEventListener(LIST_DENSITY_CHANGE_EVENT, sync);
		window.addEventListener("storage", sync);
		return () => {
			window.removeEventListener(LIST_DENSITY_CHANGE_EVENT, sync);
			window.removeEventListener("storage", sync);
		};
	}, []);

	const update = useCallback((next: ListDensity) => {
		try {
			if (next === "default") localStorage.removeItem(LIST_DENSITY_STORAGE_KEY);
			else localStorage.setItem(LIST_DENSITY_STORAGE_KEY, next);
		} catch {
			// The preference still applies until this page is closed.
		}
		setDensity(next);
		window.dispatchEvent(new Event(LIST_DENSITY_CHANGE_EVENT));
	}, []);

	return [density, update];
}
