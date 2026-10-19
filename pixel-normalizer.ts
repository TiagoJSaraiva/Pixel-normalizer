/**
 * Pixel Normalizer — corrige pixels simulados por IA usando grade lógica automática.
 * Requisitos: Bun + Sharp  |  bun add sharp
 * Exemplo: bun run pixel-normalizer.ts "imagem.png" --out ./resultado
 *
 * Gera: variantes (dominante, mediana, centro) para as grades selecionadas,
 * preview comparativo e report.json. Tudo neste arquivo, sem serviços externos.
 */
import sharp, { type OverlayOptions } from "sharp";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

interface Options {
  input?: string;
  out: string;
  overwrite: boolean;
  cell?: number;
  minCell: number;
  maxCell: number;
  grids: number;
  previewWidth: number;
}
interface RawImage {
  pixels: Uint8Array;
  width: number;
  height: number;
  channels: 4;
}
interface AxisFit {
  offset: number;
  score: number;
  contrast: number;
}
interface GridFit {
  size: number;
  offsetX: number;
  offsetY: number;
  score: number;
  scoreX: number;
  scoreY: number;
  contrastX: number;
  contrastY: number;
}
type Strategy = "dominante" | "mediana" | "centro";

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const INPUT_ROOT = resolve(PROJECT_ROOT, "input");
const OUTPUT_ROOT = resolve(PROJECT_ROOT, "output");
// Keep in sync with the image formats ignored in input/.gitignore.
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".ico",
  ".webp",
  ".avif",
  ".heic",
  ".heif",
]);

function printHelp(): void {
  console.log(`Uso: bun run pixel-normalizer.ts [<imagem>] [opções]

<imagem> é um caminho relativo à pasta ./input. Sem esse argumento, todas as
imagens compatíveis diretamente em ./input são processadas em sequência.

Opções:
  --out <pasta>       Pasta relativa a ./output (padrão: normalized-output)
  -o, --overwrite     Recria a pasta de saída (indisponível no modo em lote)
  --min-cell <n>      Menor pixel lógico testado (padrão: 3)
  --max-cell <n>      Maior pixel lógico testado (padrão: 128)
  --cell <n>          Fixa o tamanho da célula e estima os deslocamentos
  --grids <n>         Quantidade de grades alternativas (padrão: 2)
  --preview <n>       Largura de cada miniatura (padrão: 360)

Sem --overwrite, uma saída existente recebe um sufixo numérico crescente.
Requisitos: bun add sharp
`);
}

function parseOptions(argv: string[]): Options {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  const opts: Options = {
    out: "normalized-output",
    overwrite: false,
    minCell: 3,
    maxCell: 128,
    grids: 2,
    previewWidth: 360,
  };
  const numeric = new Set([
    "--cell",
    "--min-cell",
    "--max-cell",
    "--grids",
    "--preview",
  ]);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "-o" || key === "--overwrite") {
      opts.overwrite = true;
      continue;
    }
    if (key === "--out" || numeric.has(key)) {
      const value = argv[++i];
      if (!value || value.startsWith("--") || value === "-o")
        throw new Error(`Falta valor para ${key}`);
      if (key === "--out") {
        opts.out = value;
        continue;
      }
      const n = Number(value);
      if (
        !Number.isInteger(n) ||
        n < 1 ||
        (key === "--cell" && !Number.isSafeInteger(n))
      )
        throw new Error(`Valor inválido em ${key}: ${value}`);
      if (key === "--cell") opts.cell = n;
      if (key === "--min-cell") opts.minCell = n;
      if (key === "--max-cell") opts.maxCell = n;
      if (key === "--grids") opts.grids = Math.min(5, n);
      if (key === "--preview")
        opts.previewWidth = Math.max(100, Math.min(600, n));
      continue;
    }

    if (key.startsWith("-")) throw new Error(`Opção desconhecida: ${key}`);
    if (opts.input !== undefined)
      throw new Error(`Argumento inesperado: ${key}`);
    opts.input = key;
  }
  if (opts.minCell > opts.maxCell)
    throw new Error("--min-cell deve ser <= --max-cell");
  return opts;
}

