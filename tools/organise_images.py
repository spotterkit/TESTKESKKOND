#!/usr/bin/env python3
"""Organise root-level local images into images/<group>/ and update index.html.

Default is dry-run. Use --apply to perform changes.
Only local files referenced as images/<filename> inside CATEGORIES items are moved.
Commons filenames and already-organised images/<group>/<filename> paths are untouched.
"""
from pathlib import Path
import argparse, re, shutil, sys

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
IMAGES = ROOT / "images"


def build_mapping(text: str):
    mapping = {}
    # CATEGORIES entries are flat object literals; restrict matches to entries with group + files.
    for m in re.finditer(r"\{\s*label:\s*['\"].*?\}\s*,?", text, re.S):
        block = m.group(0)
        if "files:" not in block or "group:" not in block:
            continue
        gm = re.search(r"group:\s*['\"]([^'\"]+)", block)
        if not gm:
            continue
        group = gm.group(1)
        for ref in re.findall(r"['\"](images/[^'\"]+)['\"]", block):
            p = Path(ref)
            if len(p.parts) == 2:  # only images/<filename>, not already organised
                mapping[ref] = f"images/{group}/{p.name}"
    return mapping


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Move files and update index.html")
    args = ap.parse_args()

    text = INDEX.read_text(encoding="utf-8")
    mapping = build_mapping(text)
    problems = []
    moves = []

    for old, new in sorted(mapping.items()):
        src, dst = ROOT / old, ROOT / new
        if not src.exists():
            problems.append(f"PUUDUB: {old}")
            continue
        if dst.exists() and src.resolve() != dst.resolve():
            problems.append(f"SIHT OLEMAS: {new}")
            continue
        moves.append((old, new, src, dst))

    print(f"Leitud juurkausta lokaalseid pilte: {len(mapping)}")
    for old, new, _, _ in moves:
        print(f"  {old} -> {new}")
    if problems:
        print("\nPROBLEEMID:")
        for p in problems:
            print("  " + p)
        print("Muudatusi ei tehtud.")
        return 2

    if not args.apply:
        print("\nDRY-RUN: muudatusi ei tehtud. Käivitamiseks lisa --apply")
        return 0

    backup = INDEX.with_suffix(".html.bak")
    shutil.copy2(INDEX, backup)
    new_text = text
    for old, new, src, dst in moves:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        new_text = new_text.replace(old, new)
    INDEX.write_text(new_text, encoding="utf-8")

    # Verify every local path referenced in executable data exists; ignore comments/examples.
    actual_refs = set()
    for m in re.finditer(r"\{\s*label:\s*['\"].*?\}\s*,?", new_text, re.S):
        block = m.group(0)
        if "files:" in block:
            actual_refs.update(re.findall(r"['\"](images/[^'\"]+)['\"]", block))
    missing = sorted(r for r in actual_refs if not (ROOT / r).exists())
    if missing:
        print("\nHOIATUS: puuduvad lokaalsed failid:")
        for r in missing: print("  " + r)
        return 3

    print(f"\nVALMIS: liigutatud {len(moves)} pilti. HTML-varukoopia: {backup.name}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
