import { CLUSTERS } from './data/clusters.data';

/** Hue per cluster, in cluster order (1-based ids). */
const CLUSTER_HUES: readonly number[] = [232, 172, 33, 340];

const QUALITY_TO_CLUSTER = new Map<number, number>();
for (const cluster of CLUSTERS) {
  for (const qualityId of cluster.qualityIds) {
    QUALITY_TO_CLUSTER.set(qualityId, cluster.id);
  }
}

export function clusterIdOfQuality(qualityId: number): number {
  return QUALITY_TO_CLUSTER.get(qualityId) ?? 1;
}

/**
 * Stable colour for a quality: hue comes from its cluster, lightness varies
 * inside the cluster so neighbouring cells stay distinguishable.
 */
export function qualityColor(qualityId: number): string {
  const clusterId = clusterIdOfQuality(qualityId);
  const hue = CLUSTER_HUES[clusterId - 1] ?? 210;
  const cluster = CLUSTERS.find((c) => c.id === clusterId);
  const members = cluster?.qualityIds ?? [qualityId];
  const index = Math.max(0, members.indexOf(qualityId));
  const lightness = 68 - (index / Math.max(1, members.length)) * 30;
  return `hsl(${hue} 58% ${lightness.toFixed(1)}%)`;
}

/** Darker variant for text drawn on top of `qualityColor`. */
export function qualityInk(qualityId: number): string {
  const clusterId = clusterIdOfQuality(qualityId);
  const hue = CLUSTER_HUES[clusterId - 1] ?? 210;
  return `hsl(${hue} 55% 18%)`;
}

export function clusterName(qualityId: number): string {
  const clusterId = clusterIdOfQuality(qualityId);
  return CLUSTERS.find((c) => c.id === clusterId)?.name ?? '';
}
