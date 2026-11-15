import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(project, "node_modules", "list-density-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	entryPoints: [join(project, "src/components/messages/list-density-utils.ts")],
	outfile: join(directory, "utils.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "silent",
});
const utils = await import(pathToFileURL(join(directory, "utils.mjs")).href);

test("unknown stored values fall back to the default density", () => {
	assert.equal(utils.parseListDensity(null), "default");
	assert.equal(utils.parseListDensity("tiny"), "default");
	assert.equal(utils.parseListDensity("compact"), "compact");
});

test("each density gives a distinct row size and compact hides the narrow preview", () => {
	const heights = new Set(utils.LIST_DENSITIES.map(utils.wideRowHeightClass));
	const paddings = new Set(utils.LIST_DENSITIES.map(utils.narrowRowPaddingClass));
	assert.equal(heights.size, 3);
	assert.equal(paddings.size, 3);
	assert.equal(utils.wideRowHeightClass("default"), "min-h-12");
	assert.equal(utils.showsNarrowPreview("compact"), false);
	assert.equal(utils.showsNarrowPreview("comfortable"), true);
});
