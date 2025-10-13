  // CONFIG: filenames relative to this HTML file
  const CSV_FILE = "routes_with_elevations.csv";
  const KML_FILE = "routes.kml";

  // Map bounds for Ethiopia + Djibouti (southwest, northeast)
  const BOUNDS_SW = [2.0, 32.0];   // lat, lon
  const BOUNDS_NE = [15.5, 48.5];


  // strong color palette (will repeat if routes > palette)
  const COLORS = [
    "#d32f2f","#1976d2","#2e7d32","#6a1b9a","#ef6c00",
    "#b71c1c","#0d47a1","#1b5e20","#f57c00","#263238",
    "#6d4c41","#0b5394","#00897b","#7b1fa2","#c2185b"
  ];

  // create map
  const map = L.map('map', {
    center: [9.65, 39.01],
    zoom: 6,
    minZoom: 6,
    maxZoom: 12,
    maxBounds: [BOUNDS_SW, BOUNDS_NE],
    maxBoundsViscosity: 1.0
  });

  // add OpenStreetMap tiles
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // layer control container (we will not use L.control.layers directly because
  // we need a custom legend; we'll manage overlays programmatically)
  const routeLayers = {};   // routeName -> L.LayerGroup
  const routeColors = {};   // routeName -> color

  // utility: create OSM and Google links
  function osmLink(lat, lon) {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
  }
  function googleLink(lat, lon) {
    return `https://www.google.com/maps?q=${lat},${lon}`;
  }

  // fetch and add country borders (Ethiopia + Djibouti) darker boundary
  (async function addCountryBorders(){
    try {
      const res = await fetch('https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson');
      const geo = await res.json();
      const subset = {
        type: "FeatureCollection",
        features: geo.features.filter(f => {
          const n = (f.properties.ADMIN || f.properties.NAME || "").toLowerCase();
          return n === "ethiopia" || n === "djibouti";
        })
      };
      L.geoJSON(subset, {
        style: {
          color: "#000000",
          weight: 2.5,
          opacity: 0.95,
          fillOpacity: 0
        }
      }).addTo(map);
    } catch (e) {
      console.warn("Could not load country borders:", e);
    }
  })();

  // load CSV via PapaParse
  async function loadCSV() {
    return new Promise((resolve, reject) => {
      Papa.parse(CSV_FILE, {
        download: true,
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: results => resolve(results.data),
        error: err => reject(err)
      });
    });
  }

  // load KML via omnivore (returns a featureGroup); omnivore uses XHR
  async function loadKML() {
    return new Promise((resolve, reject) => {
      try {
        const layer = omnivore.kml(KML_FILE);
        layer.on('ready', function() {
          resolve(layer.toGeoJSON());
        });
        layer.on('error', function(err){
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // Build color map for routes (in the order they appear in CSV)
  function buildRouteColors(rows) {
    const seen = new Set();
    const unique = [];
    rows.forEach(r => {
      const key = (r.Route || "Unknown").toString();
      if (!seen.has(key)) { seen.add(key); unique.push(key); }
    });
    unique.forEach((r, i) => {
      routeColors[r] = COLORS[i % COLORS.length];
    });
  }

  // Create legend items
  function createLegendEntries(routeNames) {
    const list = document.getElementById('legend-list');
    list.innerHTML = '';
    routeNames.forEach(routeName => {
      const color = routeColors[routeName] || '#333';
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.dataset.route = routeName;

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'legend-checkbox';
      chk.style.marginLeft = '6px';
      chk.addEventListener('change', e => {
        toggleRoute(routeName, e.target.checked);
      });

      const sw = document.createElement('div');
      sw.className = 'legend-color-swatch';
      sw.style.backgroundColor = color;

      const name = document.createElement('div');
      name.className = 'legend-name';
      name.textContent = routeName;const count = (window.routeStats && window.routeStats[routeName]) ? window.routeStats[routeName].stations : 0;
        name.textContent = `${routeName} (${count} stations)`;

      item.appendChild(chk);
      item.appendChild(sw);
      item.appendChild(name);

      list.appendChild(item);
    });
  }

  // toggle route visibility
  function toggleRoute(routeName, on) {
    const layer = routeLayers[routeName];
    if (!layer) return;
    if (on) {
      map.addLayer(layer);
    } else {
      map.removeLayer(layer);
    }
  }

  // check/uncheck all functions
  function setAllRoutes(on) {
    Object.keys(routeLayers).forEach(rn => {
      const cb = document.querySelector(`.legend-item[data-route="${cssEscape(rn)}"] input.legend-checkbox`);
      if (cb) cb.checked = on;
      toggleRoute(rn, on);
    });
  }

  // cssEscape helper for dataset matching (simple subset)
  function cssEscape(str) {
    return str.replace(/["'\\]/g, '');
  }

  // build the map data
  async function buildMap() {
    const [rows, kmlGeo] = await Promise.allSettled([loadCSV(), loadKML()]);

    if (rows.status !== 'fulfilled') {
      alert("Error loading CSV: " + rows.reason);
      return;
    }
    const csvRows = rows.value;

    // Compute total distance and station count per route
    const routeStats = {};
    csvRows.forEach(row => {
    const rn = (row.Route || "Unknown").toString();
    const dist = parseFloat(row["Route Distance (KM)"]) || 0;
    if (!routeStats[rn]) {
        routeStats[rn] = { total: 0, stations: 0 };
    }
    routeStats[rn].stations++;
    if (dist > routeStats[rn].total) {
        routeStats[rn].total = dist;
    }   
    });
      window.routeStats = routeStats;


    // build colors and groups
    buildRouteColors(csvRows);

    // create an empty group for each route
    const routeNames = Array.from(new Set(csvRows.map(r => (r.Route||'Unknown').toString())));
    routeNames.forEach(rn => {
      routeLayers[rn] = L.layerGroup(); // not added to map by default
    });

    // process KML geometry (could be many features). Group polylines by placemark name.
    const kmlRouteSegments = {}; // name -> [ [ [lat,lon], ... ], ... ]
    if (kmlGeo && kmlGeo.status === 'fulfilled' && kmlGeo.value) {
      try {
        kmlGeo.value.features.forEach(f => {
          const name = (f.properties && (f.properties.name || f.properties.Name || f.properties.title)) || 'Unknown';
          if (!kmlRouteSegments[name]) kmlRouteSegments[name] = [];
          // handle LineString and MultiLineString
          const geom = f.geometry;
          if (!geom) return;
          if (geom.type === 'LineString') {
            const seg = geom.coordinates.map(c => [c[1], c[0]]);
            kmlRouteSegments[name].push(seg);
          } else if (geom.type === 'MultiLineString') {
            geom.coordinates.forEach(ls => {
              const seg = ls.map(c => [c[1], c[0]]);
              kmlRouteSegments[name].push(seg);
            });
          } else if (geom.type === 'GeometryCollection' && geom.geometries) {
            geom.geometries.forEach(g => {
              if (g.type === 'LineString') {
                const seg = g.coordinates.map(c => [c[1], c[0]]);
                kmlRouteSegments[name].push(seg);
              }
            });
          }
        });
      } catch (e) {
        console.warn('Error processing KML:', e);
      }
    } else {
      console.warn("KML not loaded or empty; will only plot CSV station lines if needed.");
    }

    // add KML segments into route layers
    Object.keys(kmlRouteSegments).forEach(routeName => {
      const color = routeColors[routeName] || '#000';
      const lg = routeLayers[routeName] || L.layerGroup();
      kmlRouteSegments[routeName].forEach(seg => {
        const stats = routeStats[routeName] || { total: 0, stations: 0 };
        const tooltipHtml = `
        <div style="font-size:14px; font-weight:500;">
            <b>Route:</b> ${routeName}<br>
            <b>Total Distance:</b> ${stats.total} km<br>
            <b>Stations:</b> ${stats.stations}
        </div>
        `;
        L.polyline(seg, {
        color: color,
        weight: 5,
        opacity: 0.9
        }).bindTooltip(tooltipHtml, {className:'custom-tooltip', sticky:true})
        .addTo(lg);

      });
      routeLayers[routeName] = lg;
    });

    // If route exist in CSV but not in KML, we still keep layerGroup empty — markers will be added below.
    // Now add station markers from CSV
    csvRows.forEach((row, idx) => {
      const lat = parseFloat(row.Latitude || row.lat || row.Lat);
      const lon = parseFloat(row.Longitude || row.lon || row.Lon);
      if (!isFinite(lat) || !isFinite(lon)) return;

      const routeName = (row.Route||'Unknown').toString();
      const color = routeColors[routeName] || '#333';

      // marker icon (simple circle marker)
      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        color: '#000',
        weight: 1,
        fillColor: color,
        fillOpacity: 0.95
      });

      // tooltip (hover) with station name, town and next station distance
      const stationName = row.Station || row['Station Name'] || '';
      const town = row['Town Name'] || row.Town || row.TownName || '';
      const nextDist = (row.NextDist_km !== undefined && row.NextDist_km !== null) ? row.NextDist_km : (row.NextDist || 'N/A');
      const elevation = row.Elevation_m || row['Elevation_m'] || row['Elevation (m)'] || 'N/A';


      marker.bindTooltip(
        `<div style="font-size:14px;">
          <b>${escapeHtml(stationName)}</b><br>
          Town: ${escapeHtml(town || 'Unknown')}<br>
          Elevation: ${escapeHtml(String(elevation))} m<br>
          Next: ${escapeHtml(String(nextDist))} km
        </div>`,
        { className:'custom-tooltip', sticky:true }
      );

      // popup with richer info and links & optional logo
      const osm = osmLink(lat, lon);
      const gmap = googleLink(lat, lon);
      const logo = row.Logo_URL || row['Logo_URL'] || row.logo || null; // if you have a column
      const stationSeq = (row['StationSeq'] || row['Seq'] || '');
      const routeDist = row['Route Distance (KM)'] || row['RouteDistanceKM'] || row['Route_Distance_KM'] || '';

      let popupHtml = `<div style="font-size:14px;">`;
      if (logo) {
        popupHtml += `<div style="margin-bottom:6px;"><img src="${escapeHtml(logo)}" alt="logo" style="height:38px; object-fit:contain;"></div>`;
      }
      popupHtml += `<b>Station:</b> ${escapeHtml(stationName)} ${stationSeq?`(#${escapeHtml(stationSeq)})`:''}<br>`;
      popupHtml += `<b>Route:</b> ${escapeHtml(routeName)}<br>`;
      popupHtml += `<b>Town:</b> ${escapeHtml(town || 'Unknown')}<br>`;
      popupHtml += `<b>Elevation:</b> ${escapeHtml(String(elevation))} m<br>`;
      popupHtml += `<b>Route Distance (KM):</b> ${escapeHtml(String(routeDist || 'N/A'))}<br>`;
      popupHtml += `<b>PrevDist (km):</b> ${escapeHtml(String(row.PrevDist_km || row.PrevDist || 'N/A'))}<br>`;
      popupHtml += `<b>NextDist (km):</b> ${escapeHtml(String(nextDist || 'N/A'))}<br>`;
      popupHtml += `<a href="${osm}" target="_blank">OpenStreetMap</a> | <a href="${gmap}" target="_blank">Google Maps</a>`;
      popupHtml += `</div>`;

      marker.bindPopup(popupHtml, {maxWidth:320});

      // add to the route layer group
      if (!routeLayers[routeName]) routeLayers[routeName] = L.layerGroup();
      marker.addTo(routeLayers[routeName]);
    });

    // Build legend UI entries
    createLegendEntries(Object.keys(routeLayers));

    // Option: auto-check some routes by default (none checked so user toggles)
    // setAllRoutes(true); // uncomment to show all by default

    // center / fit bounds of Ethiopia + Djibouti
    map.fitBounds([BOUNDS_SW, BOUNDS_NE], {padding:[20,20]});
  } // end buildMap

  // helper escape HTML
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // hook up legend UI actions
  document.getElementById('legend-toggle').addEventListener('click', () => {
    const root = document.getElementById('custom-legend');
    if (root.classList.contains('collapsed')) {
      root.classList.remove('collapsed'); root.classList.add('expanded');
      document.getElementById('legend-toggle').textContent = '✖';
    } else {
      root.classList.remove('expanded'); root.classList.add('collapsed');
      document.getElementById('legend-toggle').textContent = '☰';
    }
  });

  document.getElementById('check-all').addEventListener('click', () => setAllRoutes(true));
  document.getElementById('uncheck-all').addEventListener('click', () => setAllRoutes(false));

  // live-filtering legend
  document.getElementById('legend-filter').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#legend-list .legend-item').forEach(it => {
      const name = it.querySelector('.legend-name').textContent.toLowerCase();
      it.style.display = name.includes(q) ? '' : 'none';
    });
  });

  // Start
  buildMap().catch(err => {
    console.error(err);
    alert("Error building the map. See console for details.");
  });