let db;
let isLoadingTable = false;
let currentWineImageFront = null;
let currentWineImageBack = null;
let currentScanSide = "";
let currentSortField = "";
let sortAsc = true;
let wineCache = [];

const DB_NAME = "vinothekDB";
const DB_VERSION = 6;
const API_URL = "http://10.0.0.30:5000/api/weine";

console.log("app.js geladen");

// --------------------
// DB INIT
// --------------------
const request = indexedDB.open(DB_NAME, DB_VERSION);
request.onupgradeneeded = e => {
    db = e.target.result;

    if (!db.objectStoreNames.contains("weine")) db.createObjectStore("weine", { keyPath: "id" });
    if (!db.objectStoreNames.contains("syncQueue")) db.createObjectStore("syncQueue", { keyPath: "queueId", autoIncrement: true });
    if (!db.objectStoreNames.contains("deletedWeine")) db.createObjectStore("deletedWeine", { keyPath: "id" });
};
request.onsuccess = e => {
    db = e.target.result;
    console.log("DB bereit");
    processQueue();
    syncFromServer();
    setInterval(() => { console.log("setInterval tick"); processQueue(); syncFromServer(); }, 10000);
};
request.onerror = e => console.error("DB Fehler", e);

// --------------------
// QUEUE
// --------------------
// --------------------
// QUEUE + SYNC
// --------------------
function addToQueue(type, data) {
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    const itemId = type === "save" ? data.id : (typeof data === "object" ? data.id : data);

    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
            const item = cursor.value;
            const queuedId = item.type === "save" ? item.data.id : item.data;
            if (queuedId === itemId) cursor.delete();
            cursor.continue();
            return;
        }

        // Speichern: delete nur mit ID
        store.add({
            type,
            data: type === "delete" ? itemId : data,
            entityId: itemId,
            createdAt: Date.now()
        });
    };
}

function processQueue() {
    console.log("processQueue gestartet");

    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");

    store.openCursor().onsuccess = async e => {
        const cursor = e.target.result;

        if (!cursor) {
            console.log("Queue leer");
            return;
        }

        const item = cursor.value;

        console.log("QUEUE ITEM:", item);
        console.log("TYPE:", item.type);
        console.log("DATA:", item.data);

        try {
            if (item.type === "save") {
                console.log("POST:", API_URL);

                await fetch(API_URL, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(item.data)
                });

            } else if (item.type === "delete") {
                console.log("DELETE URL:", `${API_URL}/${item.data}`);

                await fetch(`${API_URL}/${item.data}`, {
                    method: "DELETE"
                });
            }

            db.transaction("syncQueue", "readwrite")
              .objectStore("syncQueue")
              .delete(item.queueId);

        } catch (err) {
            console.error("Queue Fehler:", err);
        }

        cursor.continue();
    };
}

// --------------------
// LAGERORT
// --------------------
function setStorageLocation() {
    const lager = document.getElementById("global_lagerort").value;
    const platz = document.getElementById("global_platz").value;
    document.getElementById("currentLocation").innerText = `� ${lager} / ${platz}`;
}

// --------------------
// SPEICHERN
// --------------------
function saveWine() {
    if (!db) { alert("Datenbank nicht bereit"); return; }

    const wine = {
        id: window.currentEditId || Date.now(),
        name: document.getElementById("name").value,
        jahrgang: document.getElementById("jahrgang").value,
        region: document.getElementById("region").value,
        winzer: document.getElementById("winzer").value,
        alkohol: document.getElementById("alkohol").value,
        lagerort: document.getElementById("global_lagerort").value,
        platz: document.getElementById("global_platz").value,
        anzahl: parseInt(document.getElementById("anzahl").value) || 1,
        notizen: document.getElementById("notizen").value,
        rating: document.getElementById("rating").value,
        preis: document.getElementById("preis").value,
        trinkfensterVon: document.getElementById("trinkVon").value,
        trinkFensterBis: document.getElementById("trinkBis").value,
        bewertungsQuelle: document.getElementById("quelle").value,
        bild: currentWineImageFront || "",
        bildRueck: currentWineImageBack || ""
    };

    if (!wine.lagerort) { alert("Lagerort erforderlich"); return; }

    const tx = db.transaction("weine", "readwrite");
    tx.objectStore("weine").put(wine);
    tx.oncomplete = () => {
        loadWeine();
        syncWineToServer(wine);
        currentWineImageFront = null;
        currentWineImageBack = null;
        window.currentEditId = null;
        document.getElementById("scanStatus").innerText = "";
        document.getElementById("previewFront").src = "";
        document.getElementById("previewBack").src = "";
    };
}

