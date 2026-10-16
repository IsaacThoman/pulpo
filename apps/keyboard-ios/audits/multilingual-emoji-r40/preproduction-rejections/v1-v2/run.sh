#!/bin/sh
set -eu
export TMPDIR=/tmp/pulpo-r40-domain-review
cd /tmp/pulpo-r40-domain-review
swiftc -O -module-cache-path /tmp/pulpo-r40-domain-review/module-cache baseline-EmojiCatalog.swift Projection.swift domain-witness.swift -o domain-witness
./domain-witness > domain-results.txt
swiftc -O -module-cache-path /tmp/pulpo-r40-domain-review/module-cache baseline-EmojiCatalog.swift Projection.swift domain-support.swift real-catalog.swift -o real-catalog
./real-catalog > real-catalog-results.txt
swiftc -O -module-cache-path /tmp/pulpo-r40-domain-review/module-cache Projection.swift scalar-scan.swift -o scalar-scan
./scalar-scan > scalar-scan.txt
