#!/usr/bin/env bash
set -euo pipefail

runner_apt_options=(-o APT::Update::Error-Mode=any)

download_ffmpeg() {
  # Bound the total fetch time even if the mirror keeps transferring slowly.
  # Finish downloading before letting apt start dpkg.
  sudo timeout --kill-after=5s 30s apt-get "${apt_options[@]}" update &&
    sudo timeout --kill-after=5s 45s apt-get "${apt_options[@]}" \
      --yes --no-install-recommends --download-only install ffmpeg
}

archive_sources=$(mktemp)
trap 'rm -f "$archive_sources"' EXIT
cat > "$archive_sources" <<'EOF'
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu/ noble main restricted universe multiverse
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu/ noble-updates main restricted universe multiverse
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://security.ubuntu.com/ubuntu/ noble-security main restricted universe multiverse
EOF
apt_options=("${runner_apt_options[@]}" -o "Dir::Etc::sourcelist=$archive_sources" -o Dir::Etc::sourceparts=-)

if download_ffmpeg; then
  echo 'Downloaded FFmpeg using the Ubuntu archive.'
else
  echo '::warning::FFmpeg downloads from the Ubuntu archive failed or timed out. Retrying with the runner apt sources.'
  apt_options=("${runner_apt_options[@]}")
  download_ffmpeg
  echo 'Downloaded FFmpeg using the runner apt sources.'
fi

sudo apt-get "${apt_options[@]}" --yes --no-install-recommends --no-download install ffmpeg
ffmpeg -version
