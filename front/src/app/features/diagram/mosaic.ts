/**
 * Weighted polygonal mosaic on a hex lattice.
 *
 * The pool of weights is an integer (1200 for 24 qualities), so the mosaic uses
 * exactly `pool` hex cells — one cell per weight unit. Area is therefore
 * *exactly* proportional to weight, which is what the diagram promises.
 *
 * The cells are assigned in two steps:
 *
 *  1. A recursive half-plane split. Qualities are ordered by their seed
 *     position along the longer axis of the current cell block, split into two
 *     groups with about half the weight each, and the block is cut so that each
 *     half gets exactly the number of cells its qualities need. Both halves of
 *     such a cut are connected, so this start is contiguous and exact by
 *     construction.
 *
 *  2. A boundary-cell exchange that shortens the total border between regions.
 *     Two neighbouring regions trade one cell each whenever that makes both of
 *     them rounder, as long as neither region falls apart. Counts never change,
 *     so areas stay exact and the blocky start turns into an organic mosaic.
 */

interface Point {
  readonly x: number;
  readonly y: number;
}

export interface MosaicCell {
  /** Index into the weight vector (0-based quality position). */
  readonly qualityIndex: number;
  /** SVG `polygon points` attribute. */
  readonly points: string;
  readonly cx: number;
  readonly cy: number;
}

export interface MosaicLabel {
  readonly qualityIndex: number;
  readonly x: number;
  readonly y: number;
  readonly fontSize: number;
}

export interface Mosaic {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly MosaicCell[];
  readonly labels: readonly MosaicLabel[];
  /** Weight value that one hex cell represents. */
  readonly unit: number;
}