async function listInputImages(): Promise<string[]> {
  const entries = await readdir(INPUT_ROOT, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()),
    )
    .map((entry) => join(INPUT_ROOT, entry.name));
}

function resolveInside(root: string, userPath: string, label: string): string {
  if (!userPath || isAbsolute(userPath))
    throw new Error(
      `O caminho de ${label} deve ser relativo à pasta correspondente: ${userPath}`,
    );

  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, userPath);
  const pathFromRoot = relative(absoluteRoot, absolutePath);
  if (
    !pathFromRoot ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error(
      `O caminho de ${label} deve permanecer dentro da pasta correspondente: ${userPath}`,
    );
  }
  return absolutePath;
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function reserveOutputDirectory(
  basePath: string,
  overwrite: boolean,
): Promise<string> {
  const parent = dirname(basePath);
  const baseName = basename(basePath);
  await mkdir(parent, { recursive: true });

  if (overwrite) {
    await rm(basePath, { recursive: true, force: true });
    await mkdir(basePath);
    return basePath;
  }

  while (true) {
    const entries = await readdir(parent);
    let largestId = 0;
    for (const entry of entries) {
      if (entry === baseName) {
        largestId = Math.max(largestId, 1);
        continue;
      }
      const prefix = `${baseName}-`;
      if (!entry.startsWith(prefix)) continue;
      const suffix = entry.slice(prefix.length);
      if (!/^\d+$/.test(suffix)) continue;
      const id = Number(suffix);
      if (!Number.isSafeInteger(id))
        throw new Error(`Sufixo numérico fora do limite seguro em ${join(parent, entry)}`);
      if (id >= 2) largestId = Math.max(largestId, id);
    }

    const nextId = largestId === 0 ? 1 : largestId + 1;
    if (!Number.isSafeInteger(nextId))
      throw new Error(`Não foi possível calcular o próximo sufixo para ${basePath}`);
    const candidate = nextId === 1 ? basePath : `${basePath}-${nextId}`;
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
    }
  }
}

async function loadImage(path: string): Promise<RawImage> {
  const { data, info } = await sharp(path)
    .rotate()
    .ensureAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width < 16 || info.height < 16)
    throw new Error("Imagem muito pequena");
  return { pixels: data, width: info.width, height: info.height, channels: 4 };
}

function edgeCost(data: Uint8Array, a: number, b: number): number {
  // Ignora RGB de áreas totalmente transparentes. Saturação evita que poucas
  // bordas muito fortes dominem a estimativa da grade.
  const alphaA = data[a + 3];
  const alphaB = data[b + 3];
  const visibility = Math.max(alphaA, alphaB) / 255;
  const colorDelta =
    (0.3 * Math.abs(data[a] - data[b]) +
      0.59 * Math.abs(data[a + 1] - data[b + 1]) +
      0.11 * Math.abs(data[a + 2] - data[b + 2])) *
    visibility;
  const difference = colorDelta + 0.7 * Math.abs(alphaA - alphaB);
  return Math.min(80, Math.max(0, difference - 5));
}

/** Perfil: energia das bordas verticais em x e horizontais em y. */
function edgeProfiles(img: RawImage): { x: Float64Array; y: Float64Array } {
  const { width: w, height: h, pixels: data } = img;
  const x = new Float64Array(w);
  const y = new Float64Array(h);
  const strideY = Math.max(1, Math.floor(h / 450));
  const strideX = Math.max(1, Math.floor(w / 450));
  let nRows = 0,
    nCols = 0;
  for (let row = 0; row < h; row += strideY) {
    nRows++;
    for (let col = 1; col < w; col++) {
      const p = (row * w + col) * 4;
      x[col] += edgeCost(data, p, p - 4);
    }
  }
  for (let col = 0; col < w; col += strideX) {
    nCols++;
    for (let row = 1; row < h; row++) {
      const p = (row * w + col) * 4;
      y[row] += edgeCost(data, p, p - 4 * w);
    }
  }
  for (let col = 1; col < w; col++) x[col] /= nRows;
  for (let row = 1; row < h; row++) y[row] /= nCols;
  return { x, y };
}

