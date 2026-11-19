#!/usr/bin/env bash
set -euo pipefail

apt_options=(-o APT::Update::Error-Mode=any)

download_ffmpeg() {
  # Bound the total fetch time even if the mirror keeps transferring slowly.
  # Finish downloading before letting apt start dpkg.
  sudo timeout --kill-after=5s 30s apt-get "${apt_options[@]}" update &&
    sudo timeout --kill-after=5s 45s apt-get "${apt_options[@]}" \
      --yes --no-install-recommends --download-only install ffmpeg
}

if download_ffmpeg; then
  echo 'Downloaded FFmpeg using the runner apt sources.'
else
  echo '::warning::FFmpeg downloads from the runner apt sources failed or timed out. Retrying with the Ubuntu archive.'
  fallback_sources=$(mktemp)
  trap 'rm -f "$fallback_sources"' EXIT
  cat > "$fallback_sources" <<'EOF'
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu/ noble main restricted universe multiverse
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu/ noble-updates main restricted universe multiverse
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://security.ubuntu.com/ubuntu/ noble-security main restricted universe multiverse
EOF
  apt_options+=(-o "Dir::Etc::sourcelist=$fallback_sources" -o Dir::Etc::sourceparts=-)
  download_ffmpeg
  echo 'Downloaded FFmpeg using the fallback Ubuntu archive.'
fi

sudo apt-get "${apt_options[@]}" --yes --no-install-recommends --no-download install ffmpeg
ffmpeg -version