export interface MosaicOptions {
  /** Hex circumradius in SVG units. */
  readonly size?: number;
  /** Padding around the mosaic. */
  readonly padding?: number;
  /** Smoothing passes; more means compacter regions and more CPU time. */
  readonly passes?: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function hexPoints(cx: number, cy: number, size: number): string {
  const points: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i + 30);
    points.push(
      `${(cx + size * Math.cos(angle)).toFixed(2)},${(
        cy +
        size * Math.sin(angle)
      ).toFixed(2)}`,
    );
  }
  return points.join(' ');
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function buildMosaic(
  weights: readonly number[],
  options: MosaicOptions = {},
): Mosaic {
  const size = options.size ?? 12;
  const padding = options.padding ?? 8;
  const passes = options.passes ?? 40;
  const count = weights.length;
  const targets = weights.map((w) => Math.max(0, Math.round(w)));
  const total = targets.reduce((a, b) => a + b, 0);

  if (total <= 0 || count === 0) {
    return { width: 0, height: 0, cells: [], labels: [], unit: 1 };
  }

  // ---- hex lattice: take exactly `total` cells closest to the centre --------
  const hstep = Math.sqrt(3) * size;
  const vstep = 1.5 * size;
  const range = Math.max(6, Math.ceil(Math.sqrt(total) * 0.9) + 3);

  const lattice: Point[] = [];
  for (let row = -range; row <= range; row++) {
    for (let col = -range; col <= range; col++) {
      lattice.push({
        x: col * hstep + (Math.abs(row) % 2 === 1 ? hstep / 2 : 0),
        y: row * vstep,
      });
    }
  }
  lattice.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y));
  const chosen = lattice.slice(0, total);

  // centre the disc on the origin
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of chosen) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const centres: Point[] = chosen.map((p) => ({
    x: p.x - (minX + maxX) / 2,
    y: p.y - (minY + maxY) / 2,
  }));

  // ---- adjacency on the hex lattice ---------------------------------------
  const neighbours: number[][] = centres.map(() => []);
  for (let a = 0; a < total; a++) {
    for (let b = a + 1; b < total; b++) {
      if (Math.abs(distanceSquared(centres[a], centres[b]) - hstep * hstep) < 1) {
        neighbours[a].push(b);
        neighbours[b].push(a);
      }
    }
  }

  // ---- seeds: sunflower spiral snapped to free cells -----------------------
  // The seeds only decide the order in which qualities are laid out; the cut
  // sizes come from the weights.
  let maxRadius = 0;
  for (const p of centres) {
    maxRadius = Math.max(maxRadius, Math.hypot(p.x, p.y));
  }

  const activeRegions = targets
    .map((target, region) => ({ target, region }))
    .filter((entry) => entry.target > 0)
    .map((entry) => entry.region);

  const seedOfRegion = new Map<number, number>();
  const usedSeeds = new Set<number>();

  for (let i = 0; i < activeRegions.length; i++) {
    const region = activeRegions[i];
    const angle = i * GOLDEN_ANGLE;
    const radius = maxRadius * Math.sqrt((i + 0.5) / activeRegions.length) * 0.92;
    const target: Point = {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    };

    let best = -1;
    let bestDistance = Infinity;
    for (let c = 0; c < total; c++) {
      if (usedSeeds.has(c)) continue;
      const d = distanceSquared(centres[c], target);
      if (d < bestDistance) {
        bestDistance = d;
        best = c;
      }
    }
    if (best < 0) break;
    usedSeeds.add(best);
    seedOfRegion.set(region, best);
  }

  // ---- step 1: recursive half-plane split ---------------------------------
  const owner = new Int32Array(total).fill(-1);

  const assign = (regionIds: readonly number[], cells: readonly number[]): void => {
    if (cells.length === 0) return;
    if (regionIds.length === 1) {
      for (const cell of cells) owner[cell] = regionIds[0];
      return;
    }

    let lowX = Infinity;
    let highX = -Infinity;
    let lowY = Infinity;
    let highY = -Infinity;
    for (const cell of cells) {
      const { x, y } = centres[cell];
      lowX = Math.min(lowX, x);
      highX = Math.max(highX, x);
      lowY = Math.min(lowY, y);
      highY = Math.max(highY, y);
    }
    const byX = highX - lowX >= highY - lowY;

    const along = (cell: number): number =>
      byX ? centres[cell].x : centres[cell].y;
    const across = (cell: number): number =>
      byX ? centres[cell].y : centres[cell].x;

    const ordered = [...regionIds].sort((a, b) => {
      const seedA = seedOfRegion.get(a) ?? 0;
      const seedB = seedOfRegion.get(b) ?? 0;
      return (
        along(seedA) - along(seedB) ||
        across(seedA) - across(seedB) ||
        a - b
      );
    });

    const totalWeight = regionIds.reduce((sum, r) => sum + targets[r], 0);
    let accumulated = 0;
    let splitAt = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < ordered.length - 1; i++) {
      accumulated += targets[ordered[i]];
      const diff = Math.abs(accumulated - totalWeight / 2);
      if (diff < bestDiff) {
        bestDiff = diff;
        splitAt = i + 1;
      }
    }

    const groupA = ordered.slice(0, splitAt);
    const groupB = ordered.slice(splitAt);
    const sizeA = groupA.reduce((sum, r) => sum + targets[r], 0);

    const sortedCells = [...cells].sort(
      (a, b) => along(a) - along(b) || across(a) - across(b) || a - b,
    );

    assign(groupA, sortedCells.slice(0, sizeA));
    assign(groupB, sortedCells.slice(sizeA));
  };

  assign(
    activeRegions,
    Array.from({ length: total }, (_, cell) => cell),
  );

  // ---- step 2: shorten the border between regions --------------------------
  // A cell on the border moves to a neighbouring region only if that creates
  // more same-region contacts, and only if neither region breaks in two.
  // Counts never change, so the areas stay exact.
  const counts = targets.slice();
  const seen = new Int32Array(total);
  let stamp = 0;

  const members: number[][] = targets.map(() => []);
  for (let cell = 0; cell < total; cell++) {
    const region = owner[cell];
    if (region >= 0) members[region].push(cell);
  }

  /** Connected components of a region, as lists of cells. */
  const regionComponents = (region: number): number[][] => {
    stamp += 1;
    const result: number[][] = [];
    for (const startCell of members[region]) {
      if (seen[startCell] === stamp) continue;
      const component: number[] = [];
      const stack = [startCell];
      seen[startCell] = stamp;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        component.push(cell);
        for (const nb of neighbours[cell]) {
          if (owner[nb] !== region || seen[nb] === stamp) continue;
          seen[nb] = stamp;
          stack.push(nb);
        }
      }
      result.push(component);
    }
    return result;
  };

  /** Components of `region` after moving `removeCell` out and `addCell` in. */
  const componentsAfter = (
    region: number,
    removeCell: number,
    addCell: number,
  ): number => {
    stamp += 1;
    const flood = (startCell: number): void => {
      const stack = [startCell];
      seen[startCell] = stamp;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        for (const nb of neighbours[cell]) {
          if (nb === removeCell) continue;
          if (seen[nb] === stamp) continue;
          if (nb !== addCell && owner[nb] !== region) continue;
          seen[nb] = stamp;
          stack.push(nb);
        }
      }
    };

    flood(addCell);
    let components = 1;

    for (const cell of members[region]) {
      if (cell === removeCell || seen[cell] === stamp) continue;
      components += 1;
      flood(cell);
    }

    return components;
  };

  const componentCount = new Int32Array(count);

  const scanComponents = (): void => {
    for (let region = 0; region < count; region++) {
      componentCount[region] = regionComponents(region).length;
    }
  };

  const sameCount = (cell: number, region: number): number => {
    let same = 0;
    for (const nb of neighbours[cell]) {
      if (owner[nb] === region) same += 1;
    }
    return same;
  };

  const maxSwaps = total * 8;
  let swapsDone = 0;

  const order = Array.from({ length: total }, (_, cell) => cell);

  for (let pass = 0; pass < passes && swapsDone < maxSwaps; pass++) {
    scanComponents();

    // Shuffle deterministically so different passes start at different cells.
    for (let i = order.length - 1; i > 0; i--) {
      const j = (i * 1103515245 + pass * 7919) % (i + 1);
      const tmp = order[i];
      order[i] = order[j];
      order[j] = tmp;
    }

    let swaps = 0;

    for (const a of order) {
      const regionA = owner[a];
      if (regionA < 0 || counts[regionA] < 2) continue;

      const border = neighbours[a].some((nb) => owner[nb] !== regionA);
      if (!border) continue;

      const candidateRegions = new Set<number>();
      for (const nb of neighbours[a]) {
        const region = owner[nb];
        if (region !== regionA && region >= 0) candidateRegions.add(region);
      }

      let bestGain = 0;
      let bestRegion = -1;
      let bestCell = -1;

      for (const regionB of candidateRegions) {
        if (counts[regionB] < 2) continue;

        for (const d of members[regionB]) {
          // The incoming cell must touch the frontier of region A.
          if (!neighbours[d].some((nb) => owner[nb] === regionA)) continue;

          const before = sameCount(a, regionA) + sameCount(d, regionB);

          owner[a] = regionB;
          owner[d] = regionA;
          const after = sameCount(a, regionB) + sameCount(d, regionA);
          owner[a] = regionA;
          owner[d] = regionB;

          const gain = after - before;
          if (gain <= bestGain) continue;
          if (componentsAfter(regionA, a, d) > componentCount[regionA]) continue;
          if (componentsAfter(regionB, d, a) > componentCount[regionB]) continue;

          bestGain = gain;
          bestRegion = regionB;
          bestCell = d;
        }
      }

      if (bestRegion < 0) continue;

      owner[a] = bestRegion;
      owner[bestCell] = regionA;

      members[regionA].splice(members[regionA].indexOf(a), 1);
      members[bestRegion].splice(members[bestRegion].indexOf(bestCell), 1);
      members[bestRegion].push(a);
      members[regionA].push(bestCell);

      componentCount[regionA] = regionComponents(regionA).length;
      componentCount[bestRegion] = regionComponents(bestRegion).length;

      swaps += 1;
      swapsDone += 1;
    }

    if (swaps === 0) break;
  }

  // A cut along the rim can leave a single cell of a region behind. Exchange
  // such strays for a cell of a neighbouring region that touches the main body
  // of the region they belong to. Each exchange removes one stray.
  for (let guard = 0; guard < total; guard++) {
    scanComponents();

    let region = -1;
    for (let r = 0; r < count; r++) {
      if (componentCount[r] > 1) {
        region = r;
        break;
      }
    }
    if (region < 0) break;

    const components = regionComponents(region);
    let island = components[0];
    let main = components[0];
    for (const component of components) {
      if (component.length < island.length) island = component;
      if (component.length > main.length) main = component;
    }
    const mainCells = new Set(main);

    let merged = false;

    for (const a of island) {
      const touchCount = new Map<number, number>();
      for (const nb of neighbours[a]) {
        const other = owner[nb];
        if (other === region || other < 0) continue;
        touchCount.set(other, (touchCount.get(other) ?? 0) + 1);
      }

      const partners = [...touchCount.entries()]
        .sort((x, y) => y[1] - x[1] || x[0] - y[0])
        .map((entry) => entry[0]);

      for (const other of partners) {
        let donor = -1;
        let closest = Infinity;
        for (const cell of members[other]) {
          if (owner[cell] !== other) continue;
          if (!neighbours[cell].some((nb) => mainCells.has(nb))) continue;
          const distance = distanceSquared(centres[cell], centres[a]);
          if (distance < closest) {
            closest = distance;
            donor = cell;
          }
        }
        if (donor < 0) continue;
        if (componentsAfter(region, a, donor) > componentCount[region]) {
          continue;
        }
        if (componentsAfter(other, donor, a) > componentCount[other]) {
          continue;
        }

        owner[a] = other;
        owner[donor] = region;
        members[region].splice(members[region].indexOf(a), 1);
        members[other].splice(members[other].indexOf(donor), 1);
        members[other].push(a);
        members[region].push(donor);

        merged = true;
        break;
      }

      if (merged) break;
    }

    if (!merged) break;
  }

  // ---- geometry ------------------------------------------------------------
  const cells: MosaicCell[] = centres.map((p, index) => ({
    qualityIndex: owner[index] < 0 ? 0 : owner[index],
    points: hexPoints(p.x, p.y, size),
    cx: p.x,
    cy: p.y,
  }));

  const groups: number[][] = targets.map(() => []);
  for (let cell = 0; cell < total; cell++) {
    const region = owner[cell] < 0 ? 0 : owner[cell];
    groups[region].push(cell);
  }

  // Put the number on the cell closest to the region's centroid, so it always
  // lands on the region itself even when the shape is irregular.
  const labels: MosaicLabel[] = groups
    .map((memberCells, qualityIndex) => {
      let sx = 0;
      let sy = 0;
      for (const cell of memberCells) {
        sx += centres[cell].x;
        sy += centres[cell].y;
      }
      const n = Math.max(1, memberCells.length);
      const cx = sx / n;
      const cy = sy / n;

      let anchor = memberCells[0] ?? 0;
      let bestDistance = Infinity;
      for (const cell of memberCells) {
        const d = distanceSquared(centres[cell], { x: cx, y: cy });
        if (d < bestDistance) {
          bestDistance = d;
          anchor = cell;
        }
      }

      return {
        qualityIndex,
        x: centres[anchor].x,
        y: centres[anchor].y,
        fontSize: Math.max(
          9,
          Math.min(17, 7 + Math.sqrt(Math.max(1, n)) * 1.35),
        ),
      };
    })
    .filter((label) => targets[label.qualityIndex] > 0);

  return {
    width: maxX - minX + size * 2 + padding * 2,
    height: maxY - minY + size * 2 + padding * 2,
    cells,
    labels,
    unit: 1,
  };
}
