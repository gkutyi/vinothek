// --------------------
// GLOBALS
// --------------------
let db;
let isLoadingTable = false;
let qrScanner = null;
let wineImages = { front: null, back: null };
let wineAnalysis = {};
let suppressSync = false;
let currentEditId = null;
let wineCache = [];
let currentSortField = "";
let sortAsc = true;

const DB_NAME = "vinothekDB";
const DB_VERSION = 6;
const SERVER_URL = "http://10.0.0.30:5000";
const API_URL = `${SERVER_URL}/api/weine`;
const isMobileApp = window.location.protocol === "capacitor:";

// --------------------
// DB START
// --------------------
if (isMobileApp) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = e => {
        db = e.target.result;
        if (!db.objectStoreNames.contains("weine")) db.createObjectStore("weine", { keyPath: "id" });
        if (!db.objectStoreNames.contains("syncQueue")) db.createObjectStore("syncQueue", { keyPath: "queueId", autoIncrement: true });
        if (!db.objectStoreNames.contains("deletedWeine")) db.createObjectStore("deletedWeine", { keyPath: "id" });
    };

    request.onsuccess = e => {
        db = e.target.result;
        console.log("IndexedDB bereit");

        processQueue();

        // ❌ NICHT mehr direkt syncFromServer hier
        // syncFromServer();

        setTimeout(() => loadWineFromQR(), 500);

        startGlobalSync(); // ✅ NEU: EINHEITLICHER SYNC LOOP
        
        // 🔥 FIX: initialer Sync für Mobile direkt nach DB-Start
        setTimeout(() => {
            if (isMobileApp && db) {
                syncFromServer();
            }
        }, 2000);
    };

    request.onerror = e => console.error("DB Fehler", e);
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
// SAVE WINE (Plattformabhängig)
// --------------------
async function saveWine() {
    console.log("SAVE START");
    console.log("currentEditId:", window.currentEditId);
    console.log("wineImages:", wineImages);

    // --- Lagerort prüfen ---
    const lagerort = document.getElementById("global_lagerort").value;
    if (!lagerort || lagerort.trim() === "") {
        alert("Bitte Lagerort angeben, bevor der Wein gespeichert wird!");
        return; // Speichern abbrechen
    }
    const platz = document.getElementById("global_platz").value || "";

    // --- Formular auslesen ---
    const wine = {};
    document.querySelectorAll("#wineForm input, #wineForm textarea")
        .forEach(el => wine[el.id] = el.value);

    // --- ID und Zeitstempel ---
    wine.id = window.currentEditId || Date.now();
    wine.createdAt = window.currentEditId ? wine.createdAt || Date.now() : Date.now();
    wine.updatedAt = Date.now();

    wine.lagerort = lagerort;
    wine.platz = platz;

    if (typeof wineImages.front === "string" || wineImages.front instanceof File)
        wine.bildFront = wineImages.front;
    if (typeof wineImages.back === "string" || wineImages.back instanceof File)
        wine.bildBack = wineImages.back;

    // --- Plattformabhängig speichern ---
    if (isMobileApp) {
        if (!db) { alert("Datenbank noch nicht bereit"); return; }

        const tx = db.transaction("weine", "readwrite");
        tx.objectStore("weine").put(wine);

        tx.oncomplete = async () => {
            loadWeine();
            let frontBase64 = wineImages.front instanceof File ? await fileToBase64(wineImages.front) : null;
            let backBase64 = wineImages.back instanceof File ? await fileToBase64(wineImages.back) : null;
            addToQueue("save", { wineData: wine, images: { front: frontBase64, back: backBase64 } });
            clearWineForm();
            suppressSync = true;
            setTimeout(() => { suppressSync = false; }, 2000);
        };
        tx.onerror = e => console.error("IndexedDB Error beim Speichern:", e);

    } else {
        // Browser: direkt Server
        const formData = new FormData();
        formData.append("wine", JSON.stringify(wine));
        if (wineImages.front instanceof File) formData.append("bildFront", wineImages.front);
        if (wineImages.back instanceof File) formData.append("bildBack", wineImages.back);

        fetch(API_URL, { method: "POST", body: formData })
            .then(() => { alert("Wein gespeichert"); clearWineForm(); loadWeine(); })
            .catch(err => console.error("Save Fehler Browser:", err));
    }
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
// LOAD WEINE (Plattformabhängig)
// --------------------
function loadWeine() {
    if (isMobileApp) loadWeineMobile();
    else loadWeineBrowser();
}

// Browser: direkt Server
async function loadWeineBrowser() {
    try {
        const res = await fetch(API_URL);
        const wines = await res.json();

        console.log("Browser geladen:", wines);

        wineCache = Array.isArray(wines) ? wines : [];
        renderWineTable(wineCache);

        // ❗ WICHTIG: Sort nur wenn wirklich Daten da sind
        if (wineCache.length === 0) {
            renderWineTable([]);
            return;
        }

        if (currentSortField && wineCache.length > 0) {
            applySort();
        } else {
            renderWineTable(wineCache);
        }

    } catch (err) {
        console.error("Fehler Browser-Laden:", err);
        alert("Serverdaten konnten nicht geladen werden");
    }
}

// Handy-App: IndexedDB + Server Merge
async function loadWeineMobile() {
    if (!db || isLoadingTable) return;
    isLoadingTable = true;

    const tbody = document.querySelector("#weinTable tbody");
    if (!tbody) { isLoadingTable = false; return; }

    const wines = [];
    const tx = db.transaction("weine", "readonly");
    tx.objectStore("weine").openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) { wines.push(cursor.value); cursor.continue(); }
        else {
            wineCache = wines;
            if (currentSortField) applySort(); else renderWineTable(wines);

            fetch(API_URL).then(r => r.json()).then(serverData => {
                if (Array.isArray(serverData)) {
                    serverData.forEach(sWine => {
                        if (!wines.some(w => w.id === sWine.id)) {
                            wines.push(sWine);
                            db.transaction("weine", "readwrite").objectStore("weine").put(sWine);
                        }
                    });
                    if (currentSortField) applySort(); else renderWineTable(wines);
                }
                isLoadingTable = false;
            }).catch(err => { console.error("Fehler Serverdaten:", err); isLoadingTable = false; });
        }
    };
    tx.onerror = () => { console.error("Fehler IndexedDB"); isLoadingTable = false; };
}

