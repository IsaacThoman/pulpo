# Weather city data

The runtime city index is a modified subset of the GeoNames cities5000 gazetteer and administrative divisions. GeoNames licenses the data under CC BY 4.0 and permits commercial reuse. The index retains selected names, administrative divisions, coordinates, time zones, and population for ranking disambiguation choices. See the [GeoNames export documentation](https://download.geonames.org/export/dump/readme.txt) and the [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/).

To regenerate the index, download [cities5000.zip](https://download.geonames.org/export/dump/cities5000.zip) and [admin1CodesASCII.txt](https://download.geonames.org/export/dump/admin1CodesASCII.txt), then run `python3 apps/server/data/search-weather/generate.py cities5000.zip admin1CodesASCII.txt` from the repository root.
