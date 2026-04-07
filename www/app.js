let db;
let isLoadingTable = false;
let qrScanner = null;
let currentWineImageFront = "";
let currentWineImageBack = "";
let currentScanSide = "";
let currentSortField = "";
let sortAsc = true;
let wineCache = [];
let selectedImageType = null;
// Beispiel:
let wineImages = { front: null, back: null };
let wineAnalysis = {}; // KI-Ergebnisse
let suppressSync = false; // kurze Pause nach Save
let currentEditId = null;

const DB_NAME = "vinothekDB";
const DB_VERSION = 6;
const SERVER_URL = "http://10.0.0.30:5000";
const API_URL = `${SERVER_URL}/api/weine`;


// --------------------
// DB START
// --------------------
const request = indexedDB.open(DB_NAME, DB_VERSION);

request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("weine")) {
        db.createObjectStore("weine", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("syncQueue")) {
        db.createObjectStore("syncQueue", { keyPath: "queueId", autoIncrement: true });
    }
    if (!db.objectStoreNames.contains("deletedWeine")) {
        db.createObjectStore("deletedWeine", { keyPath: "id" });
    }
};

request.onsuccess = e => {
    db = e.target.result;
    console.log("DB bereit");
    processQueue();
    syncFromServer();
    setTimeout(() => loadWineFromQR(), 500);
    setInterval(() => {
        processQueue();
        syncFromServer();
    }, 10000);
};

request.onerror = e => {
    console.error("DB Fehler", e);
};

// --------------------
// QUEUE
// --------------------
function addToQueue(type, data) {
    if (!db) return;
    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    const itemId = type === "save" ? data.id : data;

    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
            const item = cursor.value;
            const queuedId = item.type === "save" ? item.data.id : item.data;
            if (queuedId === itemId) cursor.delete();
            cursor.continue();
            return;
        }
        store.add({ type, data, entityId: itemId, createdAt: Date.now() });
        console.log("QUEUE gespeichert:", type, itemId);
    };
}

function processQueue() {
    if (!db) return;

    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");

    store.openCursor().onsuccess = async e => {
        const cursor = e.target.result;
        if (!cursor) return;

        const item = cursor.value;
        const queueId = item.queueId;

        let request;

        if (item.type === "save") {
            const formData = new FormData();
            formData.append("wine", JSON.stringify(item.data.wineData));

            // Bilder wieder als File erzeugen
            if (item.data.images.front) {
                formData.append(
                    "bildFront",
                    dataURLtoFile(item.data.images.front, "front.jpg")
                );
            }
            if (item.data.images.back) {
                formData.append(
                    "bildBack",
                    dataURLtoFile(item.data.images.back, "back.jpg")
                );
            }

            request = fetch(API_URL, { method: "POST", body: formData });
        } else if (item.type === "delete") {
            request = fetch(`${API_URL}/${item.data}`, { method: "DELETE" });
        }

        if (!request) {
            cursor.continue();
            return;
        }

        request
            .then(async (res) => {
                let data;
                try {
                    // Versuch JSON zu parsen, falls Body leer ist, fallback auf {}
                    data = res.status !== 204 ? await res.json() : {};
                } catch {
                    data = {};
                }

                console.log("QUEUE SERVER OK:", data);

                const delTx = db.transaction("syncQueue", "readwrite");
                delTx.objectStore("syncQueue").delete(queueId);

                console.log("QUEUE entfernt", queueId);
            })
            .catch((err) => {
                console.error("QUEUE Fehler:", err);
            });

        cursor.continue();
    };
}

// --------------------
// LAGERPLATZ
// --------------------
function setStorageLocation() {
    const lager = document.getElementById("global_lagerort").value;
    const platz = document.getElementById("global_platz").value;
    document.getElementById("currentLocation").innerText = `${lager} / ${platz}`;
}

