#!/usr/bin/env python3
"""Batch-generate all manifest assets with status 'needs-generation'.

Runs 3 concurrent async requests for ~20 images/minute without being
aggressive enough to risk rate limits.

    python3 batch_generate.py              # generate all (3 candidates each)
    python3 batch_generate.py --dry-run    # list what would be generated
    python3 batch_generate.py --n 1        # 1 candidate per entry
    python3 batch_generate.py --section portraits   # portraits only

The single-key workflow is unchanged — use generate.py --key for targeted re-rolls.
"""
import argparse, asyncio, json, pathlib, sys
import aiohttp

# Import shared logic from generate.py (same directory)
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import generate as gen

CONCURRENCY = 3
DEFAULT_N   = 3


def find_needs_generation(section_filter=None):
    """Return list of (section, key) for all needs-generation entries in the manifest."""
    if not gen.MANIFEST.exists():
        sys.exit(f"no manifest at {gen.MANIFEST}")
    man = json.loads(gen.MANIFEST.read_text())
    results = []
    for sec in ("portraits", "backgrounds", "splashes"):
        if section_filter and sec != section_filter:
            continue
        entries = man.get(sec, {})
        if not isinstance(entries, dict):
            continue
        for key, entry in entries.items():
            if isinstance(entry, dict) and entry.get("status") == "needs-generation":
                results.append((sec, key))
    return results


def build_jobs(keys, n):
    """Expand (section, key) list into individual (key, candidate_idx, prompt, fname) jobs.

    Returns (jobs, skipped) where skipped is a list of (key, reason) strings for
    manifest entries that couldn't be resolved.
    """
    jobs, skipped = [], []
    for sec, key in keys:
        try:
            lock, scene, faction, aspect = gen.manifest_entry(key)
        except SystemExit as e:
            skipped.append((key, str(e)))
            continue
        prompt = gen.compose(lock, scene, faction, aspect)
        for i in range(1, n + 1):
            fname = f"{key}_{i:02d}.png"
            jobs.append((key, i, prompt, fname))
    return jobs, skipped


async def run_batch(jobs, out_dir, dry_run):
    """Execute all jobs with CONCURRENCY=3 in-flight requests."""
    out_dir.mkdir(parents=True, exist_ok=True)

    if dry_run:
        to_gen = 0
        for key, i, prompt, fname in jobs:
            exists = (out_dir / fname).exists()
            tag = "EXISTS  " if exists else "GENERATE"
            print(f"  [{tag}] {fname}")
            if not exists:
                to_gen += 1
        print(f"\n{to_gen} to generate, {len(jobs) - to_gen} already exist")
        return

    tok      = gen.token()
    sem      = asyncio.Semaphore(CONCURRENCY)
    total    = len(jobs)
    generated = 0
    skipped   = 0
    failed    = 0

    async def do_job(job_num, key, candidate_idx, prompt, fname):
        nonlocal generated, skipped, failed
        out_path = out_dir / fname
        if out_path.exists():
            print(f"[{job_num}/{total}] {fname} -> exists, skipping")
            skipped += 1
            return
        async with aiohttp.ClientSession() as session:
            raw = await gen.async_generate(session, prompt, tok, sem)
        if raw is None:
            print(f"[{job_num}/{total}] {fname} -> FAILED", file=sys.stderr)
            failed += 1
            return
        out_path.write_bytes(raw)
        print(f"[{job_num}/{total}] {fname} -> {len(raw)//1024}KB")
        generated += 1

    await asyncio.gather(*[
        do_job(num, key, idx, prompt, fname)
        for num, (key, idx, prompt, fname) in enumerate(jobs, 1)
    ])

    print(f"\nDone: {generated} generated, {skipped} skipped (existed), {failed} failed")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--n",       type=int, default=DEFAULT_N,
                    help=f"candidates per key (default {DEFAULT_N})")
    ap.add_argument("--section", choices=("portraits", "backgrounds", "splashes"),
                    default=None, help="limit to one manifest section")
    ap.add_argument("--dry-run", action="store_true",
                    help="list what would be generated without calling the API")
    a = ap.parse_args()

    keys = find_needs_generation(section_filter=a.section)
    if not keys:
        print("No needs-generation entries found" +
              (f" in section '{a.section}'" if a.section else "") + ".")
        return

    print(f"Found {len(keys)} needs-generation entries:")
    for sec, key in keys:
        print(f"  {sec}/{key}")

    jobs, skipped_manifest = build_jobs(keys, a.n)

    if skipped_manifest:
        print(f"\nSkipped {len(skipped_manifest)} entries (manifest errors):")
        for key, reason in skipped_manifest:
            print(f"  {key}: {reason}")

    print(f"\n{len(jobs)} candidate slots "
          f"({len(keys) - len(skipped_manifest)} keys × {a.n} each)\n")

    out_dir = gen.GENERATED
    asyncio.run(run_batch(jobs, out_dir, a.dry_run))


if __name__ == "__main__":
    main()
