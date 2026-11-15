import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(project, "node_modules", "offline-store-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	entryPoints: [join(project, "src/lib/offline/store.ts")],
	outfile: join(directory, "store.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "silent",
});
await build({
	entryPoints: [join(project, "src/lib/offline/store-utils.ts")],
	outfile: join(directory, "utils.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "silent",
});
const utils = await import(pathToFileURL(join(directory, "utils.mjs")).href);
const store = await import(pathToFileURL(join(directory, "store.mjs")).href);

test("only requests that never reached the server count as network failures", () => {
	assert.equal(utils.isNetworkFailure(new TypeError("Failed to fetch"), true), true);
	assert.equal(utils.isNetworkFailure(new Error("Message request invalidated"), true), false);
	assert.equal(utils.isNetworkFailure(new SyntaxError("bad json"), true), false);
	assert.equal(utils.isNetworkFailure(new Error("anything"), false), true);
});

test("old entries are not served and eviction drops the oldest first", () => {
	const now = Date.now();
	assert.equal(utils.isFreshEntry({ key: "a", value: 1, savedAt: now - 1000 }, now), true);
	assert.equal(utils.isFreshEntry({ key: "a", value: 1, savedAt: now - utils.OFFLINE_MAX_AGE_MS - 1 }, now), false);
	assert.equal(utils.isFreshEntry(undefined, now), false);
	const entries = [{ key: "new", savedAt: 3 }, { key: "old", savedAt: 1 }, { key: "mid", savedAt: 2 }];
	assert.deepEqual(utils.keysToEvict(entries, 1), ["old", "mid"]);
	assert.deepEqual(utils.keysToEvict(entries, 5), []);
});

test("without IndexedDB the fallback passes results and errors through", async () => {
	assert.equal(await store.withOfflineFallback("k", async () => 42), 42);
	await assert.rejects(store.withOfflineFallback("k", async () => { throw new TypeError("Failed to fetch"); }), TypeError);
	await assert.rejects(store.withOfflineFallback("k", async () => { throw new Error("server said no"); }), /server said no/);
	assert.equal(await store.readOffline("k"), undefined);
	await store.clearOffline();
});

test("serving a saved copy flips the offline state and a server answer clears it", async () => {
	assert.equal(store.isServingOffline(), false);
	await store.withOfflineFallback("k", async () => 1);
	assert.equal(store.isServingOffline(), false);
});
