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
let initDone = false;
let dbReady = false;

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
        startGlobalSync();
        initApp();
    };

    request.onerror = e => console.error("DB Fehler", e);
}

// --------------------
// QUEUE (Handy-App) 
// --------------------
function addToQueue(type, data) {
    if (!db) return;

    const tx = db.transaction("syncQueue", "readwrite");
    const store = tx.objectStore("syncQueue");
    let itemId = (type === "save") ? data.wineData.id : data;

    store.add({ type, data, entityId: itemId, createdAt: Date.now() });
    console.log("QUEUE gespeichert:", type, itemId);
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
            if (item.data.images.front) formData.append("bildFront", dataURLtoFile(item.data.images.front, "front.jpg"));
            if (item.data.images.back) formData.append("bildBack", dataURLtoFile(item.data.images.back, "back.jpg"));
            console.log("API_URL:", API_URL);
            request = fetch(API_URL, { method: "POST", body: formData });
        } else if (item.type === "delete") {
            console.log("API_URL:", API_URL);
            request = fetch(`${API_URL}/${item.data}`, { method: "DELETE" });
        }

        if (!request) { cursor.continue(); return; }

        request.then(async res => {
            let data;
            try { data = res.status !== 204 ? await res.json() : {}; } catch { data = {}; }
            console.log("QUEUE SERVER OK:", data);
            db.transaction("syncQueue", "readwrite").objectStore("syncQueue").delete(queueId);
            console.log("QUEUE entfernt", queueId);
        }).catch(err => console.error("QUEUE Fehler:", err));

        cursor.continue();
    };
}

function hasPendingQueueItems(callback) {
    const tx = db.transaction("syncQueue", "readonly");
    const store = tx.objectStore("syncQueue");

    const req = store.count();

    req.onsuccess = () => {
        callback(req.result > 0);
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
// SAVE WINE (Plattformabhängig)
// --------------------
async function saveWine() {
    console.log("SAVE START");
    console.log("currentEditId:", currentEditId);
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
    wine.id = String(currentEditId || Date.now());
    wine.createdAt = currentEditId ? wine.createdAt || Date.now() : Date.now();
    wine.updatedAt = Date.now();

    wine.lagerort = lagerort;
    wine.platz = platz;

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

        // ✔ FRONT IMAGE
        if (wineImages.front instanceof File) {
            formData.append("bildFront", wineImages.front);
        } else if (typeof wineImages.front === "string" && wineImages.front.startsWith("data:")) {
            formData.append("bildFront", dataURLtoFile(wineImages.front, "front.jpg"));
        }

        // ✔ BACK IMAGE
        if (wineImages.back instanceof File) {
            formData.append("bildBack", wineImages.back);
        } else if (typeof wineImages.back === "string" && wineImages.back.startsWith("data:")) {
            formData.append("bildBack", dataURLtoFile(wineImages.back, "back.jpg"));
        }

        console.log("API_URL:", API_URL);

        fetch(API_URL, { method: "POST", body: formData })
            .then(() => {
                alert("Wein gespeichert");
                clearWineForm();
                loadWeine();
            })
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

    console.log("API_URL:", API_URL);
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
    if (isMobileApp && !db) {
        console.warn("DB noch nicht ready");
        return;
    }

    if (isMobileApp) loadWeineMobile();
    else loadWeineBrowser();
}

// Browser: direkt Server
async function loadWeineBrowser() {
    console.log("loadWeineBrowser()");

    try {
        console.log("API_URL:", API_URL);
        const res = await fetch(API_URL);
        const wines = await res.json();
        console.log("SERVER DATA:", wines);

        wineCache = []; // � RESET

        if (Array.isArray(wines)) {
            wineCache = wines;
        }

        renderWineTable(wineCache);

    } catch (err) {
        console.error("Fehler Browser-Laden:", err);
    }
}

// Handy-App: IndexedDB + Server Merge

async function loadWeineMobile() {
    if (!db || isLoadingTable) return;
    isLoadingTable = true;

    const tbody = document.querySelector("#weinTable tbody");
    if (!tbody) {
        isLoadingTable = false;
        return;
    }

    const wines = [];
    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;

        if (cursor) {
            wines.push(cursor.value);
            cursor.continue();
        } else {
            wineCache = wines;

            if (currentSortField) applySort();
            else renderWineTable(wines);

            // -----------------------------
            // SERVER SYNC
            // -----------------------------
            console.log("API_URL:", API_URL);

            fetch(API_URL)
                .then(r => r.json())
                .then(serverData => {

                    const tx2 = db.transaction("weine", "readwrite");
                    const store2 = tx2.objectStore("weine");

                    serverData.forEach(sWine => {
                        store2.put(sWine);
                    });

                    tx2.oncomplete = () => {
                        loadWeineFromIndexedDB();
                        isLoadingTable = false;
                    };
                })
                .catch(err => {
                    console.error("Fetch ERROR - load Wine Mobile:", err);
                    console.error("Fetch message:", err?.message);
                    console.error("Fetch string:", JSON.stringify(err));
                    console.error("Fehler Serverdaten:", err);
                    isLoadingTable = false;
                });
        }
    };

    tx.onerror = () => {
        console.error("Fehler IndexedDB");
        isLoadingTable = false;
    };
}

function loadWeineFromIndexedDB() {
    const wines = [];
    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    store.openCursor().onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
            wines.push(cursor.value);
            cursor.continue();
        } else {
            wineCache = wines;
            renderWineTable(wines);
        }
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
    currentEditId = wine.id;
    console.log("QR LOAD currentEditId:", currentEditId);
}

