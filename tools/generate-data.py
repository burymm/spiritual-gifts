# -*- coding: utf-8 -*-
"""Generate TypeScript data modules from the authoritative Markdown docs."""
import json, os, re, sys

DOCS = r"e:\work\spritual-gifts\docs"
OUT = r"e:\work\spritual-gifts\front\src\app\core\data"
os.makedirs(OUT, exist_ok=True)

def ts(v):
    """JSON string literal is valid TS (double quoted, escaped)."""
    return json.dumps(v, ensure_ascii=False)

def norm(s):
    return re.sub(r"\s+", " ", s.replace("\u00a0", " ")).strip()

# ---------------------------------------------------------------- questions
survey = open(os.path.join(DOCS, "Сводная анкета.md"), encoding="utf-8").read()
questions = []

# original 1..200 :  **№1.** (tags): text  \n Ответ: ____
for m in re.finditer(r"\*\*№(\d{1,3})\.\*\*\s*(.*?)\n\s*Ответ:", survey, re.S):
    qid = int(m.group(1))
    body = norm(m.group(2))
    tm = re.match(r"^\((.*?)\)\s*:?\s*(.*)$", body)
    tags = []
    text = body
    if tm:
        tags = [t.strip() for t in tm.group(1).split(",") if t.strip()]
        text = norm(tm.group(2))
    questions.append({"id": qid, "text": text, "tags": tags, "isCandidate": False})

# candidates 201..214 : **№201 · кандидат.** text
for m in re.finditer(r"\*\*№(\d{1,3})\s*·\s*кандидат\.\*\*\s*(.*?)\n\s*Ответ:", survey, re.S):
    qid = int(m.group(1))
    questions.append({"id": qid, "text": norm(m.group(2)), "tags": [], "isCandidate": True})

questions.sort(key=lambda q: q["id"])
ids = [q["id"] for q in questions]
assert len(ids) == 214, f"expected 214 questions, got {len(ids)}"
assert ids == list(range(1, 215)), "question ids must be 1..214 contiguous"
for q in questions:
    assert q["text"], f"empty text for #{q['id']}"

# ---------------------------------------------------------------- qualities
# Survey key table: | id | name | orig ids | cand ids | total |
key_block = survey.split("## Рабочий ключ распределения по качествам")[1]
qualities = []
qrow = re.compile(r"^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*(\d+)\s*\|\s*$", re.M)
for m in qrow.finditer(key_block):
    qid = int(m.group(1))
    name = norm(m.group(2))
    orig = [int(x) for x in re.findall(r"\d+", m.group(3))]
    cand = [int(x) for x in re.findall(r"\d+", m.group(4))]
    total = int(m.group(5))
    qids = orig + cand
    assert len(qids) == total, f"quality {qid}: declared {total} != {len(qids)}"
    qualities.append({"id": qid, "name": name, "questionIds": qids})
qualities.sort(key=lambda q: q["id"])
assert len(qualities) == 24, len(qualities)

all_q = [i for q in qualities for i in q["questionIds"]]
assert len(all_q) == 214 and len(set(all_q)) == 214, "every question assigned exactly once"
assert set(all_q) == set(range(1, 215))

# ---------------------------------------------------------------- gifts
wm = open(os.path.join(DOCS, "Черновик матрицы 22 даров.md"), encoding="utf-8").read()
gifts = []
grow = re.compile(r"^\|\s*(\d{1,2})\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$", re.M)
qname_by_id = {q["id"]: q["name"] for q in qualities}
for m in grow.finditer(wm):
    no = int(m.group(1))
    name = norm(m.group(2))
    profile = m.group(3)
    basis = norm(m.group(4))
    weights = {}
    for part in [p.strip() for p in profile.split(";") if p.strip()]:
        pm = re.match(r"№(\d{1,2})\s+(.+?)\s+—\s+([\d,\.]+)$", part)
        assert pm, f"gift {name}: cannot parse '{part}'"
        qid = int(pm.group(1))
        label = norm(pm.group(2))
        w = float(pm.group(3).replace(",", "."))
        assert qid in qname_by_id, f"gift {name}: unknown quality {qid}"
        assert label.split()[0] in qname_by_id[qid], \
            f"gift {name}: q{qid} label '{label}' != '{qname_by_id[qid]}'"
        weights[qid] = w
    total = round(sum(weights.values()), 10)
    assert abs(total - 1.0) < 1e-9, f"gift {name}: sum {total}"
    gifts.append({"id": no, "name": name, "weights": weights, "basis": basis})