// --------------------
// LADEN
// --------------------
function loadWeine() {
    if (!db || isLoadingTable) return;
    isLoadingTable = true;

    const tbody = document.querySelector("#weinTable tbody");
    if (!tbody) { isLoadingTable = false; return; }

    const wines = [];
    const seenIds = new Set();

    db.transaction("weine", "readonly").objectStore("weine").openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
            const w = cursor.value;
            if (!seenIds.has(w.id)) { seenIds.add(w.id); wines.push(w); }
            cursor.continue();
        } else {
            wineCache = wines;
            currentSortField ? applySort() : renderWineTable(wines);
            isLoadingTable = false;
        }
    };
}

// --------------------
// DELETE
// --------------------
function deleteWine(id) {
    if (!db) return;
    db.transaction("weine", "readwrite").objectStore("weine").delete(id);
    addToQueue("delete", id); // NICHT das gesamte Objekt
    loadWeine();
}

// --------------------
// SYNC
// --------------------
function syncWineToServer(wine) {
    fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wine) })
        .then(() => console.log("SYNC OK"))
        .catch(err => { console.log("offline -> queue", err); addToQueue("save", wine); });
}

function syncFromServer() {
    console.log("syncFromServer jetzt gestartet");
    console.log("API_URL:", API_URL);
    fetch(API_URL)
        .then(r => r.json())
        .then(serverData => {
            console.log("Serverdaten:", serverData);

            const serverIds = serverData.map(w => w.id);
            const tx = db.transaction("weine", "readwrite");
            const store = tx.objectStore("weine");

            serverData.forEach(w => store.put(w));

            store.openCursor().onsuccess = e => {
                const cursor = e.target.result;
                if (cursor) {
                    const localWine = cursor.value;

                    if (!serverIds.includes(localWine.id)) {
                        store.delete(localWine.id);
                    }

                    cursor.continue();
                }
            };

            tx.oncomplete = () => {
                loadWeine();
            };
        })
        .catch(err => console.log("kein Server", err));
}

// --------------------
// EXPORT / IMPORT
// --------------------
function exportBackup() {
    db.transaction("weine", "readonly").objectStore("weine").getAll().onsuccess = e => {
        const blob = new Blob([JSON.stringify(e.target.result, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "backup.json"; a.click();
    };
}

function importBackup() {
    const file = document.getElementById("importFile").files[0];
    if (!file) { alert("Datei wählen"); return; }

    const reader = new FileReader();
    reader.onload = e => {
        const data = JSON.parse(e.target.result);
        const tx = db.transaction("weine", "readwrite");
        const store = tx.objectStore("weine");
        data.forEach(w => { store.put(w); syncWineToServer(w); });
        tx.oncomplete = () => loadWeine();
    };
    reader.readAsText(file);
}

// --------------------
// IMAGE UPLOAD & PREVIEW
// --------------------
async function handleLabelUpload(input, side) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = e => {
        const base64 = e.target.result;
        if (side === "front") {
            currentWineImageFront = base64;
            document.getElementById("previewFront").src = base64;
        } else {
            currentWineImageBack = base64;
            document.getElementById("previewBack").src = base64;
        }
    };
    reader.readAsDataURL(file);
}

// --------------------
// KI ANALYSE
// --------------------
async function analyzeWineWithAI() {
    const status = document.getElementById("scanStatus");

    if (!currentWineImageFront && !currentWineImageBack) { 
        alert("Bitte zuerst Etiketten fotografieren!");  
        return;  
    }

    status.innerText = "� KI Analyse läuft...";

    try {
        // --- Bilder in Base64 konvertieren ---
        let frontBase64 = null;
        let backBase64 = null;

        if (currentWineImageFront) {
            if (typeof currentWineImageFront === "string") {
                frontBase64 = currentWineImageFront; // schon Base64
            } else {
                frontBase64 = await fileToBase64(currentWineImageFront); // File → Base64
            }
        }

        if (currentWineImageBack) {
            if (typeof currentWineImageBack === "string") {
                backBase64 = currentWineImageBack; // schon Base64
            } else {
                backBase64 = await fileToBase64(currentWineImageBack); // File → Base64
            }
        }

        // --- Anfrage ans Backend ---
        const response = await fetch("http://10.0.0.30:5000/api/analyze-label-ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                front_image: frontBase64,
                back_image: backBase64
            })
        });

        const data = await response.json();
        console.log("� KI Analyse Antwort:", data);

        // --- Daten prüfen und Felder befüllen ---
        if (data) {
            mergeField("name", data.name);
            mergeField("jahrgang", data.jahrgang);
            mergeField("region", data.region);
            mergeField("winzer", data.winzer);
            mergeField("alkohol", data.alkohol);
            mergeField("notizen", data.notizen);
            mergeField("rating", data.rating);
            mergeField("preis", data.preis);
            mergeField("trinkVon", data.trinkfensterVon);
            mergeField("trinkBis", data.trinkfensterBis);

            status.innerText = "✅ KI Analyse abgeschlossen";
        } else {
            status.innerText = "⚠️ Keine Daten vom KI Backend erhalten";
        }

    } catch (err) {
        console.error("❌ KI Analyse fehlgeschlagen:", err);
        status.innerText = "❌ KI Analyse fehlgeschlagen";
    }
}