// --------------------
// LÖSCHEN
// --------------------
function deleteWine(id) {
    console.log("DELETE:", id);

    if (isMobileApp) {
        if (!db) {
            alert("Datenbank nicht bereit");
            return;
        }

        const tx = db.transaction("weine", "readwrite");
        tx.objectStore("weine").delete(id);

        tx.oncomplete = () => {
            addToQueue("delete", id);
            loadWeine();
        };

        tx.onerror = e => console.error("Delete Mobile Fehler:", e);

    } else {
        // Browser → direkt Server
        console.log("API_URL:", API_URL);
        fetch(`${API_URL}/${id}`, {
            method: "DELETE"
        })
        .then(() => {
            console.log("Browser Delete OK");
            loadWeine();
        })
        .catch(err => {
            console.error("Delete Browser Fehler:", err);
        });
    }
}

// --------------------
// SERVER SYNC
// --------------------
function syncWineToServer(wine) {
    console.log("WINE SAVE OBJECT:", wine);
    console.log("JSON STRING:", JSON.stringify(wine));
    console.log("API_URL:", API_URL);
    fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wine) })
        .then(() => console.log("SYNC OK"))
        .catch(() => { addToQueue("save", wine); });
}

function deleteWineOnServer(id) {
    console.log("API_URL:", API_URL);
    fetch(`${API_URL}/${id}`, { method: "DELETE" })
        .then(() => console.log("DELETE OK"))
        .catch(() => { addToQueue("delete", id); });
}

// --------------------
// SYNC 
// --------------------
function syncFromServer() {
    if (suppressSync) return;

    console.log("API_URL:", API_URL);
    fetch(API_URL)
        .then(r => r.json())
        .then(serverData => {
            const tx = db.transaction("weine", "readwrite");
            const store = tx.objectStore("weine");

            const serverIds = serverData.map(w => String(w.id));

            // Serverdaten aktualisieren
            serverData.forEach(w => store.put(w));

            // lokale Datensätze prüfen und gelöschte entfernen
            store.openCursor().onsuccess = e => {
                const cursor = e.target.result;
                if (!cursor) return;

                const localWine = cursor.value;

                if (!serverIds.includes(String(localWine.id))) {
                    console.log("Lokal löschen:", localWine.id);
                    cursor.delete();
                }

                cursor.continue();
            };

            tx.oncomplete = () => loadWeine();
        })
        .catch(err => {
            console.error("Fetch ERROR Sync From Server:", err);
            console.error("Fetch message:", err?.message);
            console.error("Fetch string:", JSON.stringify(err));
            isLoadingTable = false;
            console.log("kein Server erreichbar", err);
        });
}


// --------------------
// EXPORT/IMPORT
// --------------------
async function exportBackup() {
    // --------------------
    // Browser
    // --------------------
    if (!isMobileApp) {
        const exportData = Array.isArray(wineCache) ? wineCache : [];

        const blob = new Blob(
            [JSON.stringify(exportData, null, 2)],
            { type: "application/json" }
        );

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "vinothek-backup.json";
        a.click();

        return;
    }

    // --------------------
    // Mobile App
    // --------------------
    if (!db) {
        alert("Datenbank noch nicht bereit");
        return;
    }

    const wines = [];
    const tx = db.transaction("weine", "readonly");
    const store = tx.objectStore("weine");

    store.openCursor().onsuccess = async e => {
        const cursor = e.target.result;

        if (cursor) {
            wines.push(cursor.value);
            cursor.continue();
        } else {
            const jsonText = JSON.stringify(wines, null, 2);

            try {
                await navigator.share({
                    title: "Vinothek Backup",
                    text: jsonText
                });
            } catch (err) {
                console.error("Export Fehler:", err);
            }
        }
    };
}


