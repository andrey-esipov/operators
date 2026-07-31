import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * TEST-FILE ROSTER CENSUS — a load-invariant guard against the one regression the
 * suite is structurally incapable of noticing: the deletion of a whole test file.
 *
 * WHY THIS EXISTS. Break a test and it reds. Weaken an assertion and a mutation
 * catches it. But DELETE the file and the suite goes green with one fewer test and
 * reports success — absence looks exactly like a pass. It happened this session:
 * f59239d was committed from a stale tree and silently dropped 429 lines of a
 * sibling's landed work (whiffPunishCensus.node.test.ts); nothing reddened. The
 * ONLY signal was the headline count — "814/95 should have been 815/96" — and that
 * count is a fragile detector: it is measured in a shared worktree that agents
 * inflate with untracked WIP (it read 812/96 and 490/63 on contaminated trees this
 * same session). A number that only means something relative to a remembered
 * previous number, taken from a tree anyone can dirty, is not a gate.
 *
 * WHAT THIS DOES. It gives the roster a committed MEMORY. `testFileManifest.txt`
 * lists every tracked, census-eligible test file under src/. This gate reddens BY
 * NAME the instant that set and the manifest disagree — a file deleted or renamed
 * out of tracking, or a file added without updating the roster in the same diff.
 * A silent drop becomes a named failure that says which file and which direction.
 *
 * WHAT THIS DOES *NOT* DO — and this boundary is the point, not a compromise:
 *   - It does NOT catch the deletion of an `it()`/`describe()` INSIDE a surviving
 *     file. That is a visible hunk in a file someone already has open; ordinary
 *     review and the fleet's hunk-eyeball rule own it. The whole-FILE case is
 *     closed here precisely because it is structurally invisible: nobody ever
 *     opened the file, so no hunk was ever reviewed. Closing the visible half here
 *     too would be theatre.
 *   - It does NOT police non-test source, nor assert anything about test CONTENT.
 *   - It cannot run without git; if git is absent or errors it FAILS CLOSED (reds),
 *     never silent-green.
 * Claiming more than the whole-file guarantee would be this fleet's signature
 * failure — a true statement about a PART ("the roster is intact") worn as a claim
 * about the WHOLE ("the tests are intact"). It is not. It is exactly and only a
 * roster census.
 *
 * WHY THE ENUMERATOR IS `git ls-files`, NEVER A DISK WALK. The tracked set is the
 * thing that ships; the working tree is not. This tree right now holds an untracked
 * scratch probe (_camerakick.probe.test.ts) that a disk walk would sweep straight
 * into a committed manifest — reddening every innocent checkout and CI, naming a
 * file that does not exist on the branch. Seeding or enumerating from the tree bakes
 * whatever contamination happens to be lying around into the detector built to catch
 * contamination. `git ls-files -- src` is the tracked set by construction, and it is
 * scoped `-- src` (not a `src/**` pathspec, which requires an intermediate directory
 * and silently drops top-level files like App.tsx).
 *
 * MAINTAINING THE MANIFEST. It is a deliberately-maintained, committed artifact, not
 * an auto-generated cache — regenerating it at runtime would be a self-referential
 * oracle that can never fail. Adding or removing a test edits the file AND the
 * manifest in ONE reviewable diff. To refresh after a legitimate change, from the
 * repo root:
 *
 *   git ls-files -- src | grep -E '\.test\.(ts|tsx)$' \
 *     | grep -vE '(^|/)_[^/]*\.probe\.test\.ts$' \
 *     | LC_ALL=C sort -u > src/__tests__/testFileManifest.txt
 *
 * — then EYEBALL the diff. A manifest line vanishing that you did not intend to
 * remove is a deletion to investigate, not a diff to bless: that named line is the
 * signal this whole gate exists to produce.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')

const MANIFEST_REL = 'src/__tests__/testFileManifest.txt'
const MANIFEST_PATH = resolve(REPO, MANIFEST_REL)

/** A file is census-eligible iff it is a .test.ts(x) AND not a `_*.probe.test.ts`
 *  scratch dump. The probe carve-out mirrors vite.config.ts's `test.exclude`, so the
 *  roster tracks exactly the files vitest actually runs. */
const TEST_RE = /\.test\.tsx?$/
const PROBE_RE = /(^|\/)_[^/]*\.probe\.test\.ts$/
const isCensusTest = (path: string): boolean => TEST_RE.test(path) && !PROBE_RE.test(path)

/** Current tracked roster is ~100 files. A live enumeration below this can only mean
 *  the git call was starved, mis-scoped, or run outside the repo — i.e. vacuity, not a
 *  real deletion of half the suite. Reds rather than silently passing an empty set. */
const FLOOR = 50

type Census = { deleted: string[]; unlisted: string[]; ok: boolean }

/** The pure verdict. `deleted`: in the manifest but no longer tracked (removed or
 *  renamed out of the tree). `unlisted`: tracked but absent from the manifest (added
 *  without updating the roster). Either is a failure; both are reported by name. */
function census(manifest: readonly string[], tracked: readonly string[]): Census {
  const M = new Set(manifest)
  const T = new Set(tracked)
  const deleted = [...manifest].filter((p) => !T.has(p)).sort()
  const unlisted = [...tracked].filter((p) => !M.has(p)).sort()
  return { deleted, unlisted, ok: deleted.length === 0 && unlisted.length === 0 }
}