// --------------------
// SPEICHERN
// --------------------
// Wein speichern (aktuell vorhandene Logik)
async function saveWine() {
    if (!db) {
        alert("Datenbank noch nicht bereit");
        return;
    }

    // --- Formular auslesen ---
    const wine = {};
    document.querySelectorAll("#wineForm input, #wineForm textarea")
        .forEach(el => wine[el.id] = el.value);

    // --- ID und Zeitstempel ---
    wine.id = currentEditId || Date.now();
    wine.createdAt = currentEditId ? wine.createdAt : Date.now();
    wine.updatedAt = Date.now();

    wine.lagerort = document.getElementById("global_lagerort").value;
    wine.platz = document.getElementById("global_platz").value;

    // --- Bilder aus wineImages übernehmen ---
    if (typeof wineImages.front === "string") wine.bildFront = wineImages.front;
    if (typeof wineImages.back === "string") wine.bildBack = wineImages.back;

    // --- lokal speichern ---
    const tx = db.transaction("weine", "readwrite");
    tx.objectStore("weine").put(wine);

    tx.oncomplete = async () => {
        // Tabelle aktualisieren
        loadWeine();

        // --- Base64 vorbereiten ---
        let frontBase64 = null;
        let backBase64 = null;
        if (wineImages.front && wineImages.front instanceof File)
            frontBase64 = await fileToBase64(wineImages.front);
        if (wineImages.back && wineImages.back instanceof File)
            backBase64 = await fileToBase64(wineImages.back);

        // --- Queue füllen ---
        addToQueue("save", {
            wineData: wine,
            images: { front: frontBase64, back: backBase64 }
        });

        // --- Formular leeren ---
        clearWineForm();

        // --- Sync kurz pausieren ---
        suppressSync = true;
        setTimeout(() => { suppressSync = false; }, 2000);
    };

    tx.onerror = e => console.error("IndexedDB Error beim Speichern:", e);
}

// --------------------
// FORMULAR LEEREN
// --------------------
function clearWineForm() {
    document.querySelectorAll("#wineForm input, #wineForm textarea").forEach(el => el.value = "");
    wineImages.front = null;
    wineImages.back = null;
    currentEditId = null;

    // Vorschaubilder zurücksetzen
    const imgFront = document.getElementById("imagePreview_front");
    const imgBack = document.getElementById("imagePreview_back");
    if (imgFront) imgFront.src = "";
    if (imgBack) imgBack.src = "";
}



async function initWeineFromServer() {
    if (!db) return;

    const response = await fetch(API_URL);
    const wines = await response.json();

    const tx = db.transaction("weine", "readwrite");
    const store = tx.objectStore("weine");

    wines.forEach(wine => store.put(wine));

    tx.oncomplete = () => loadWeine();
}

// Hilfsfunktion: File -> Base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = err => reject(err);
        reader.readAsDataURL(file);
    });
}

// --------------------
// LADEN
// --------------------
async function loadWeine() {
    if (!db || isLoadingTable) return;
    isLoadingTable = true;

    const tbody = document.querySelector("#weinTable tbody");
    if (!tbody) {
        isLoadingTable = false;
        return;
    }

    const wines = [];

    // 1️⃣ IndexedDB laden
    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");
    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
            wines.push(cursor.value);
            cursor.continue();
        } else {
            wineCache = wines;

            // Tabelle zuerst mit local IndexedDB-Daten rendern
            if (currentSortField) applySort();
            else renderWineTable(wines);

            // 2️⃣ Server-Daten nachladen und Mergen
            fetch(API_URL)
                .then(res => res.json())
                .then(serverData => {
                    if (Array.isArray(serverData)) {
                        // Merge Serverdaten in IndexedDB-Daten (falls neue Einträge vorhanden)
                        serverData.forEach(sWine => {
                            if (!wines.some(w => w.id === sWine.id)) {
                                wines.push(sWine);
                                const txAdd = db.transaction("weine", "readwrite");
                                txAdd.objectStore("weine").put(sWine);
                            }
                        });
                        // Tabelle neu rendern
                        if (currentSortField) applySort();
                        else renderWineTable(wines);
                    }
                    isLoadingTable = false;
                })
                .catch(err => {
                    console.error("Fehler beim Laden von Serverdaten:", err);
                    isLoadingTable = false;
                });
        }
    };

    tx.onerror = () => {
        console.error("Fehler beim Laden von IndexedDB");
        isLoadingTable = false;
    };
}

function loadWineFromQR() {
    const params = new URLSearchParams(window.location.search);

    const lagerort = params.get("lagerort");
    const platz = params.get("platz");

    if (!lagerort || !platz || !db) return;

    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;

        if (cursor) {
            const wine = cursor.value;

            if (
                wine.lagerort === lagerort &&
                wine.platz === platz
            ) {
                loadWineIntoForm(wine);
                return;
            }

            cursor.continue();
        }
    };
}