function importBackup() {
    const input = document.getElementById("importFile");

    if (!input || !input.files || input.files.length === 0) {
        alert("Datei wählen");
        return;
    }

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);

            if (isMobileApp) {
                const tx = db.transaction("weine", "readwrite");
                const store = tx.objectStore("weine");

                data.forEach(w => store.put(w));

                tx.oncomplete = () => {
                    loadWeine();
                    alert("Import erfolgreich");
                };

            } else {
                // ✅ HIER kommt dein Promise.all rein
                Promise.all(
                    data.map(w => {
                        const formData = new FormData();
                        formData.append("wine", JSON.stringify(w));

                        return fetch(API_URL, {
                            method: "POST",
                            body: formData
                        });
                    })
                ).then(() => {
                    alert("Import fertig");
                    loadWeine();
                }).catch(err => {
                    console.error("Import Fehler:", err);
                    alert("Fehler beim Import");
                });
            }

        } catch (err) {
            console.error("Import Fehler:", err);
            alert("Ungültige JSON Datei");
        }
    };

    reader.readAsText(file);
}

// --------------------
// EDIT/LOAD FORM
// --------------------
async function editWine(id) {
    id = String(id);   // WICHTIG

    console.log("EDIT gestartet:", id);
    console.log("wineCache:", wineCache);

    let w = null;

    // -------------------------
    // 1. MOBILE (IndexedDB)
    // -------------------------
    if (isMobileApp && db) {
        w = await new Promise((resolve) => {
            const tx = db.transaction("weine", "readonly");
            const store = tx.objectStore("weine");

            console.log("Suche ID:", id, typeof id);

            const req = store.get(id);

            req.onsuccess = e => {
                console.log("IndexedDB Treffer:", e.target.result);
                resolve(e.target.result || null);
            };

            req.onerror = err => {
                console.error("IndexedDB Fehler:", err);
                resolve(null);
            };
        });
    }

    // -------------------------
    // 2. BROWSER
    // -------------------------
    else {
        w = wineCache.find(x => String(x.id) === id);

        if (!w) {
            try {
                console.log("API_URL:", API_URL);
                const res = await fetch(`${API_URL}/${id}`);
                if (res.ok) w = await res.json();
            } catch (err) {
                console.error("Server fetch failed:", err);
            }
        }
    }

    if (!w) {
        alert("Wein nicht gefunden");
        return;
    }

    // Formular
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

    document.getElementById("global_lagerort").value = w.lagerort || "Vinothek";
    document.getElementById("global_platz").value = w.platz || "";

    wineImages.front = w.bildFront || null;
    wineImages.back = w.bildBack || null;

    currentEditId = String(w.id);

    console.log("EDIT OK:", w);
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
            <button onclick="editWine('${w.id}')">✏️</button>
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
function resizeImage(file, maxWidth = 640, maxHeight = 640, quality = 0.85) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = e => {
            const img = new Image();

            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }

                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }

                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");

                canvas.width = width;
                canvas.height = height;

                // WICHTIG: Graustufen + Kontrast
                ctx.filter = "grayscale(100%) contrast(120%)";

                ctx.drawImage(img, 0, 0, width, height);

                const compressedDataURL = canvas.toDataURL(
                    "image/jpeg",
                    quality
                );

                resolve(compressedDataURL);
            };

            img.onerror = reject;
            img.src = e.target.result;
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// --------------------
// KI ANALYSE
// --------------------

// KI-Analyse für Front- und Back-Bild
async function analyzeWineWithAI() {
    let mergedAnalysis = {};

    const frontFile = wineImages.front;
    const backFile = wineImages.back;

    if (!frontFile) {
        alert("Bitte zuerst das Vorderetikett auswählen.");
        return;
    }

    try {
        // Bilder verkleinern + Graustufen + Base64
        const frontBase64 = await resizeImage(frontFile, 640, 640, 0.85);

        let backBase64 = null;
        if (backFile) {
            backBase64 = await resizeImage(backFile, 640, 640, 0.85);
        }

        const response = await fetch("http://10.0.0.30:5000/api/analyze-label-ai", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                front_image: frontBase64,
                back_image: backBase64
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("KI Fehler:", data.error);
            alert("KI Fehler: " + data.error);
            return;
        }

        mergedAnalysis = data;

        // Formular befüllen
        for (let key in mergedAnalysis) {
            const input = document.getElementById(key);
            if (input) {
                input.value = mergedAnalysis[key];
            }
        }

        wineAnalysis = mergedAnalysis;

        alert("KI-Analyse abgeschlossen");

    } catch (err) {
        console.error("Fetch Fehler:", err);
        alert("Fehler bei KI-Analyse");
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

        loadWineFromQR();

    } catch (err) {
        alert("QR-Code konnte nicht gelesen werden");
        console.error(err);
    }
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
        processQueue();
        syncFromServer();
        loadWeine();
    }, 15000); // 15 Sekunden
}

function initApp() {
    console.log("App gestartet");

    const isApp = window.Capacitor;

    if (isApp) {
        document.querySelectorAll(".print-button")
            .forEach(btn => btn.style.display = "none");
    }

    loadWeine();
}

// ======================
// STARTUP / ENTRY POINT
// ======================

document.addEventListener("DOMContentLoaded", () => {
    if (!isMobileApp) {
        initApp();
    }
});