function fitAxis(profile: Float64Array, size: number): AxisFit {
  // Offsets maiores que o eixo não podem ter bordas observadas na imagem.
  // Limitar os candidatos também permite --cell maior que as dimensões sem
  // alocar um vetor proporcional ao valor informado.
  const offsetCount = Math.min(size, profile.length);
  const sums = new Float64Array(offsetCount);
  const counts = new Uint32Array(offsetCount);
  let total = 0,
    n = 0,
    sumSq = 0;
  for (let i = 1; i < profile.length; i++) {
    const value = profile[i];
    sums[i % size] += value;
    counts[i % size]++;
    total += value;
    sumSq += value * value;
    n++;
  }
  const mean = total / n;
  const std = Math.sqrt(Math.max(1e-8, sumSq / n - mean * mean));
  let best = 0;
  let peak = -Infinity;
  for (let offset = 0; offset < offsetCount; offset++) {
    const avg = counts[offset] ? sums[offset] / counts[offset] : 0;
    if (avg > peak) {
      best = offset;
      peak = avg;
    }
  }
  const contrast = (peak - mean) / (mean + 1e-6);
  // Sinal relativo à variação natural das bordas, recompensando a repetição
  // de fronteiras no mesmo deslocamento (e penalizando coincidências isoladas).
  const z = ((peak - mean) / (std + 1e-6)) * Math.sqrt(counts[best]);
  // Ajuste suave pela busca entre muitos offsets (mais candidatos com k grande).
  const score = Math.max(0, z / Math.sqrt(Math.max(1, Math.log2(size))));
  return { offset: best, score, contrast };
}

function detectGrids(img: RawImage, options: Options): GridFit[] {
  const edges = edgeProfiles(img);
  const sizes: number[] = [];
  if (options.cell !== undefined) {
    sizes.push(options.cell);
  } else {
    const upper = Math.min(
      options.maxCell,
      Math.floor(Math.min(img.width, img.height) / 5),
    );
    if (upper < options.minCell)
      throw new Error("Nenhum tamanho de pixel possível para essa imagem");
    for (let size = options.minCell; size <= upper; size++) sizes.push(size);
  }
  const fits: GridFit[] = [];
  for (const size of sizes) {
    const x = fitAxis(edges.x, size);
    const y = fitAxis(edges.y, size);
    const repeatedBoundaries = Math.min(img.width, img.height) / size;
    // Grids muito grandes podem se alinhar por acaso a 2–3 bordas de objetos.
    // Penaliza escalas com poucas repetições, sem excluí-las (64px é válido).
    const repetitionWeight = Math.min(1, Math.sqrt(repeatedBoundaries / 25));
    const score = Math.sqrt(x.score * y.score) * repetitionWeight;
    fits.push({
      size,
      offsetX: x.offset,
      offsetY: y.offset,
      score,
      scoreX: x.score,
      scoreY: y.score,
      contrastX: x.contrast,
      contrastY: y.contrast,
    });
  }
  // No modo manual, o usuário escolheu a escala; a pontuação continua sendo
  // usada para os offsets, mas não há seleção de grades alternativas.
  if (options.cell !== undefined) return fits;

  fits.sort((a, b) => b.score - a.score);
  // Evita grades quase iguais. Também mantém alternativas com escala
  // substancialmente diferente, úteis quando a IA misturou blocos.
  const selected: GridFit[] = [];
  for (const f of fits) {
    if (
      selected.every(
        (s) =>
          Math.abs(f.size - s.size) >= Math.max(3, Math.round(s.size * 0.2)),
      )
    ) {
      selected.push(f);
      if (selected.length === options.grids) break;
    }
  }
  return selected;
}

