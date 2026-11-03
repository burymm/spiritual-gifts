/**
 * Локальная разработка: `ng serve` на :4200, API отдельным процессом на :3000.
 * В проде подменяется environment.prod.ts (см. fileReplacements в angular.json).
 */
export const environment = {
  production: false,
  /** Базовый адрес API вместе с префиксом /api. */
  apiBaseUrl: 'http://127.0.0.1:3000/api',
};