function loadWineFromQR() {
    const params = new URLSearchParams(window.location.search);

    const lagerort = params.get("lagerort");
    const platz = params.get("platz");

    if (!lagerort || !platz) return;

    // Browser: aus Cache
    if (!isMobileApp) {
        const wine = wineCache.find(w =>
            w.lagerort === lagerort &&
            w.platz === platz
        );

        if (wine) {
            loadWineIntoForm(wine);
        } else {
            console.log("Kein Wein im Browser gefunden");
        }
        return;
    }

    // Handy-App: IndexedDB
    if (!db) return;

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
            if (wine[el.id] !== undefined) {
                el.value = wine[el.id];
            }
        });

    // Spezialfelder
    document.getElementById("trinkVon").value =
        wine.trinkfensterVon || wine.trinkVon || "";

    document.getElementById("trinkBis").value =
        wine.trinkfensterBis || wine.trinkBis || "";

    document.getElementById("quelle").value =
        wine.bewertungsQuelle || wine.quelle || "";

    document.getElementById("global_lagerort").value =
        wine.lagerort || "";

    document.getElementById("global_platz").value =
        wine.platz || "";

    currentEditId = wine.id;
    window.currentEditId = wine.id;

    // Bilder
    wineImages.front = wine.bildFront || null;
    wineImages.back = wine.bildBack || null;

    const imgFront = document.getElementById("imagePreview_front");
    const imgBack = document.getElementById("imagePreview_back");

    if (imgFront) {
        imgFront.src = wine.bildFront
            ? SERVER_URL + wine.bildFront
            : "";
    }

    if (imgBack) {
        imgBack.src = wine.bildBack
            ? SERVER_URL + wine.bildBack
            : "";
    }

    console.log("FORM geladen:", wine);
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
    if (suppressSync) return;

    fetch(API_URL)
        .then(r => r.json())
        .then(serverData => {
            if (!db || !Array.isArray(serverData)) return;

            const tx = db.transaction("weine", "readwrite");
            const store = tx.objectStore("weine");

            serverData.forEach(wine => {
                store.put(wine);
            });

            tx.oncomplete = () => {
                wineCache = serverData;
                loadWeine(); // 🔥 UI REFRESH BEIDE PLATTFORMEN
            };
        })
        .catch(err => {
            console.log("Sync Fehler:", err);
        });
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
    console.log("EDIT gestartet mit ID:", id);
    if (!db) return;

    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    const req = store.get(id);

    req.onsuccess = e => {
        const w = e.target.result;
        if (!w) return;

        // ❗ NUR EIN ZENTRALER CALL
        loadWineIntoForm(w);

        window.currentEditId = w.id;

        wineImages.front = w.bildFront || null;
        wineImages.back = w.bildBack || null;

        console.log("EDIT geladen:", w);
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
        <td>${w.bewertungsQuelle || w.quelle || ""}</td>
        <td>${w.rating || ""}</td>
        <td>${w.preis ? w.preis + " €" : ""}</td>
        <td>
            ${(w.trinkfensterVon || w.trinkVon || "")}
            ${(w.trinkfensterBis || w.trinkBis)
                ? " - " + (w.trinkfensterBis || w.trinkBis)
                : ""}
        </td>
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
        const file = wineImages[type];
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
                // Ergebnisse zusammenführen
                for (let key in data) {
                    if (!mergedAnalysis[key] || mergedAnalysis[key] === "") {
                        mergedAnalysis[key] = data[key];
                    }
                }
            } else {
                console.error("KI-Analyse Fehler:", data.error);
                alert("Fehler bei KI-Analyse: " + JSON.stringify(data.error));
                return;
            }
        } catch (err) {
            console.error("Fetch Fehler:", err);
            alert("Fehler beim Senden der Datei an den Server");
            return;
        }
    }

    console.log("KI Ergebnis:", mergedAnalysis);

    // --------------------
    // Standardfelder automatisch befüllen
    // --------------------
    const fieldMapping = {
        name: "name",
        jahrgang: "jahrgang",
        winzer: "winzer",
        region: "region",
        alkohol: "alkohol",
        rating: "rating",
        preis: "preis",
        notizen: "notizen",

        // Backend -> Frontend Mapping
        trinkfensterVon: "trinkVon",
        trinkfensterBis: "trinkBis",
        bewertungsQuelle: "quelle"
    };

    for (let backendField in fieldMapping) {
        const frontendField = fieldMapping[backendField];
        const input = document.getElementById(frontendField);

        if (
            input &&
            mergedAnalysis[backendField] !== undefined &&
            mergedAnalysis[backendField] !== ""
        ) {
            input.value = mergedAnalysis[backendField];
        }
    }

    // global speichern
    wineAnalysis = mergedAnalysis;

    alert("KI-Analyse abgeschlossen und Formular befüllt!");
}

