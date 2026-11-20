#!/usr/bin/env bash
# Regenerate patch files from the local commits that `apply.sh --commit` made.
#
#   refresh.sh <chromium src dir> [<root>/<file> ...]
#
# With no patch named, every patch in series.txt is refreshed. For each one the
# commit whose subject is exactly "kcc-series: <root>/<file>" is looked up in
# that root's checkout; the description at the top of the diff (everything
# above the first "diff --git") is kept and the diff itself is replaced with
# that commit's.
#
# Fixing a patch in the build tree:
#   1. edit, then   git commit --fixup=<that patch's commit>
#   2. fold it in:  GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash <base>
#      (<base> = the commit the series was applied on)
#   3. refresh.sh <src>
# Edit the description at the top of the .diff by hand when behaviour changed.
# A new patch needs a line in series.txt and a commit with the matching
# subject; give it a description by hand afterwards.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
[ $# -ge 1 ] && [ -d "$1" ] || { sed -n '2,20p' "$0"; exit 2; }
SRC="$(cd "$1" && pwd)"; shift

root_dir() {
  case "$1" in
    chromium) echo "$SRC" ;;
    electron) echo "$SRC/electron" ;;
    v8) echo "$SRC/v8" ;;
    *) echo "" ;;
  esac
}

if [ $# -eq 0 ]; then
  set -- $(tr -d '\r' < "$HERE/series.txt" | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' | awk '{print $1 "/" $2}')
fi

# Scratch files live in one private (0700) directory.
TMPD="$(mktemp -d)" || { echo "cannot create a temporary directory"; exit 1; }
trap 'rm -rf "$TMPD"' EXIT

changed=0; same=0; fail=0
for item in "$@"; do
  root="${item%%/*}"; file="${item#*/}"
  dir="$(root_dir "$root")"; patch="$HERE/$root/$file"
  if [ -z "$dir" ] || [ ! -d "$dir" ]; then echo "NO TREE    $item"; fail=$((fail+1)); continue; fi
  commit="$(git -C "$dir" log --format=%H --fixed-strings --grep="kcc-series: $root/$file" -1)"
  if [ -z "$commit" ]; then echo "NO COMMIT  $item"; fail=$((fail+1)); continue; fi
  tmp="$TMPD/new.diff"
  if [ -f "$patch" ]; then
    awk '/^diff --git /{exit} {print}' "$patch" | tr -d '\r' > "$tmp"
  else
    printf 'Subject: %s\n\n(describe this patch)\n\n' "$file" > "$tmp"
  fi
  git -C "$dir" diff --no-color --no-ext-diff "$commit^" "$commit" | tr -d '\r' >> "$tmp"
  mkdir -p "$(dirname "$patch")"
  if [ -f "$patch" ] && cmp -s "$tmp" "$patch"; then
    same=$((same+1)); rm -f "$tmp"
  else
    mv "$tmp" "$patch"; echo "refreshed  $item"; changed=$((changed+1))
  fi
done
echo "refresh: $changed changed, $same unchanged, $fail failed"
[ "$fail" = 0 ]
