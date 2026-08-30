#!/bin/sh
set -eu

umask 077

repository="atinseau/opencodex-cloud"
install_dir="${XDG_BIN_HOME:-${HOME}/.local/bin}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) est requis : https://cli.github.com/" >&2
  exit 69
fi

case "$(uname -s)" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *) echo "Système non pris en charge. macOS et Linux sont supportés." >&2; exit 69 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) architecture="x64" ;;
  arm64|aarch64) architecture="arm64" ;;
  *) echo "Architecture non prise en charge : $(uname -m)" >&2; exit 69 ;;
esac

release_tag="${OPENCODEX_CLOUD_VERSION:-$(gh release view --repo "$repository" --json tagName --jq .tagName)}"
asset="opencodex-cloud-${platform}-${architecture}"
temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

gh release download "$release_tag" \
  --repo "$repository" \
  --pattern "$asset" \
  --pattern checksums.txt \
  --dir "$temporary_dir"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$temporary_dir" && sha256sum --check --ignore-missing checksums.txt)
else
  expected="$(awk -v name="$asset" '$2 == name { print $1 }' "$temporary_dir/checksums.txt")"
  actual="$(shasum -a 256 "$temporary_dir/$asset" | awk '{ print $1 }')"
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || {
    echo "Échec de vérification SHA-256." >&2
    exit 74
  }
fi

mkdir -p "$install_dir"
install -m 0755 "$temporary_dir/$asset" "$install_dir/opencodex-cloud"
exec "$install_dir/opencodex-cloud" connect