// --------------------
// FORMULAR BEFÜLLEN
// --------------------
function loadWineIntoForm(wine) {
    document.querySelectorAll("#wineForm input, #wineForm textarea")
        .forEach(el => {
            if (wine[el.id] !== undefined) el.value = wine[el.id];
        });

    document.getElementById("global_lagerort").value = wine.lagerort || "";
    document.getElementById("global_platz").value = wine.platz || "";

    currentEditId = wine.id;

    // Bilder übernehmen
    wineImages.front = wine.bildFront || null;
    wineImages.back = wine.bildBack || null;

    const imgFront = document.getElementById("imagePreview_front");
    const imgBack = document.getElementById("imagePreview_back");
    if (imgFront) imgFront.src = wine.bildFront || "";
    if (imgBack) imgBack.src = wine.bildBack || "";
}

// --------------------
// LÖSCHEN
// --------------------
function deleteWine(id) {
    if (!db) return;
    const tx = db.transaction("weine", "readwrite");
    tx.objectStore("weine").delete(id);
    addToQueue("delete", id);
    tx.oncomplete = () => { loadWeine(); deleteWineOnServer(id); };
}

// --------------------
// SERVER SYNC
// --------------------
function syncWineToServer(wine) {
    console.log("WINE SAVE OBJECT:", wine);
    console.log("JSON STRING:", JSON.stringify(wine));
    fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wine) })
        .then(() => console.log("SYNC OK"))
        .catch(() => { addToQueue("save", wine); });
}

function deleteWineOnServer(id) {
    fetch(`${API_URL}/${id}`, { method: "DELETE" })
        .then(() => console.log("DELETE OK"))
        .catch(() => { addToQueue("delete", id); });
}

function syncFromServer() {
    if (suppressSync) return; // kurz pausieren

    fetch(API_URL)
        .then(r => r.json())
        .then(serverData => {
            const tx = db.transaction("weine", "readwrite");
            const store = tx.objectStore("weine");

            serverData.forEach(w => store.put(w));

            tx.oncomplete = () => loadWeine();
        })
        .catch(err => console.log("kein Server erreichbar", err));
}


