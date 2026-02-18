#!/usr/bin/env bash
set -euo pipefail

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1090
  source "$HOME/.cargo/env"
fi

export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v cargo >/dev/null 2>&1; then
  cat <<'EOF'
Error: cargo was not found on PATH.
Install Rust with rustup and restart your terminal, or run:
  source "$HOME/.cargo/env"
EOF
  exit 1
fi

exec tauri "$@"
