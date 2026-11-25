"""Build the compact runtime index from the two GeoNames export files."""
import gzip
import io
import json
import pathlib
import sys
import zipfile

cities_archive, regions_file = map(pathlib.Path, sys.argv[1:])
common_aliases = {"5128581": ["New York", "NYC"]}
regions = {}
with regions_file.open(encoding="utf-8") as source:
    for line in source:
        key, name, *_ = line.rstrip("\n").split("\t")
        regions[key] = name

cities = []
with zipfile.ZipFile(cities_archive) as archive:
    with io.TextIOWrapper(archive.open("cities5000.txt"), encoding="utf-8") as source:
        for line in source:
            columns = line.rstrip("\n").split("\t")
            city_id, name, ascii_name, alternates, latitude, longitude, _, _, country, _, region = columns[:11]
            if not country or not columns[17]:
                continue
            # Keep a few short aliases for familiar names and local spellings.
            aliases = []
            for alternate in [ascii_name, *common_aliases.get(city_id, []), *alternates.split(",")]:
                if alternate and alternate != name and alternate not in aliases and len(alternate) <= 48:
                    aliases.append(alternate)
                if len(aliases) == 5:
                    break
            cities.append([name, aliases, country, region, float(latitude), float(longitude), int(columns[14]), columns[17]])

output = pathlib.Path(__file__).with_name("cities.json.gz")
payload = json.dumps({"regions": regions, "cities": cities}, separators=(",", ":"), ensure_ascii=False).encode()
output.write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
print(f"{len(cities)} populated places; {output.stat().st_size:,} compressed bytes")
