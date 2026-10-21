#!/usr/bin/env bash
#
# Cut a new release: bump package.json, commit, tag vX.Y.Z, push,
# then prune old tags so only the newest KEEP releases remain.
#
#   ./scripts/release.sh            # patch: 0.0.1 -> 0.0.2
#   ./scripts/release.sh minor      # 0.0.2 -> 0.1.0
#   ./scripts/release.sh major      # 0.1.0 -> 1.0.0
#
set -euo pipefail

LEVEL="${1:-patch}"
KEEP="${KEEP:-4}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"

case "${LEVEL}" in
  patch|minor|major) ;;
  *) echo "Usage: $0 [patch|minor|major]" >&2; exit 1 ;;
esac

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; commit or stash your changes first." >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "${CURRENT_BRANCH}" != "${BRANCH}" ]]; then
  echo "Releases must be cut from '${BRANCH}' (currently on '${CURRENT_BRANCH}')." >&2
  exit 1
fi

git fetch --quiet --tags "${REMOTE}"
git pull --quiet --ff-only "${REMOTE}" "${BRANCH}"

NEW_VERSION="$(npm version "${LEVEL}" --no-git-tag-version | sed 's/^v//')"
TAG="v${NEW_VERSION}"

git add package.json package-lock.json
git commit --quiet -m "release ${TAG}"
git tag -a "${TAG}" -m "Release ${TAG}"
git push --quiet "${REMOTE}" "${BRANCH}"
git push --quiet "${REMOTE}" "${TAG}"
echo "Released ${TAG}"

git tag --list 'v*' --sort=-v:refname | tail -n +"$((KEEP + 1))" | while read -r old; do
  [[ -n "${old}" ]] || continue
  echo "Pruning old release ${old}"
  git push --quiet "${REMOTE}" --delete "${old}" </dev/null || echo "  (remote tag ${old} already gone)"
  git tag -d "${old}" >/dev/null
done

echo "Kept releases: $(git tag --list 'v*' --sort=-v:refname | tr '\n' ' ')"
