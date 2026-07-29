#!/usr/bin/env bash
#
# Proves the release pipeline still works, without releasing anything.
#
# WHY THIS EXISTS
#
# Everything python-semantic-release does happens on `main`, after a merge, and
# only when a commit since the last tag asked for a bump. That is a bad place to
# discover that a Jinja template has a typo in it or that pyproject.toml no
# longer parses: the merge has landed, the release did not happen, and the next
# person to merge inherits it.
#
# The obvious cheap check does not work. `semantic-release --noop changelog`
# exits 0 with a deliberately broken template, because --noop skips the render;
# so does a real `changelog` run, because with `mode = "update"` and nothing new
# to add it never reaches the templates at all. Both were tried. The only thing
# that actually exercises the config, the templates and the build_command is a
# release — so this does one, in a throwaway clone that is deleted afterwards.
#
# Nothing here can touch the checkout it is run from: the clone is the unit of
# work, and it is thrown away on exit whether this passes or fails.
#
# Usage: scripts/ci/release-dry-run.sh
set -euo pipefail

command -v semantic-release >/dev/null || {
  echo "semantic-release is not on PATH — pip install python-semantic-release" >&2
  exit 2
}

repo=$(git rev-parse --show-toplevel)
# PSR reads `origin` to work out whose repository this is, and puts that in
# every commit link it renders. Dropping the remote is therefore not an option
# — it fails outright — so the clone keeps the real one and is held back by
# `--no-push --no-vcs-release` below instead. That is belt and braces: the job
# that runs this is given no token either, so it could not write if it tried.
upstream=$(git remote get-url origin 2>/dev/null || echo 'https://github.com/jtn0123/binocular.git')

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "Cloning into $work"
git clone --quiet --no-hardlinks --shared "$repo" "$work/repo"
cd "$work/repo"

git remote set-url origin "$upstream"
git config user.email 'release-dry-run@localhost'
git config user.name 'release dry run'

# PSR only acts on its configured release branch, and reads the current version
# from tags rather than from the config — so both have to be true here or it
# declines to do anything and the check passes vacuously.
git checkout --quiet -B main

# Every v* tag is dropped and one baseline planted, so the expected result is a
# fixed number rather than "whatever the repository happens to be at". That is
# what lets the check below assert that a `feat:` bumped the *minor*: with a
# real baseline it could only assert that something was cut, which stayed true
# when `minor_tags` was emptied and the fix: commit bumped the patch instead.
git tag --list 'v*' | xargs -r git tag -d >/dev/null
git tag v0.0.1
readonly EXPECTED_TAG=v0.1.0 # v0.0.1 + a feat:, with major_on_zero

# Sentinels, so a passing check cannot be a coincidence. The repository's real
# VERSION already matched the version this run computes, so dropping
# `build_command` — which is the only thing that writes these two files — left
# them correct by accident and the check passed.
readonly UNSET=0.0.0-unset
printf '%s\n' "$UNSET" > VERSION
node -e '
  const fs = require("node:fs");
  const c = JSON.parse(fs.readFileSync("app.json", "utf8"));
  c.expo.version = process.argv[1];
  fs.writeFileSync("app.json", JSON.stringify(c, null, 2) + "\n");
' "$UNSET"
git commit --quiet -am 'test: sentinel versions for the dry run'

before=$(git rev-parse HEAD)

# One commit of each shape that renders differently: a feature with an Impact
# note, a fix, and two types that both collapse into "Changed" — which is the
# case that used to emit a duplicate heading.
touch .dry-run-a && git add -A
git commit --quiet -m "feat(map): a feature

Impact: this line should render as an italic note under the entry."
touch .dry-run-b && git add -A && git commit --quiet -m "fix(db): a fix"
touch .dry-run-c && git add -A && git commit --quiet -m "refactor(map): a refactor"
touch .dry-run-d && git add -A && git commit --quiet -m "chore(deps): a chore"

echo "Running semantic-release (local only: no push, no GitHub release)"
semantic-release version --no-push --no-vcs-release

fail() {
  local message="$1"
  # ::error:: is what puts this in the run's annotations rather than only in
  # the log; stderr so it is not mistaken for the script's normal output.
  echo "::error title=Release dry run::${message}" >&2
  exit 1
}

# --- what the release must have produced ------------------------------------

[[ "$(git rev-parse HEAD)" != "$before" ]] || fail 'no version commit was made — a feat: commit did not bump the version'

tag=$(git tag --points-at HEAD | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true)
[[ -n "$tag" ]] || fail 'no v* tag was created'
[[ "$tag" == "$EXPECTED_TAG" ]] \
  || fail "a feat: on top of v0.0.1 should cut ${EXPECTED_TAG}, not ${tag} — check minor_tags / major_on_zero"

version="${tag#v}"
[[ "$(cat VERSION)" == "$version" ]] || fail "VERSION says $(cat VERSION), tag says ${version} — did build_command run?"
app=$(node -p "require('./app.json').expo.version")
[[ "$app" == "$version" ]] || fail "app.json says ${app}, tag says ${version} — did build_command run?"

grep -q "## ${tag} " CHANGELOG.md || fail "CHANGELOG.md has no section for ${tag}"
grep -q '### ✳️ New' CHANGELOG.md || fail 'the feat: commit produced no "New" section'
grep -q '### 🔺 Fix' CHANGELOG.md || fail 'the fix: commit produced no "Fix" section'
grep -q '_this line should render as an italic note under the entry._' CHANGELOG.md \
  || fail 'the Impact: note did not render'

# The bug this file was written alongside: refactor and chore are different PSR
# types that share one heading, and the template used to print the heading once
# per type.
changed=$(grep -c '### 🔷 Changed' CHANGELOG.md || true)
[[ "$changed" -eq 1 ]] || fail "expected exactly one \"Changed\" heading, found ${changed}"

echo
echo "Dry run passed — ${tag} would be cut, and the changelog renders:"
sed -n "/## ${tag} /,/^## v/p" CHANGELOG.md | sed 's/^/    /'
