import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { build } from "esbuild";

const project = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(project, "node_modules", "ascii-test-"));
after(() => rmSync(directory, { recursive: true, force: true }));
await build({
	entryPoints: [join(project, "src/components/ascii/ascii-scenes-utils.ts")],
	outfile: join(directory, "scenes.mjs"), bundle: true, platform: "node", format: "esm", logLevel: "silent",
});
const scenes = await import(pathToFileURL(join(directory, "scenes.mjs")).href);

test("the ramp maps darkness to ink and clamps out-of-range levels", () => {
	assert.equal(scenes.rampChar(0), " ");
	assert.equal(scenes.rampChar(1), "@");
	assert.equal(scenes.rampChar(-3), " ");
	assert.equal(scenes.rampChar(9), "@");
});

for (const name of Object.keys(scenes.ASCII_SCENES)) {
	test(`${name}: fills the grid exactly, is deterministic and moves over time`, () => {
		const scene = scenes.ASCII_SCENES[name];
		for (const [cols, rows] of [[24, 9], [64, 14]]) {
			const frame = scene(1000, cols, rows);
			assert.equal(frame.cells.length, cols * rows);
			assert.ok(frame.cells.every((cell) => cell.ch.length === 1 && cell.alpha >= 0 && cell.alpha <= 1));
		}
		const a = scenes.frameToText(scene(1234, 64, 14));
		assert.equal(scenes.frameToText(scene(1234, 64, 14)), a, "same time, same frame");
		assert.notEqual(scenes.frameToText(scene(4321, 64, 14)), a, "different time, different frame");
	});
}

test("the inbox-zero envelope stays whole and centred while it bobs", () => {
	for (const time of [0, 700, 1400, 2400]) {
		const text = scenes.frameToText(scenes.envelopeScene(time, 64, 14));
		assert.ok(text.includes("|\\              /|"), `envelope at t=${time}`);
		assert.ok(text.includes("|________________|"));
		const row = text.split("\n").find((line) => line.includes("|________________|"));
		assert.equal(row.indexOf("|________________|"), Math.floor((64 - 18) / 2));
	}
});

test("the 404 scene spells 404 in block glyphs", () => {
	const text = scenes.frameToText(scenes.notFoundScene(2400, 64, 13));
	assert.ok(text.split("\n").some((line) => line.includes("##########")), "the 4 crossbar");
});