// --------------------
// EXPORT/IMPORT
// --------------------
function exportBackup() {
    const wines = [];
    const tx = db.transaction("weine", "readonly");
    tx.objectStore("weine").openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { wines.push(cursor.value); cursor.continue(); }
        else {
            const blob = new Blob([JSON.stringify(wines, null, 2)], { type: "application/json" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "backup.json";
            a.click();
        }
    };
}

function importBackup() {
    const file = document.getElementById("importFile").files[0];
    if (!file) { alert("Datei wählen"); return; }
    const reader = new FileReader();
    reader.onload = e => {
        const data = JSON.parse(e.target.result);
        const tx = db.transaction("weine", "readwrite");
        data.forEach(w => { tx.objectStore("weine").put(w); syncWineToServer(w); });
        tx.oncomplete = () => loadWeine();
    };
    reader.readAsText(file);
}

// --------------------
// EDIT/LOAD FORM
// --------------------
function editWine(id) {
    if (!db) return;

    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    const req = store.get(id);

    req.onsuccess = e => {
        const w = e.target.result;
        if (!w) return;

        document.getElementById("name").value = w.name || "";
        document.getElementById("jahrgang").value = w.jahrgang || "";
        document.getElementById("region").value = w.region || "";
        document.getElementById("winzer").value = w.winzer || "";
        document.getElementById("alkohol").value = w.alkohol || "";
        document.getElementById("anzahl").value = w.anzahl || 1;
        document.getElementById("notizen").value = w.notizen || "";
        document.getElementById("rating").value = w.rating || "";
        document.getElementById("preis").value = w.preis || "";
        document.getElementById("trinkVon").value = w.trinkfensterVon || "";
        document.getElementById("trinkBis").value = w.trinkfensterBis || "";
        document.getElementById("quelle").value = w.bewertungsQuelle || "";

        // WICHTIG
        document.getElementById("global_lagerort").value = w.lagerort || "Vinothek";
        document.getElementById("global_platz").value = w.platz || "";

        currentWineImageFront = w.bild || "";
        currentWineImageBack = w.bildRueck || "";

        window.currentEditId = w.id;
    };
}


// --------------------
// SORT & RENDER
// --------------------
function sortTable(field) {
    if (currentSortField === field) sortAsc = !sortAsc;
    else { currentSortField = field; sortAsc = true; }
    applySort();
}

function applySort() {
    const sorted = [...wineCache].sort((a,b)=>{
        let valA = a[currentSortField]||"";
        let valB = b[currentSortField]||"";
        if(["jahrgang","anzahl","rating","preis"].includes(currentSortField)){
            valA=parseFloat(valA)||0; valB=parseFloat(valB)||0;
        } else { valA=valA.toString().toLowerCase(); valB=valB.toString().toLowerCase(); }
        if(valA<valB) return sortAsc?-1:1; if(valA>valB) return sortAsc?1:-1; return 0;
    });
    renderWineTable(sorted);
}

function renderWineTable(wines) {
    const tbody=document.querySelector("#weinTable tbody"); tbody.innerHTML="";
    wines.forEach(w=>{
        const row=document.createElement("tr");
        row.innerHTML=`<td>${w.name||""}</td>
        <td>${w.jahrgang||""}</td>
        <td>${w.winzer||""}</td>
        <td>${w.region||""}</td>
        <td>${w.alkohol||""}</td>
        <td>${w.lagerort||""} / ${w.platz||""}</td>
        <td>${w.anzahl||1}</td>
        <td>${w.notizen||""}</td>
        <td>
            ${w.bildFront
                ? `<img src="${SERVER_URL}${w.bildFront}" width="40" 
                     style="cursor:pointer;"
                     onclick="showImageFull('${SERVER_URL}${w.bildFront}')">`
                : ""}
            ${w.bildBack
                ? `<img src="${SERVER_URL}${w.bildBack}" width="40"
                     style="cursor:pointer;"
                     onclick="showImageFull('${SERVER_URL}${w.bildBack}')">`
                : ""}
        </td>
        <td>${w.bewertungsQuelle||""}</td>
        <td>${w.rating||""}</td>
        <td>${w.preis?w.preis+" €":""}</td>
        <td>${w.trinkfensterVon||""}${w.trinkfensterBis? " - "+w.trinkfensterBis:""}</td>
        <td>
            <button onclick="editWine(${w.id})">✏️</button>
            <button onclick="enrichWineFromTable(${w.id})">Online</button>
            <button onclick="deleteWine(${w.id})">&#128465;</button>
        </td>`;
        tbody.appendChild(row);
    });
}


// --------------------
// IMAGE MODAL
// --------------------
function showImageFull(src){document.getElementById("imageModal").style.display="flex"; document.getElementById("modalImage").src=src;}
function closeImageModal(){document.getElementById("imageModal").style.display="none";}

// Bild auswählen (Front oder Back)
function selectImage(type) {
    const inputId = type === "front" ? "labelPhotoFront" : "labelPhotoBack";
    const input = document.getElementById(inputId);
    if (!input) {
        alert("Fehler: Datei-Input nicht gefunden!");
        return;
    }
    input.click();
}

// Wird aufgerufen, wenn ein Bild ausgewählt wurde


function loadWineImage(input, type) {
    const file = input.files[0];
    if (!file) return;

    wineImages[type] = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        const imgPreview = document.getElementById("imagePreview_" + type);
        if (imgPreview) imgPreview.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --------------------
// IMAGE RESIZE HILFSFUNKTION (Promise-basiert)
// --------------------
function resizeImage(file, maxWidth, maxHeight, quality = 0.5) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
                if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                canvas.getContext("2d").drawImage(img, 0, 0, width, height);

                const compressedDataURL = canvas.toDataURL("image/jpeg", quality);
                resolve(compressedDataURL);
            };
            img.onerror = err => reject(err);
            img.src = e.target.result;
        };
        reader.onerror = err => reject(err);
        reader.readAsDataURL(file);
    });
}

// --------------------
// KI ANALYSE
// --------------------

// KI-Analyse für Front- und Back-Bild
async function analyzeWineWithAI() {
    const types = ["front", "back"];
    let mergedAnalysis = {};

    for (let type of types) {
        const file = wineImages[type];  // wineImages = { front: File, back: File }
        if (!file) continue;

        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch("http://10.0.0.30:5000/api/analyze-label-ai", {
                method: "POST",
                body: formData
            });

            const data = await response.json();

            if (response.ok) {
                // KI-Ergebnisse zusammenführen
                for (let key in data) {
                    // Front überschreibt Back nur, wenn Wert leer ist
                    if (!mergedAnalysis[key] || mergedAnalysis[key] === "") {
                        mergedAnalysis[key] = data[key];
                    }
                }
            } else {
                console.error("KI-Analyse Fehler:", data.error);
                alert("Fehler bei KI-Analyse: " + JSON.stringify(data.error));
            }
        } catch (err) {
            console.error("Fetch Fehler:", err);
            alert("Fehler beim Senden der Datei an den Server");
        }
    }

    // Ergebnisse ins Formular eintragen
    for (let key in mergedAnalysis) {
        const input = document.getElementById(key);
        if (input) input.value = mergedAnalysis[key];
    }

    // Optional: in globales Objekt für weiteren Zugriff speichern
    wineAnalysis = mergedAnalysis;

    alert("KI-Analyse abgeschlossen und Formular befüllt!");
}