async function enrichWineWithGPT() {
    const wineData = {
        name: document.getElementById("name").value,
        jahrgang: document.getElementById("jahrgang").value,
        region: document.getElementById("region").value,
        winzer: document.getElementById("winzer").value
    };

    try {
        const response = await fetch(`${SERVER_URL}/api/enrich-wine-gpt`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(wineData)
        });

        const data = await response.json();

        if (!response.ok) {
            alert("GPT Anreicherung fehlgeschlagen");
            return;
        }

        if (data.preis)
            document.getElementById("preis").value = data.preis;

        if (data.rating)
            document.getElementById("rating").value = data.rating;

        if (data.trinkfensterVon)
            document.getElementById("trinkVon").value = data.trinkfensterVon;

        if (data.trinkfensterBis)
            document.getElementById("trinkBis").value = data.trinkfensterBis;

        if (data.bewertungsQuelle)
            document.getElementById("quelle").value = data.bewertungsQuelle;

        alert("GPT Weinbewertung ergänzt");

    } catch (err) {
        console.error(err);
        alert("Fehler bei GPT Anreicherung");
    }
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

// --------------------
// Reset IndexDB
// --------------------
function resetLocalDB() {
    if (!confirm("Lokale Datenbank wirklich löschen?")) return;

    const tx = db.transaction(["weine", "syncQueue"], "readwrite");

    tx.objectStore("weine").clear();
    tx.objectStore("syncQueue").clear();

    tx.oncomplete = () => {
        console.log("IndexedDB zurückgesetzt");
        alert("Lokale Daten gelöscht");

        loadWeine();
    };

    tx.onerror = (e) => {
        console.error("Reset Fehler:", e);
    };
}

function startGlobalSync() {
    // sofort einmal sync
    syncFromServer();

    // dann regelmäßig
    setInterval(() => {
        syncFromServer();
    }, 15000); // 15 Sekunden
}