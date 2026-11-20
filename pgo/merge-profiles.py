#!/usr/bin/env python3
"""Merge a Krunker-trained PGO profile into a base profile.

The base profile is either Electron's published profile for the target
(src/electron/build/pgo_profiles/electron-<os>-<arch>-*.profdata) or, better,
the output of Electron's own collection suite run on the *patched*
instrumented build (script/pgo/collect-profile.js).

The Krunker session is short next to the benchmark suite, so its counts are
scaled up until the Krunker profile carries `--ratio` times the base profile's
total count (default 1.0: equal say). Clang decides hot/cold from the merged
counts, so an unscaled ten-minute session would barely register.

  python3 merge-profiles.py \
      --llvm-profdata <src>/third_party/llvm-coverage-tools/bin/llvm-profdata \
      --base <base.profdata> \
      --krunker <dir of .profraw files, or a .profdata> \
      --output <src>/electron/build/pgo_profiles/kcc-<os>-<arch>.profdata

llvm-profdata must come from the same clang the tree builds with. Fetch it
with (from the Chromium src root; it must go in its own directory):
  python3 tools/clang/scripts/update.py --package=coverage_tools \
      --output-dir=third_party/llvm-coverage-tools
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile


def run(cmd):
  print('+ ' + ' '.join(cmd), flush=True)
  return subprocess.run(cmd, check=True, stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT, text=True).stdout


def total_count(tool, profile):
  out = run([tool, 'show', '--detailed-summary', profile])
  match = re.search(r'^Total count:\s*(\d+)', out, re.MULTILINE)
  if not match:
    return None
  functions = re.search(r'^Total functions:\s*(\d+)', out, re.MULTILINE)
  print(f'  {os.path.basename(profile)}: total count {match.group(1)}'
        f', functions {functions.group(1) if functions else "?"}')
  return int(match.group(1))


def main():
  parser = argparse.ArgumentParser(description=__doc__,
                                   formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument('--llvm-profdata', required=True)
  parser.add_argument('--base', required=True, help='base .profdata')
  parser.add_argument('--krunker', required=True,
                      help='directory of .profraw files, or a merged .profdata')
  parser.add_argument('--output', required=True)
  parser.add_argument('--ratio', type=float, default=1.0,
                      help='Krunker total count as a multiple of the base total (default 1.0)')
  parser.add_argument('--weight', type=int, default=0,
                      help='use this integer weight for the Krunker profile instead of --ratio')
  args = parser.parse_args()

  tool = args.llvm_profdata
  if not os.path.exists(tool):
    sys.exit(f'llvm-profdata not found: {tool} (see the module docstring)')
  if not os.path.exists(args.base):
    sys.exit(f'base profile not found: {args.base}')

  krunker = args.krunker
  with tempfile.TemporaryDirectory() as tmp:
    if os.path.isdir(krunker):
      raws = sorted(os.path.join(krunker, f) for f in os.listdir(krunker)
                    if f.endswith('.profraw'))
      if not raws:
        sys.exit(f'no .profraw files in {krunker}: the instrumented build was '
                 'killed instead of quit, or LLVM_PROFILE_FILE was not set')
      listing = os.path.join(tmp, 'inputs.txt')
      with open(listing, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(raws) + '\n')
      krunker = os.path.join(tmp, 'krunker.profdata')
      print(f'merging {len(raws)} .profraw files')
      print(run([tool, 'merge', '-o', krunker, f'--input-files={listing}']))

    weight = args.weight
    if weight <= 0:
      base_total = total_count(tool, args.base)
      krunker_total = total_count(tool, krunker)
      if not base_total or not krunker_total:
        sys.exit('could not read "Total count" from llvm-profdata show; '
                 'rerun with an explicit --weight N')
      weight = max(1, round(args.ratio * base_total / krunker_total))
    print(f'Krunker weight: {weight}')

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    print(run([tool, 'merge', '-o', args.output,
               f'--weighted-input=1,{args.base}',
               f'--weighted-input={weight},{krunker}']))

  total_count(tool, args.output)
  print(f'\nwrote {args.output}')
  print('In out/Release/args.gn set pgo_data_path to this file (a //-rooted GN '
        'path or an absolute path), then gn gen and rebuild.')


if __name__ == '__main__':
  main()
