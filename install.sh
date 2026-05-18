#!/usr/bin/env sh
set -eu

repo="${NEMO_REPO:-omarestrella/nemo}"
version="${NEMO_VERSION:-latest}"
prefix="${NEMO_PREFIX:-/usr/local}"
state_dir="${NEMO_STATE_DIR:-/var/lib/nemo-agent}"
host="${NEMO_HOST:-0.0.0.0}"
port="${NEMO_PORT:-7331}"
install_only="${NEMO_INSTALL_ONLY:-0}"

fail() {
  printf 'nemo installer: %s\n' "$1" >&2
  exit 1
}

info() {
  printf 'nemo installer: %s\n' "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

download() {
  url="$1"
  output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$output" "$url"
  else
    fail "missing curl or wget"
  fi
}

sha256_file() {
  file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    printf ''
  fi
}

os="$(uname -s)"
[ "$os" = "Linux" ] || fail "only Linux hosts are supported by the agent installer"

case "$(uname -m)" in
  x86_64 | amd64)
    asset="nemo-agent-linux-x64"
    ;;
  aarch64 | arm64)
    asset="nemo-agent-linux-arm64"
    ;;
  *)
    fail "unsupported architecture: $(uname -m)"
    ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  sudo_cmd=""
else
  need_cmd sudo
  sudo_cmd="sudo"
fi

if [ "$version" = "latest" ]; then
  release_url="https://github.com/$repo/releases/latest/download"
else
  release_url="https://github.com/$repo/releases/download/$version"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

binary_path="$tmp_dir/$asset"
checksums_path="$tmp_dir/SHA256SUMS"
install_path="$prefix/bin/nemo-agent"

info "downloading $asset from $release_url"
download "$release_url/$asset" "$binary_path"

if download "$release_url/SHA256SUMS" "$checksums_path" >/dev/null 2>&1; then
  expected="$(awk -v file="$asset" '$2 == file {print $1}' "$checksums_path" | head -n 1)"
  actual="$(sha256_file "$binary_path")"
  if [ -n "$expected" ] && [ -n "$actual" ] && [ "$expected" != "$actual" ]; then
    fail "checksum mismatch for $asset"
  fi
fi

info "installing $install_path"
$sudo_cmd install -d -m 0755 "$prefix/bin"
$sudo_cmd install -m 0755 "$binary_path" "$install_path"

if [ "$install_only" = "1" ]; then
  info "binary installed; skipping host initialization because NEMO_INSTALL_ONLY=1"
  exit 0
fi

info "initializing host integration"
$sudo_cmd "$install_path" init --state-dir "$state_dir" --host "$host" --port "$port"

if command -v systemctl >/dev/null 2>&1; then
  info "enabling nemo-agent.service"
  $sudo_cmd systemctl daemon-reload
  $sudo_cmd systemctl enable --now nemo-agent
else
  info "systemctl was not found; start nemo-agent manually for this host"
fi

info "running doctor"
$sudo_cmd "$install_path" doctor --state-dir "$state_dir"

info "done"