// --------------------
// HILFSFUNKTION: DATAURL -> FILE
// --------------------
function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
}

// --------------------
// QR-Codes
// --------------------
function openQRPage() {
    window.location.href = "qr.html";
}

function loadWineByLocation(lagerort, platz) {
    if (!db) return;

    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;

        if (!cursor) {
            alert("Kein Wein auf diesem Platz");
            return;
        }

        const wine = cursor.value;

        if (
            wine.lagerort === lagerort &&
            wine.platz === platz
        ) {
            loadWineIntoForm(wine);
            return;
        }

        cursor.continue();
    };
}

function startQRScan() {
    const readerDiv = document.getElementById("qr-reader");

    if (!readerDiv) {
        alert("QR Container nicht gefunden");
        return;
    }

    readerDiv.style.display = "block";

    qrScanner = new Html5Qrcode("qr-reader");

    Html5Qrcode.getCameras()
        .then(devices => {
            if (!devices || !devices.length) {
                alert("Keine Kamera gefunden");
                return;
            }

            const backCam =
                devices.find(d =>
                    d.label &&
                    d.label.toLowerCase().includes("back")
                ) || devices[0];

            qrScanner.start(
                backCam.id,
                {
                    fps: 10,
                    qrbox: 250
                },
                qrCodeMessage => {
                    console.log("QR erkannt:", qrCodeMessage);

                    qrScanner.stop().then(() => {
                        qrScanner.clear();
                        readerDiv.style.display = "none";

                        const url = new URL(qrCodeMessage);
                        const lagerort = url.searchParams.get("lagerort");
                        const platz = url.searchParams.get("platz");

                        if (!lagerort || !platz) {
                            alert("QR-Code enthält keine Lagerdaten");
                            return;
                        }

                        loadWineByLocation(lagerort, platz);
                    });
                },
                () => {}
            );
        })
        .catch(err => {
            alert("Kamera nicht verfügbar: " + err);
            console.error(err);
        });
}

function openWineFromQRText(qrText) {
    try {
        const url = new URL(qrText);

        const lagerort = url.searchParams.get("lagerort");
        const platz = url.searchParams.get("platz");

        if (!lagerort || !platz) {
            alert("QR-Code ungültig");
            return;
        }

        document.getElementById("global_lagerort").value = lagerort;
        document.getElementById("global_platz").value = platz;

        loadWineByLocation(lagerort, platz);

    } catch (err) {
        alert("QR-Code konnte nicht gelesen werden");
        console.error(err);
    }
}

function openWineFromQRText(qrText) {
    try {
        const url = new URL(qrText);

        const lagerort = url.searchParams.get("lagerort");
        const platz = url.searchParams.get("platz");

        if (!lagerort || !platz) {
            alert("QR-Code ungültig");
            return;
        }

        document.getElementById("global_lagerort").value = lagerort;
        document.getElementById("global_platz").value = platz;

        loadWineFromQR();

    } catch (err) {
        alert("QR-Code konnte nicht gelesen werden");
        console.error(err);
    }
}

function loadWineByLocation(lagerort, platz) {
    if (!db) {
        alert("Datenbank nicht bereit");
        return;
    }

    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;

        if (cursor) {
            const wine = cursor.value;

            if (
                wine.lagerort === lagerort &&
                wine.platz === platz
            ) {
                loadWineIntoForm(wine);
                return;
            }

            cursor.continue();
        } else {
            alert("Kein Datensatz für diesen Lagerplatz gefunden");
        }
    };
}

// --------------------
// QR-SCAN (Beispiel)
// --------------------
function handleQRScanResult(qrUrl) {
    const params = new URLSearchParams(new URL(qrUrl).search);
    const lagerort = params.get("lagerort");
    const platz = params.get("platz");

    if (!lagerort || !platz) return;

    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) return;

        const wine = cursor.value;
        if (wine.lagerort === lagerort && wine.platz === platz) {
            loadWineIntoForm(wine);
            return;
        }
        cursor.continue();
    };
}