const API_URL = "http://10.0.0.30:5000/api/weine";

fetch(API_URL)
.then(r=>r.json())
.then(data=>{

    let container = document.getElementById("labels");

    data.forEach(w=>{

        if(w.deleted) return;

        let div = document.createElement("div");
        div.className = "label";

        let canvas = document.createElement("canvas");

        QRCode.toCanvas(canvas, w.id.toString());

        div.innerHTML = `
            <b>${w.name}</b><br>
            ${w.winzer || ""}<br>
            ${w.alkohol || ""}%<br>
            ${w.lagerort}/${w.platz}
        `;

        div.appendChild(canvas);
        container.appendChild(div);
    });
});
