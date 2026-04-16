const API_URL = "http://10.0.0.30:5000/api/weine";

fetch(API_URL)
.then(r => r.json())
.then(data => {

    const grid = document.getElementById("grid");
    grid.innerHTML = "";

    if (!Array.isArray(data)) {
        console.error("Ungültige API Antwort:", data);
        return;
    }

    // -----------------------------
    // 1. GROUPING (AUTOMATISCH)
    // -----------------------------
    const groups = {};

    data.forEach(w => {
        if (!w) return;

        const key = (w.lagerort || "Unbekannt")
            .toString()
            .trim();

        if (!groups[key]) {
            groups[key] = [];
        }

        groups[key].push(w);
    });

    // -----------------------------
    // 2. RENDER ALL GROUPS
    // -----------------------------
    Object.entries(groups).forEach(([title, items]) => {
        renderSection(title, items);
    });

});

function renderSection(title, data) {

    const grid = document.getElementById("grid");

    const h = document.createElement("h2");
    h.innerText = title;
    grid.appendChild(h);

    const section = document.createElement("div");

    section.style.display = "grid";
    section.style.gridTemplateColumns = "repeat(5, 1fr)";
    section.style.gap = "10px";

    data.forEach(w => {

        const cell = document.createElement("div");

        cell.style.border = "1px solid black";
        cell.style.padding = "10px";
        cell.style.background = (w.anzahl < 3) ? "#ffcccc" : "#ccffcc";

        cell.innerHTML = `
            <b>${w.platz || ""}</b><br>
            ${w.name || ""}<br>
            (${w.anzahl || 1})
        `;

        section.appendChild(cell);
    });

    grid.appendChild(section);
}