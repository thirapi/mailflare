"use client";

import { useSyncExternalStore } from "react";
import { isServingOffline } from "@/lib/offline/store";
import { OFFLINE_STATE_EVENT } from "@/lib/offline/store-utils";

function subscribe(onChange: () => void) {
	window.addEventListener("online", onChange);
	window.addEventListener("offline", onChange);
	window.addEventListener(OFFLINE_STATE_EVENT, onChange);
	return () => {
		window.removeEventListener("online", onChange);
		window.removeEventListener("offline", onChange);
		window.removeEventListener(OFFLINE_STATE_EVENT, onChange);
	};
}

const readOffline = () => !navigator.onLine || isServingOffline();
const serverOffline = () => false;

/** True when the device is offline or the last request could not reach the server. */
export function useOffline(): boolean {
	return useSyncExternalStore(subscribe, readOffline, serverOffline);
}