gifts.sort(key=lambda g: g["id"])
assert len(gifts) == 22, len(gifts)

# ---------------------------------------------------------------- clusters
clusters = [
    {"id": 1, "name": "Лидерство и Стратегия", "subtitle": "Сила влияния", "qualityIds": [1, 2, 3, 4, 5]},
    {"id": 2, "name": "Администрирование и Логика", "subtitle": "Сила порядка", "qualityIds": [6, 7, 8, 9, 10]},
    {"id": 3, "name": "Аналитика и Передача Истины", "subtitle": "Сила слова", "qualityIds": [11, 12, 13, 14, 15, 16]},
    {"id": 4, "name": "Эмпатия и Служение", "subtitle": "Сила сострадания", "qualityIds": [17, 18, 19, 20, 21, 22, 23, 24]},
]
cl_all = [i for c in clusters for i in c["qualityIds"]]
assert sorted(cl_all) == list(range(1, 25)), "clusters must cover all 24 qualities"

# ---------------------------------------------------------------- emit TS
def write(name, header, body):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(header + body)
    print("wrote", path, len(body), "bytes")

write("questions.data.ts",
"""// AUTO-GENERATED from docs/Сводная анкета.md — do not edit by hand.
// Regenerate with tools/generate-data.py when the Markdown sources change.
import type { Question } from '../models';

export const QUESTIONS: readonly Question[] = [
""",
"\n".join(
    "  { id: %d, text: %s, tags: [%s], isCandidate: %s },"
    % (q["id"], ts(q["text"]), ", ".join(ts(t) for t in q["tags"]), "true" if q["isCandidate"] else "false")
    for q in questions
) + "\n];\n")

write("qualities.data.ts",
"""// AUTO-GENERATED from docs/Сводная анкета.md (ключ распределения) — do not edit by hand.
import type { Quality } from '../models';

export const QUALITIES: readonly Quality[] = [
""",
"\n".join(
    "  { id: %d, name: %s, questionIds: [%s] },"
    % (q["id"], ts(q["name"]), ", ".join(str(x) for x in q["questionIds"]))
    for q in qualities
) + "\n];\n")

write("gifts.data.ts",
"""// AUTO-GENERATED from docs/Черновик матрицы 22 даров.md — do not edit by hand.
// Weights are a working hypothesis, not a validated method.
import type { GiftProfile } from '../models';

export const GIFTS: readonly GiftProfile[] = [
""",
"\n".join(
    "  { id: %d, name: %s, weights: { %s }, basis: %s },"
    % (g["id"], ts(g["name"]),
       ", ".join("%d: %s" % (k, (("%.2f" % v).rstrip("0").rstrip(".") or "0")) for k, v in sorted(g["weights"].items())),
       ts(g["basis"]))
    for g in gifts
) + "\n];\n")

write("clusters.data.ts",
"""// Cluster grouping from docs/Кластеризация и расчеты.docx (4 clusters, 5+5+6+8 = 24).
import type { QualityCluster } from '../models';

export const CLUSTERS: readonly QualityCluster[] = [
""",
"\n".join(
    "  { id: %d, name: %s, subtitle: %s, qualityIds: [%s] },"
    % (c["id"], ts(c["name"]), ts(c["subtitle"]), ", ".join(str(x) for x in c["qualityIds"]))
    for c in clusters
) + "\n];\n")

# machine-readable snapshot for cross-checking
snap = {"questions": questions, "qualities": qualities, "gifts": gifts, "clusters": clusters}
with open(os.path.join(OUT, "_snapshot.json"), "w", encoding="utf-8") as f:
    json.dump(snap, f, ensure_ascii=False, indent=1)

print("\nSUMMARY")
print(f"  questions: {len(questions)} (candidates: {sum(1 for q in questions if q['isCandidate'])})")
print(f"  qualities: {len(qualities)}")
print(f"  gifts: {len(gifts)}")
print(f"  clusters: {len(clusters)} -> {[len(c['qualityIds']) for c in clusters]}")
print(f"  questions per quality: min={min(len(q['questionIds']) for q in qualities)} max={max(len(q['questionIds']) for q in qualities)}")
