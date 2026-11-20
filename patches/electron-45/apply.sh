#!/usr/bin/env bash
# Apply (or check, or reverse) the Electron 45 patch series in order.
#
#   apply.sh <chromium src dir> [--check | --reverse | --commit]
#            [--group a,b,...] [--not-group a,b,...]
#
# Works in Git Bash on Windows and in the stock bash on Linux and macOS (3.2).
# Reads series.txt next to this script, one patch per line:
#
#   <root> <file> <group>
#
# root says which checkout the diff applies to:
#   chromium -> <src>      electron -> <src>/electron      v8 -> <src>/v8
# group is a label used to apply the series in stages (see README.md).
#
# --check      report whether every selected patch would apply to the committed
#              tree (HEAD), changing nothing. Patches later in the series depend
#              on earlier ones, so they are stacked in a scratch index.
# --reverse    undo the selected patches, last first (for a plain apply).
# --commit     apply each patch and commit it locally, one commit per patch,
#              with the subject "kcc-series: <root>/<file>". Use this for the
#              build tree: fixes can then be folded into the right commit and
#              refresh.sh can regenerate the diffs from the commits. Local
#              commits only; nothing is pushed.
# --group      only patches whose group is in the list.
# --not-group  every patch except those groups.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC=""; MODE=apply; GROUPS_IN=""; GROUPS_OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --reverse) MODE=reverse ;;
    --commit) MODE=commit ;;
    --group) GROUPS_IN=",$2,"; shift ;;
    --not-group) GROUPS_OUT=",$2,"; shift ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) SRC="$1" ;;
  esac
  shift
done
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "usage: apply.sh <chromium src dir> [--check|--reverse|--commit] [--group LIST] [--not-group LIST]"
  exit 2
fi
SRC="$(cd "$SRC" && pwd)"

root_dir() {
  case "$1" in
    chromium) echo "$SRC" ;;
    electron) echo "$SRC/electron" ;;
    v8) echo "$SRC/v8" ;;
    *) echo "" ;;
  esac
}

# All scratch files live in one private (0700) directory, so nothing is ever
# created at a guessable path in a shared temp directory.
TMPD="$(mktemp -d)" || { echo "cannot create a temporary directory"; exit 1; }
trap 'rm -rf "$TMPD"' EXIT
SERIES="$TMPD/series"; ERR="$TMPD/err"

tr -d '\r' < "$HERE/series.txt" | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' > "$SERIES"
if [ "$MODE" = reverse ]; then
  awk '{a[NR]=$0} END{for(i=NR;i>0;i--)print a[i]}' "$SERIES" > "$TMPD/series.r" &&
    mv "$TMPD/series.r" "$SERIES"
fi

ok=0; fail=0
while read -r root file group _; do
  if [ -n "$GROUPS_IN" ]; then case "$GROUPS_IN" in *",$group,"*) ;; *) continue ;; esac; fi
  if [ -n "$GROUPS_OUT" ]; then case "$GROUPS_OUT" in *",$group,"*) continue ;; esac; fi
  dir="$(root_dir "$root")"
  patch="$HERE/$root/$file"
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then echo "NO TREE  $root/$file (expected $dir)"; fail=$((fail+1)); continue; fi
  if [ ! -f "$patch" ]; then echo "MISSING  $root/$file"; fail=$((fail+1)); continue; fi
  case "$MODE" in
    apply)
      if git -C "$dir" apply --whitespace=nowarn "$patch"; then
        echo "applied  $root/$file"; ok=$((ok+1))
      else
        echo "FAILED   $root/$file  (stopping; nothing after it was applied)"; exit 1
      fi ;;
    commit)
      if git -C "$dir" apply --index --whitespace=nowarn "$patch" &&
         git -C "$dir" -c user.name=kcc -c user.email=kcc@localhost \
           commit -q --no-verify -m "kcc-series: $root/$file"; then
        echo "committed $root/$file"; ok=$((ok+1))
      else
        echo "FAILED   $root/$file  (stopping; nothing after it was applied)"; exit 1
      fi ;;
    reverse)
      if git -C "$dir" apply -R --whitespace=nowarn "$patch"; then
        echo "reverted $root/$file"; ok=$((ok+1))
      else
        echo "FAILED   $root/$file  (not applied, or edited since)"; fail=$((fail+1))
      fi ;;
    check)
      # One scratch index per checkout; git creates the file itself.
      idx="$TMPD/index-$root"
      if [ ! -f "$idx" ]; then
        GIT_INDEX_FILE="$idx" git -C "$dir" read-tree HEAD
      fi
      if GIT_INDEX_FILE="$idx" git -C "$dir" apply --cached --whitespace=nowarn "$patch" 2> "$ERR"; then
        echo "ok       $root/$file"; ok=$((ok+1))
      else
        echo "REJECTS  $root/$file"; sed 's/^/           /' "$ERR" | head -6; fail=$((fail+1))
      fi ;;
  esac
done < "$SERIES"

echo "$MODE: $ok ok, $fail failed"
[ "$fail" = 0 ]