// --- Hilfsfunktion: File → Base64 ---
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = err => reject(err);
        reader.readAsDataURL(file);
    });
}

// --- Felder befüllen, immer wenn Wert vorhanden ---
function mergeField(id, value) {
    const f = document.getElementById(id);
    if (!f) return;
    if (value !== undefined && value !== null) f.value = value;
}

// --------------------
// SORTIERUNG
// --------------------
function applySort() { const sorted = [...wineCache].sort((a,b)=>{let valA=a[currentSortField]||"",valB=b[currentSortField]||""; if(["jahrgang","anzahl","rating","preis"].includes(currentSortField)){valA=parseFloat(valA)||0; valB=parseFloat(valB)||0;}else{valA=valA.toString().toLowerCase();valB=valB.toString().toLowerCase();} return sortAsc?(valA<valB?-1:valA>valB?1:0):(valA>valB?-1:valA<valB?1:0);}); renderWineTable(sorted);}

function renderWineTable(wines) {
    const tbody = document.querySelector("#weinTable tbody");
    tbody.innerHTML = "";

    wines.forEach(w => {
        const row = document.createElement("tr");

        // Standardfelder
        row.innerHTML = `
<td>${w.name||""}</td>
<td>${w.jahrgang||""}</td>
<td>${w.winzer||""}</td>
<td>${w.region||""}</td>
<td>${w.alkohol||""}</td>
<td>${w.lagerort||""} / ${w.platz||""}</td>
<td>${w.anzahl||1}</td>
<td>${w.notizen||""}</td>
<td class="imageCell"></td>
<td>${w.bewertungsQuelle||""}</td>
<td>${w.rating||""}</td>
<td>${w.preis||""}</td>
<td>${w.trinkfensterVon||""} ${w.trinkFensterBis ? `- ${w.trinkFensterBis}` : ""}</td>
<td>
    <button onclick="editWine(${w.id})">✏️</button>
    <button onclick="analyzeWineWithAI()">KI</button>
    <button onclick="deleteWine(${w.id})">�️</button>
</td>
`;

        tbody.appendChild(row);

        // Bilder sicher hinzufügen
        const imageCell = row.querySelector(".imageCell");
        if (w.bild) {
            const imgFront = document.createElement("img");
            imgFront.src = w.bild;
            imgFront.width = 40;
            imgFront.style.cursor = "pointer";
            imgFront.onclick = () => showImage(w.bild); // <-- Funktion verwenden
            imageCell.appendChild(imgFront);
        }

        if (w.bildRueck) {
            const imgBack = document.createElement("img");
            imgBack.src = w.bildRueck;
            imgBack.width = 40;
            imgBack.style.cursor = "pointer";
            imgBack.onclick = () => showImage(w.bildRueck);
            imageCell.appendChild(imgBack);
        }
    });
}

// Bildanzeige
function showImage(src) {
    consconsole.log("showImage:", typeof src, src);
    const w = window.open("", "_blank");
    w.document.write(`<img src="${src}" style="width:100%">`);
}

// --------------------
// FORM FILL EDIT
// --------------------
function editWine(id){
    db.transaction("weine","readonly").objectStore("weine").get(id).onsuccess=e=>{
        const w=e.target.result;
        if(!w)return;
        ["name","jahrgang","region","winzer","alkohol","anzahl","notizen","rating","preis","trinkVon","trinkBis","quelle","global_lagerort","global_platz"].forEach(f=>document.getElementById(f).value=w[f]||"");
        document.getElementById("previewFront").src=w.bild||"";
        document.getElementById("previewBack").src=w.bildRueck||"";
        currentWineImageFront=w.bild||null;
        currentWineImageBack=w.bildRueck||null;
        window.currentEditId=id;
    };
}
