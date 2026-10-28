// Smoke-сценарий против уже запущенного API (см. README back/).
// node scripts/smoke.mjs http://127.0.0.1:3100
const base = (process.argv[2] ?? 'http://127.0.0.1:3100') + '/api';
const TITLE = 'Профиль ЦЦ — тест';

const call = async (path, init = {}) => {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

const weights = Array(24).fill(50);

const created = await call('/profiles', {
  method: 'POST',
  body: JSON.stringify({ title: TITLE, answers: { 1: 5, 214: 1 }, weights }),
});
console.log('POST', created.status, '| title ok:', created.body.title === TITLE);

const id = created.body.id;
const read = await call(`/profiles/${id}`);
console.log('GET ', read.status, '| title ok:', read.body.title === TITLE,
  '| sum:', read.body.weights.reduce((a, b) => a + b, 0),
  '| answers:', JSON.stringify(read.body.answers), '| source:', read.body.source);

const shifted = weights.slice();
shifted[0] = 100;
shifted[1] = 41 + 1;
for (let i = 2; i < 24; i++) shifted[i] = 40;
shifted[1] += 1200 - shifted.reduce((a, b) => a + b, 0);
const patched = await call(`/profiles/${id}`, {
  method: 'PATCH',
  body: JSON.stringify({ weights: shifted, source: 'calibrated' }),
});
console.log('PATCH', patched.status, '| sum:', patched.body.weights.reduce((a, b) => a + b, 0),
  '| source:', patched.body.source, '| answers сохранены:', JSON.stringify(patched.body.answers));

const invalid = await call('/profiles', {
  method: 'POST',
  body: JSON.stringify({ weights: weights.map((w, i) => (i === 0 ? 49 : w)) }),
});
console.log('POST невалидный', invalid.status, '|', JSON.stringify(invalid.body.issues));

const missing = await call('/profiles/2b0f4a58-0e3c-4f5e-9f5a-1d8a3c9e7b21');
console.log('GET несуществующий', missing.status, '|', missing.body.error);

const deleted = await call(`/profiles/${id}`, { method: 'DELETE' });
console.log('DELETE', deleted.status);

const after = await call(`/profiles/${id}`);
console.log('GET после удаления', after.status);

const health = await call('/health');
console.log('HEALTH', health.status, JSON.stringify(health.body));