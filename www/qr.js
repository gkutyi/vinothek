const DB_NAME = "vinothekDB";
const DB_VERSION = 6;
const SERVER_URL = "http://10.0.0.30:5000";
const API_URL = `${SERVER_URL}/api/weine`;
const isMobileApp = window.location.protocol === "capacitor:";

let db;

const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onsuccess = (e) => {
    db = e.target.result;
    loadQRCodes();
};

request.onerror = (e) => {
    console.error("QR DB Fehler", e);
};

function loadQRCodes() {
    if (isMobileApp) {
        loadQRCodesFromDB();
    } else {
        loadQRCodesFromServer();
    }
}

function loadQRCodesFromDB() {
    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    const lagerMap = {};

    store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;

        if (cursor) {
            addWineToMap(cursor.value, lagerMap);
            cursor.continue();
        } else {
            renderQRCodes(lagerMap);
        }
    };
}

async function loadQRCodesFromServer() {
    try {
        const res = await fetch(API_URL);
        const wines = await res.json();

        const lagerMap = {};

        wines.forEach(wine => {
            addWineToMap(wine, lagerMap);
        });

        renderQRCodes(lagerMap);

    } catch (err) {
        console.error("QR Load Server Fehler:", err);
    }
}

function addWineToMap(wine, lagerMap) {
    const lagerort = wine.lagerort || "Unbekannt";
    const platz = wine.platz || "Ohne Platz";

    if (!lagerMap[lagerort]) lagerMap[lagerort] = {};
    if (!lagerMap[lagerort][platz]) lagerMap[lagerort][platz] = [];

    lagerMap[lagerort][platz].push(wine);
}

function renderQRCodes(lagerMap) {
    const container = document.getElementById("qrContainer");
    container.innerHTML = "";

    Object.keys(lagerMap)
        .sort()
        .forEach((lagerort) => {
            const block = document.createElement("div");
            block.className = "lager-block";

            const gridId = `grid-${lagerort.replace(/\s+/g, "_")}`;

            block.innerHTML = `
                <div class="lager-title">� ${lagerort}</div>
                <div class="platz-grid" id="${gridId}"></div>
            `;

            container.appendChild(block);

            const grid = document.getElementById(gridId);

            Object.keys(lagerMap[lagerort])
                .sort((a, b) =>
                    a.localeCompare(b, undefined, { numeric: true })
                )
                .forEach((platz) => {
                    const wines = lagerMap[lagerort][platz];

                    const card = document.createElement("div");
                    card.className = "platz-card";

                    const qrDiv = document.createElement("div");
                    card.appendChild(qrDiv);

                    const nameDiv = document.createElement("div");
                    nameDiv.className = "platz-name";
                    nameDiv.innerText = platz;

                    const countDiv = document.createElement("div");
                    countDiv.className = "wein-count";
                    countDiv.innerText = `${wines.length} Wein(e)`;

                    card.appendChild(nameDiv);
                    card.appendChild(countDiv);

                    card.onclick = () => {
                        window.location.href =
                            `index.html?lagerort=${encodeURIComponent(lagerort)}` +
                            `&platz=${encodeURIComponent(platz)}`;
                    };

                    grid.appendChild(card);

                    new QRCode(qrDiv, {
                        text:
                            `${window.location.origin}/index.html?lagerort=` +
                            `${encodeURIComponent(lagerort)}` +
                            `&platz=${encodeURIComponent(platz)}`,
                        width: 120,
                        height: 120
                    });
                });
        });
}

function goBack() {
    window.history.back();
}

function doPrint() {
    if (window.Capacitor) {
        // iOS workaround: Safari öffnen
        window.location.href = window.location.href;
        setTimeout(() => window.print(), 500);
    } else {
        window.print();
    }
}
