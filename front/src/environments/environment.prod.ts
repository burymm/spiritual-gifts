/**
 * Продакшен-сборка: API живёт на том же origin под префиксом /api —
 * на Vercel запросы уходят на проект бэка через rewrite в vercel.json,
 * поэтому CORS и адрес в сборке не нужны.
 */
export const environment = {
  production: true,
  apiBaseUrl: '/api',
};