/** The load-invariant enumerator: the git INDEX, not the working tree. Fails closed. */
function gitTrackedTests(): string[] {
  const res = spawnSync('git', ['ls-files', '--', 'src'], { cwd: REPO, encoding: 'utf8', timeout: 55_000 })
  if (res.error) throw new Error(`git ls-files failed to spawn: ${res.error.message}`)
  if (res.status !== 0) throw new Error(`git ls-files exit=${res.status}: ${(res.stderr || '').slice(-500)}`)
  return (res.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(isCensusTest)
    .sort()
}

function readManifest(): string[] {
  const raw = readFileSync(MANIFEST_PATH, 'utf8')
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
}

/** Raw recursive walk of src/ — EVERY .test.ts(x) on disk, probes included, tracked
 *  or not. Used solely to demonstrate that untracked-on-disk scratch is absent from
 *  the tracked enumerator and the manifest (the anti-contamination contract). */
function diskWalkTestsRaw(dir = 'src', acc: string[] = []): string[] {
  for (const ent of readdirSync(resolve(REPO, dir), { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
    const rel = `${dir}/${ent.name}`
    if (ent.isDirectory()) diskWalkTestsRaw(rel, acc)
    else if (TEST_RE.test(ent.name)) acc.push(rel)
  }
  return acc
}

describe('roster-census verdict logic (hermetic — synthetic inputs, no git, no disk)', () => {
  it('eligibility: matches .test.ts(x); rejects non-tests and `_*.probe.test.ts` scratch', () => {
    expect(isCensusTest('src/a.test.ts')).toBe(true)
    expect(isCensusTest('src/a.test.tsx')).toBe(true)
    expect(isCensusTest('src/x/__tests__/a.node.test.ts')).toBe(true)
    expect(isCensusTest('src/a.ts')).toBe(false)
    expect(isCensusTest('src/atest.ts')).toBe(false)
    expect(isCensusTest('src/three/fight/__tests__/_camerakick.probe.test.ts')).toBe(false)
    expect(isCensusTest('src/_lonely.probe.test.ts')).toBe(false)
  })

  it('reds by name when a manifest entry is no longer tracked (a deletion)', () => {
    const v = census(['src/a.test.ts', 'src/b.test.ts'], ['src/a.test.ts'])
    expect(v.ok).toBe(false)
    expect(v.deleted).toEqual(['src/b.test.ts'])
    expect(v.unlisted).toEqual([])
  })

  it('reds by name when a tracked file is missing from the manifest (an unlisted add)', () => {
    const v = census(['src/a.test.ts'], ['src/a.test.ts', 'src/b.test.ts'])
    expect(v.ok).toBe(false)
    expect(v.deleted).toEqual([])
    expect(v.unlisted).toEqual(['src/b.test.ts'])
  })

  it('is green only when the sets are exactly equal (order-independent)', () => {
    const v = census(['src/b.test.ts', 'src/a.test.ts'], ['src/a.test.ts', 'src/b.test.ts'])
    expect(v).toEqual({ deleted: [], unlisted: [], ok: true })
  })
})

describe('tracked test-file roster matches the committed manifest', () => {
  const tracked = gitTrackedTests()
  const manifest = readManifest()

  it(`git enumerates a non-vacuous tracked set (>= ${FLOOR}) — a starved/mis-scoped git call reds, not passes`, () => {
    expect(tracked.length).toBeGreaterThanOrEqual(FLOOR)
  })

  it(`the manifest is non-vacuous (>= ${FLOOR}) — an emptied roster reds, not passes`, () => {
    expect(manifest.length).toBeGreaterThanOrEqual(FLOOR)
  })

  it('the roster equals the tracked set — a whole-file deletion or unlisted add reds BY NAME', () => {
    const v = census(manifest, tracked)
    expect(
      v.deleted,
      `${v.deleted.length} file(s) are in ${MANIFEST_REL} but NO LONGER TRACKED — a test file was ` +
        `deleted or renamed without updating the manifest. If deliberate, remove these lines in the ` +
        `SAME diff; if not, you just found a silently-dropped test:\n  ${v.deleted.join('\n  ')}`,
    ).toEqual([])
    expect(
      v.unlisted,
      `${v.unlisted.length} tracked test file(s) are MISSING from ${MANIFEST_REL} — add them in the ` +
        `SAME diff that adds the test (see the regen command in this file's header):\n  ${v.unlisted.join('\n  ')}`,
    ).toEqual([])
  })

  it('every manifest entry exists on disk — catches a working-tree delete the index still lists', () => {
    const gone = manifest.filter((p) => !existsSync(resolve(REPO, p)))
    expect(
      gone,
      `${gone.length} manifest entr(y/ies) are tracked but ABSENT from the working tree — vitest ` +
        `silently collects one fewer file while the index still lists it:\n  ${gone.join('\n  ')}`,
    ).toEqual([])
  })

  it('untracked-on-disk test scratch is excluded from BOTH the tracked set and the manifest (reads git, not the tree)', () => {
    const trackedSet = new Set(tracked)
    const manifestSet = new Set(manifest)
    // Untracked test files physically present under src/ (e.g. a `_*.probe.test.ts` scratch dump).
    const diskOnly = diskWalkTestsRaw().filter((p) => !trackedSet.has(p))
    for (const p of diskOnly) {
      expect(manifestSet.has(p), `untracked disk scratch leaked into the manifest: ${p}`).toBe(false)
    }
    // Definitionally true, asserted to pin the contract: nothing the enumerator returns is untracked.
    expect(tracked.every((p) => trackedSet.has(p))).toBe(true)
  })
})
