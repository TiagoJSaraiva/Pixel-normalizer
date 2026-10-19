import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

const projectRoot = import.meta.dir;
const inputRoot = join(projectRoot, "input");
const inputDirectory = await mkdtemp(join(inputRoot, ".cell-tests-"));
const inputPath = join(inputDirectory, "fixture.png");
const inputArgument = relative(inputRoot, inputPath);
const manualOutputName = `.cell-tests-${crypto.randomUUID()}`;
const automaticOutputName = `${manualOutputName}-automatic`;
const largeCellOutputName = `${manualOutputName}-large`;

function runCli(args: string[]) {
  return spawnSync(
    process.execPath,
    ["run", join(projectRoot, "pixel-normalizer.ts"), ...args],
    { encoding: "utf8" },
  );
}

function cellStarts(length: number, size: number, offset: number): number[] {
  const starts = [0];
  for (
    let boundary = offset === 0 ? size : offset;
    boundary < length;
    boundary += size
  ) {
    if (boundary > 0) starts.push(boundary);
  }
  starts.push(length);
  return starts;
}

beforeAll(async () => {
  const width = 37;
  const height = 29;
  const size = 8;
  const offsetX = 3;
  const offsetY = 5;
  const pixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const cellY = y < offsetY ? -1 : Math.floor((y - offsetY) / size);
    for (let x = 0; x < width; x++) {
      const cellX = x < offsetX ? -1 : Math.floor((x - offsetX) / size);
      const pixel = (y * width + x) * 4;
      pixels[pixel] = 30 + (cellX + 1) * 31;
      pixels[pixel + 1] = 20 + (cellY + 1) * 47;
      pixels[pixel + 2] = 40 + (cellX + 1) * 9 + (cellY + 1) * 13;
      pixels[pixel + 3] = 255;
    }
  }

  await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(inputPath);
});

afterAll(async () => {
  await rm(inputDirectory, { recursive: true, force: true });
  for (const name of [
    manualOutputName,
    automaticOutputName,
    largeCellOutputName,
  ]) {
    await rm(join(projectRoot, "output", name), {
      recursive: true,
      force: true,
    });
  }
});

describe("--cell", () => {
  test("uses the requested size, estimates offsets, and handles partial edges", async () => {
    const result = runCli([
      inputArgument,
      "--cell",
      "8",
      "--out",
      manualOutputName,
      "--overwrite",
      "--preview",
      "100",
    ]);
    expect(result.status).toBe(0);

    const outputDirectory = join(projectRoot, "output", manualOutputName);
    const report = JSON.parse(
      await readFile(join(outputDirectory, "report.json"), "utf8"),
    );
    expect(report.cellSizeMode).toBe("manual");
    expect(report.manualCellSize).toBe(8);
    expect(report.grids).toHaveLength(1);
    expect(report.grids[0]).toMatchObject({ size: 8, offsetX: 3, offsetY: 5 });
    expect(report.variants).toHaveLength(3);
    expect(
      report.variants.every((variant: { path: string }) =>
        variant.path.includes("8px"),
      ),
    ).toBe(true);

    const xs = cellStarts(37, 8, report.grids[0].offsetX);
    const ys = cellStarts(29, 8, report.grids[0].offsetY);
    expect(xs.slice(1).map((value, index) => value - xs[index])).toContain(2);
    expect(ys.slice(1).map((value, index) => value - ys[index])).toContain(5);

    for (const variant of report.variants) {
      const { data, info } = await sharp(variant.path)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(37);
      expect(info.height).toBe(29);

      for (let row = 0; row < ys.length - 1; row++) {
        for (let column = 0; column < xs.length - 1; column++) {
          const first = (ys[row] * info.width + xs[column]) * info.channels;
          for (let y = ys[row]; y < ys[row + 1]; y++) {
            for (let x = xs[column]; x < xs[column + 1]; x++) {
              const pixel = (y * info.width + x) * info.channels;
              for (let channel = 0; channel < info.channels; channel++) {
                expect(data[pixel + channel]).toBe(data[first + channel]);
              }
            }
          }
        }
      }
    }

    const preview = await sharp(
      join(outputDirectory, "comparativo.png"),
    ).metadata();
    expect(preview.width).toBeGreaterThan(0);
    expect(preview.height).toBeGreaterThan(0);
  });

  test("keeps automatic detection and accepts a cell larger than the image", async () => {
    const automatic = runCli([
      inputArgument,
      "--out",
      automaticOutputName,
      "--overwrite",
      "--preview",
      "100",
    ]);
    expect(automatic.status).toBe(0);
    const automaticReport = JSON.parse(
      await readFile(
        join(projectRoot, "output", automaticOutputName, "report.json"),
        "utf8",
      ),
    );
    expect(automaticReport.cellSizeMode).toBe("automatic");
    expect(automaticReport.variants).toHaveLength(
      automaticReport.grids.length * 3,
    );

    const largeCell = runCli([
      inputArgument,
      "--cell",
      "40",
      "--out",
      largeCellOutputName,
      "--overwrite",
      "--preview",
      "100",
    ]);
    expect(largeCell.status).toBe(0);
    const largeCellReport = JSON.parse(
      await readFile(
        join(projectRoot, "output", largeCellOutputName, "report.json"),
        "utf8",
      ),
    );
    expect(largeCellReport.manualCellSize).toBe(40);
    expect(largeCellReport.grids).toHaveLength(1);
    expect(largeCellReport.variants).toHaveLength(3);
  });

  test("rejects invalid and missing values and appears in help", () => {
    for (const value of ["0", "-2", "8.5", "abc"]) {
      const result = runCli([inputArgument, "--cell", value]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Valor inválido em --cell");
    }

    const missing = runCli([inputArgument, "--cell"]);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("Falta valor para --cell");

    const help = runCli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("--cell <n>");
  });
});
