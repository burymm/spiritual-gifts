// Cluster grouping from docs/Кластеризация и расчеты.docx (4 clusters, 5+5+6+8 = 24).
import type { QualityCluster } from '../models';

export const CLUSTERS: readonly QualityCluster[] = [
  { id: 1, name: "Лидерство и Стратегия", subtitle: "Сила влияния", qualityIds: [1, 2, 3, 4, 5] },
  { id: 2, name: "Администрирование и Логика", subtitle: "Сила порядка", qualityIds: [6, 7, 8, 9, 10] },
  { id: 3, name: "Аналитика и Передача Истины", subtitle: "Сила слова", qualityIds: [11, 12, 13, 14, 15, 16] },
  { id: 4, name: "Эмпатия и Служение", subtitle: "Сила сострадания", qualityIds: [17, 18, 19, 20, 21, 22, 23, 24] },
];