function dominantColor(
  data: Uint8Array,
  indices: number[],
): [number, number, number, number] {
  // Clusteriza cores próximas: ruído de compressão e pequenas variações
  // de IA não tornam cada RGB uma classe diferente.
  const quant = 20;
  const clusters = new Map<
    number,
    { count: number; r: number; g: number; b: number; a: number }
  >();
  for (const p of indices) {
    const a = data[p + 3];
    const r = a < 24 ? 0 : data[p];
    const g = a < 24 ? 0 : data[p + 1];
    const b = a < 24 ? 0 : data[p + 2];
    const qa = Math.min(15, Math.floor(a / 17));
    const key =
      ((Math.floor(r / quant) * 13 + Math.floor(g / quant)) * 13 +
        Math.floor(b / quant)) *
        16 +
      qa;
    let bucket = clusters.get(key);
    if (!bucket) {
      bucket = { count: 0, r: 0, g: 0, b: 0, a: 0 };
      clusters.set(key, bucket);
    }
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.a += a;
  }
  let best: NonNullable<ReturnType<typeof clusters.get>> | undefined;
  for (const b of clusters.values()) {
    if (!best || b.count > best.count) best = b;
  }
  if (!best) return [0, 0, 0, 0];
  return [
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count),
    Math.round(best.a / best.count),
  ];
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

function representativeColor(
  img: RawImage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  strategy: Strategy,
): [number, number, number, number] {
  const { pixels: data, width: w } = img;
  if (strategy === "centro") {
    const x = Math.floor((x0 + x1 - 1) / 2);
    const y = Math.floor((y0 + y1 - 1) / 2);
    const p = (y * w + x) * 4;
    return [data[p], data[p + 1], data[p + 2], data[p + 3]];
  }
  const indices: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) indices.push((y * w + x) * 4);
  }
  if (strategy === "dominante") return dominantColor(data, indices);
  const rr: number[] = [],
    gg: number[] = [],
    bb: number[] = [],
    aa: number[] = [];
  for (const p of indices) {
    rr.push(data[p]);
    gg.push(data[p + 1]);
    bb.push(data[p + 2]);
    aa.push(data[p + 3]);
  }
  return [median(rr), median(gg), median(bb), median(aa)];
}

/** Posiciona as células de uma grade cuja fronteira é offset (mod size). */
function cellStarts(size: number, offset: number, length: number): number[] {
  const starts: number[] = [0];
  for (let i = offset === 0 ? size : offset; i < length; i += size) {
    if (i > 0) starts.push(i);
  }
  starts.push(length);
  return starts;
}

/** Não há interpolação: cada pixel lógico ocupa um retângulo inteiro. */
function normalize(img: RawImage, grid: GridFit, strategy: Strategy): Buffer {
  const { width: w, height: h } = img;
  const result = Buffer.alloc(w * h * 4);
  const xs = cellStarts(grid.size, grid.offsetX, w);
  const ys = cellStarts(grid.size, grid.offsetY, h);
  for (let j = 0; j < ys.length - 1; j++) {
    const y0 = ys[j],
      y1 = ys[j + 1];
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i],
        x1 = xs[i + 1];
      const rgba = representativeColor(img, x0, y0, x1, y1, strategy);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * w + x) * 4;
          result[p] = rgba[0];
          result[p + 1] = rgba[1];
          result[p + 2] = rgba[2];
          result[p + 3] = rgba[3];
        }
      }
    }
  }
  return result;
}

