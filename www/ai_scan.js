let scannedData = {};

// --------------------------------------------------
// OCR Scan starten
// --------------------------------------------------
async function scanLabel(){

    let file = document.getElementById("imageInput").files[0];

    if(!file){
        alert("Bitte zuerst ein Bild aufnehmen oder auswählen.");
        return;
    }

    document.getElementById("result").innerText = "⏳ OCR wird durchgeführt...";

    try{

        const { data: { text } } = await Tesseract.recognize(
            file,
            'deu+eng',
            {
                logger: m => console.log(m)
            }
        );

        console.log("OCR TEXT:", text);

        // ---------------------------------------
        // Einfache lokale Analyse
        // ---------------------------------------

        let jahrgangMatch = text.match(/\b(19|20)\d{2}\b/);
        let alkoholMatch = text.match(/\d+(\.\d+)?\s?%/);

        let jahrgang = jahrgangMatch ? jahrgangMatch[0] : "";
        let alkohol = alkoholMatch ? alkoholMatch[0] : "";

        let lines = text.split("\n").filter(l => l.trim() !== "");

        let name = lines.length > 0 ? lines[0] : "";

        scannedData = {
            name: name,
            jahrgang: jahrgang,
            alkohol: alkohol
        };

        document.getElementById("result").innerText =
            "OCR Ergebnis:\n\n" +
            JSON.stringify(scannedData, null, 2);

        // ---------------------------------------
        // VIVINO - Lookup
        // ---------------------------------------

        if(scannedData.name){

        searchWineOnline(scannedData.name)
        .then(v=>{

        scannedData.preis = v.price;
        scannedData.region = v.region;

        document.getElementById("result").innerText +=
        "\n\n🍷 Vivino Daten:\n" +
        JSON.stringify(v,null,2);

        });

        }

        // ---------------------------------------
        // OPTIONAL: AI Analyse (wenn Internet)
        // ---------------------------------------

        if(navigator.onLine){

            try{

                const response = await fetch(
                    "https://api.openai.com/v1/chat/completions",
                    {
                        method:"POST",
                        headers:{
                            "Content-Type":"application/json",

                            // ⚠️ HIER API KEY EINTRAGEN
                            // "Authorization":"Bearer DEIN_API_KEY"
                        },
                        body:JSON.stringify({
                            model:"gpt-4o-mini",
                            messages:[
                                {
                                    role:"user",
                                    content:
                                    "Extrahiere Wein Name, Jahrgang und Alkohol aus folgendem Text:\n\n"
                                    + text
                                }
                            ]
                        })
                    }
                );

                let data = await response.json();

                if(data.choices){

                    document.getElementById("result").innerText =
                        "AI Analyse:\n\n" +
                        data.choices[0].message.content;

                }

            }catch(aiError){

                console.log("AI Analyse nicht verfügbar:", aiError);

            }

        }

    }catch(err){

        console.error(err);

        alert("Fehler beim OCR Scan.");

    }

}


// --------------------------------------------------
// Daten ins Formular übernehmen
// --------------------------------------------------
function applyData(){

    if(!scannedData){
        alert("Keine Daten vorhanden.");
        return;
    }

    localStorage.setItem(
        "scanData",
        JSON.stringify(scannedData)
    );

    window.location.href = "index.html";
}