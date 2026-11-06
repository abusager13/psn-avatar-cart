#!/usr/bin/env bash
# Build the Rust core to WebAssembly and drop it where the site serves it.
# Requires: rustup target add wasm32-unknown-unknown
set -euo pipefail
cd "$(dirname "$0")"

cargo build --release --target wasm32-unknown-unknown

mkdir -p ../site/wasm
cp target/wasm32-unknown-unknown/release/psn_core.wasm ../site/wasm/psn_core.wasm
echo "wrote site/wasm/psn_core.wasm ($(wc -c < ../site/wasm/psn_core.wasm) bytes)"