function escapeSvg(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

async function savePreview(
  files: { path: string; label: string }[],
  opts: Options,
  dest: string,
): Promise<void> {
  const itemWidth = opts.previewWidth;
  const thumbHeight = opts.previewWidth;
  const captionHeight = 45;
  const columns = Math.min(4, files.length);
  const rows = Math.ceil(files.length / columns);
  const tileHeight = thumbHeight + captionHeight;
  const composites: OverlayOptions[] = [];
  for (const [index, item] of files.entries()) {
    const left = (index % columns) * itemWidth;
    const top = Math.floor(index / columns) * tileHeight;
    const thumb = await sharp(item.path)
      .resize(itemWidth, thumbHeight, {
        fit: "contain",
        kernel: "nearest",
        background: "#20222aff",
      })
      .png()
      .toBuffer();
    composites.push({ input: thumb, left, top });
    const svg =
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${itemWidth}" height="${captionHeight}">
      <rect width="100%" height="100%" fill="#252833"/>
      <text x="12" y="28" fill="#f0f0f0" font-size="14" font-family="Arial, sans-serif">${escapeSvg(item.label)}</text>
    </svg>`);
    composites.push({ input: svg, left, top: top + thumbHeight });
  }
  await sharp({
    create: {
      width: columns * itemWidth,
      height: rows * tileHeight,
      channels: 4,
      background: "#20222a",
    },
  })
    .composite(composites)
    .png()
    .toFile(dest);
}

async function processImage(
  inputPath: string,
  opts: Options,
  outputBasePath: string,
): Promise<void> {
  const image = await loadImage(inputPath);
  const grids = detectGrids(image, opts);
  const outputPath = await reserveOutputDirectory(
    outputBasePath,
    opts.overwrite,
  );
  console.log(`\nImagem: ${basename(inputPath)} (${image.width}x${image.height})`);
  console.log(
    opts.cell === undefined
      ? "Grades estimadas:"
      : "Grade definida manualmente (offsets estimados):",
  );
  grids.forEach((grid, i) =>
    console.log(
      ` ${i + 1}. pixel ${grid.size}x${grid.size}, ` +
        `deslocamento (${grid.offsetX},${grid.offsetY}), pontuação ${grid.score.toFixed(2)}`,
    ),
  );

  const files: { path: string; label: string }[] = [];
  const previewItems: { path: string; label: string }[] = [];
  for (const [index, grid] of grids.entries()) {
    previewItems.push({ path: inputPath, label: "Original (referência)" });
    for (const strategy of ["dominante", "mediana", "centro"] as const) {
      const name = `grade-${index + 1}-${grid.size}px-${strategy}.png`;
      const path = join(outputPath, name);
      const raw = normalize(image, grid, strategy);
      await sharp(raw, {
        raw: { width: image.width, height: image.height, channels: 4 },
      })
        .png()
        .toFile(path);
      const item = {
        path,
        label:
          opts.cell === undefined
            ? `Grade ${index + 1} (${grid.size}px) — ${strategy}`
            : `Grade manual (${grid.size}px) — ${strategy}`,
      };
      files.push(item);
      previewItems.push(item);
      console.log(` + ${path}`);
    }
  }
  const report = {
    input: inputPath,
    dimensions: { width: image.width, height: image.height },
    explanation:
      (opts.cell === undefined
        ? "O tamanho da grade foi detectado automaticamente. "
        : `O tamanho da grade foi definido manualmente como ${opts.cell}px. `) +
      "Offsets indicam as posições das FRONTEIRAS (x mod size, y mod size). " +
      "Pontuações são heurísticas; compare visualmente o preview. " +
      "Quando não há uma grade global consistente, nenhum método é perfeito.",
    cellSizeMode: opts.cell === undefined ? "automatic" : "manual",
    manualCellSize: opts.cell ?? null,
    grids,
    variants: files.map((f) => ({ path: resolve(f.path), label: f.label })),
  };
  await writeFile(
    join(outputPath, "report.json"),
    JSON.stringify(report, null, 2),
    "utf-8",
  );
  await savePreview(previewItems, opts, join(outputPath, "comparativo.png"));
  console.log(
    `\nPronto. Abra ${join(outputPath, "comparativo.png")} para escolher a variante.`,
  );
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));
  if (opts.input === undefined && opts.overwrite)
    throw new Error("--overwrite não é compatível com o processamento em lote.");

  const outputBasePath = resolveInside(OUTPUT_ROOT, opts.out, "saída");
  if (opts.input !== undefined) {
    const inputPath = resolveInside(INPUT_ROOT, opts.input, "entrada");
    await processImage(inputPath, opts, outputBasePath);
    return;
  }

  const inputPaths = await listInputImages();
  if (inputPaths.length === 0)
    throw new Error(
      "Nenhuma imagem compatível foi encontrada diretamente em ./input.",
    );

  for (const inputPath of inputPaths)
    await processImage(inputPath, opts, outputBasePath);
}

main().catch((err) => {
  console.error("Erro:", err);
  process.exitCode = 1;
});
