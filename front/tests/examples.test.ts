/**
 * Diagnostic test on real user examples (`examples/expNN.md`).
 *
 * Each example holds the raw answers to the 214-question survey plus the gifts
 * the person actually has. The test runs the *real* engine, prints a report of
 * where the expected gifts land, and pins the documented baseline so a metric
 * or matrix change cannot silently drift. This is an experiment, not a
 * validated method: the numbers describe fit to one example, not accuracy.
 *
 * After an intentional scoring change, update the baseline table here together
 * with `docs/Задача — калибровка выдачи по реальным пользователям.md`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_DATASET } from '../src/app/core/dataset';
import { assess } from '../src/app/core/engine';
import type { AnswerValue } from '../src/app/core/models';

const EXAMPLES_DIR = fileURLToPath(new URL('../../examples/', import.meta.url));
const MAP_PATH = path.join(EXAMPLES_DIR, 'gifts-map.json');

/** Measured baseline for exp01 with expression scoring (see the task doc). */
const BASELINE: Record<string, Record<number, { rank: number; score: number }>> =
  {
    exp01: {
      3: { rank: 4, score: 72.4 }, // Пастырь
      9: { rank: 6, score: 72.0 }, // Евангелист
      5: { rank: 2, score: 73.4 }, // Учитель
    },
  };

interface Example {
  readonly name: string;
  readonly answers: Readonly<Record<number, AnswerValue>>;
  readonly gifts: readonly string[];
}

interface ResolvedGift {
  readonly name: string;
  readonly id: number | null;
  readonly note?: string;
}

interface ReportRow {
  readonly пример: string;
  readonly дар: string;
  readonly id: number | string;
  readonly место: number | string;
  readonly процент: number | string;
  readonly статус: string;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Case/ё/punctuation-insensitive key for matching gift names. */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,;:!?()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadAliases(): Map<string, number | null> {
  const raw = JSON.parse(readFileSync(MAP_PATH, 'utf8')) as Record<
    string,
    unknown
  >;
  const aliases = new Map<string, number | null>();

  for (const [name, value] of Object.entries(raw)) {
    if (value !== null && typeof value !== 'number') {
      throw new Error(`${MAP_PATH}: "${name}" должен быть числом или null`);
    }
    aliases.set(normalizeName(name), value);
  }
  return aliases;
}

/** Canonical gift names and the part before "/" resolve without an alias. */
function canonicalIds(): Map<string, number> {
  const ids = new Map<string, number>();
  for (const gift of DEFAULT_DATASET.gifts) {
    ids.set(normalizeName(gift.name), gift.id);
    const short = normalizeName(gift.name.split('/')[0]);
    if (!ids.has(short)) ids.set(short, gift.id);
  }
  return ids;
}

function resolveGift(
  name: string,
  aliases: ReadonlyMap<string, number | null>,
  canonical: ReadonlyMap<string, number>,
  knownGiftIds: ReadonlySet<number>,
): ResolvedGift {
  const key = normalizeName(name);

  if (aliases.has(key)) {
    const id = aliases.get(key) ?? null;
    if (id === null) {
      return {
        name,
        id: null,
        note: 'не сопоставлен: нужно решение владельца (examples/gifts-map.json)',
      };
    }
    if (!knownGiftIds.has(id)) {
      throw new Error(`gifts-map.json: у "${name}" id ${id}, такого дара нет`);
    }
    return { name, id };
  }

  const canonicalId = canonical.get(key);
  if (canonicalId !== undefined) return { name, id: canonicalId };

  return {
    name,
    id: null,
    note: 'нет ни в gifts-map.json, ни среди 22 даров',
  };
}

function parseExample(file: string): Example {
  const raw = readFileSync(path.join(EXAMPLES_DIR, file), 'utf8');

  const json = raw.match(/\{[\s\S]*\}/);
  if (!json) throw new Error(`${file}: не найден JSON с ответами`);

  const parsed = JSON.parse(json[0]) as Record<string, unknown>;
  const answers: Record<number, AnswerValue> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const questionId = Number(key);
    if (!Number.isInteger(questionId)) {
      throw new Error(`${file}: ключ "${key}" не является номером вопроса`);
    }
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > 5
    ) {
      throw new Error(
        `${file}: ответ на вопрос ${questionId} = ${String(value)}, ожидалось 1…5`,
      );
    }
    answers[questionId] = value as AnswerValue;
  }

  const tail = raw.slice((json.index ?? 0) + json[0].length);
  const giftLine = tail.match(/дары\s*[:\-—]?\s*([^\r\n]+)/i);
  if (!giftLine) throw new Error(`${file}: не найдена строка «дары …»`);

  const gifts = giftLine[1]
    .split(/[,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);

  return { name: file.replace(/\.md$/i, ''), answers, gifts };
}

const files = readdirSync(EXAMPLES_DIR)
  .filter((file) => /^exp\d+\.md$/i.test(file))
  .sort();

const aliases = loadAliases();
const canonical = canonicalIds();
const knownGiftIds = new Set(DEFAULT_DATASET.gifts.map((gift) => gift.id));
const examples = files.map(parseExample);

describe('real-user examples', () => {
  it('finds at least one example and a valid gift map', () => {
    expect(examples.length).toBeGreaterThan(0);
    for (const id of aliases.values()) {
      if (id !== null) expect(knownGiftIds.has(id)).toBe(true);
    }
  });

  for (const example of examples) {
    it(`${example.name}: complete survey and readable gift list`, () => {
      expect(example.gifts.length).toBeGreaterThan(0);

      for (const question of DEFAULT_DATASET.questions) {
        expect(
          example.answers[question.id],
          `${example.name}: нет ответа на вопрос ${question.id}`,
        ).toBeDefined();
      }

      // The example format is the full survey, even if the product later
      // excludes candidate questions from the active dataset.
      expect(Object.keys(example.answers)).toHaveLength(214);
    });

    it(`${example.name}: engine report`, () => {
      const result = assess(example.answers, DEFAULT_DATASET);
      expect(result.source).toBe('survey');
      expect(result.scores).toHaveLength(DEFAULT_DATASET.gifts.length);
      expect(result.weights.reduce((a, b) => a + b, 0)).toBe(1200);
      for (const score of result.scores) {
        expect(score.display).toBeGreaterThanOrEqual(0);
        expect(score.display).toBeLessThanOrEqual(100);
      }

      const resolved = example.gifts.map((name) =>
        resolveGift(name, aliases, canonical, knownGiftIds),
      );

      const rows: ReportRow[] = resolved.map((gift) => {
        if (gift.id === null) {
          return {
            пример: example.name,
            дар: gift.name,
            id: '—',
            место: '—',
            процент: '—',
            статус: gift.note ?? 'не сопоставлен',
          };
        }

        const found = result.interpretations.find(
          (item) => item.score.giftId === gift.id,
        );
        if (!found) throw new Error(`дар ${gift.id} отсутствует в выдаче`);

        return {
          пример: example.name,
          дар: gift.name,
          id: gift.id,
          место: found.rank,
          процент: round1(found.score.display),
          статус: found.top ? 'топ-3' : '',
        };
      });

      const top: ReportRow[] = result.interpretations.slice(0, 3).map((item) => ({
        пример: example.name,
        дар: item.score.giftName,
        id: item.score.giftId,
        место: item.rank,
        процент: round1(item.score.display),
        статус: 'топ-3',
      }));

      console.table(rows);
      console.table(top);

      const baseline = BASELINE[example.name];
      if (baseline) {
        for (const [id, expected] of Object.entries(baseline)) {
          const found = result.interpretations.find(
            (item) => item.score.giftId === Number(id),
          );
          if (!found) throw new Error(`дар ${id} отсутствует в выдаче`);
          expect(found.rank, `rank of gift ${id}`).toBe(expected.rank);
          expect(round1(found.score.display), `score of gift ${id}`).toBeCloseTo(
            expected.score,
            1,
          );
        }
      }
    });
  }
});
