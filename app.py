from flask import Flask, request, jsonify, send_from_directory
import json, os, re
from openai import OpenAI
from flask_cors import CORS

from flask import Response

app = Flask(__name__, static_folder="www", static_url_path="")

CORS(app)

DB_FILE = "weine.json"

client = OpenAI()

# Lade Datenbank
if os.path.exists(DB_FILE):
    with open(DB_FILE, "r", encoding="utf-8") as f:
        weine_db = json.load(f)
else:
    weine_db = []

def save_db():
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(weine_db, f, ensure_ascii=False, indent=2)

def find_wine_by_id(wine_id):
    for w in weine_db:
        if w["id"] == wine_id:
            return w
    return None

# ------------------------------
# REST API
# ------------------------------

@app.route("/api/weine", methods=["GET"])
def get_all_wines():
    print("SEND DATA:", weine_db)

    return Response(
        json.dumps(weine_db, ensure_ascii=False),
        mimetype="application/json",
        status=200
    )

@app.route("/api/weine", methods=["POST"])
def create_or_update_wine():
    try:
        data = None

        # -------------------------
        # 1. JSON (Browser Import)
        # -------------------------
        if request.is_json:
            data = request.get_json()

        # -------------------------
        # 2. FormData (Mobile Queue)
        # -------------------------
        if not data:
            wine_json = request.form.get("wine")
            if wine_json:
                data = json.loads(wine_json)

        # -------------------------
        # VALIDATION
        # -------------------------
        if not data:
            return jsonify({"error": "keine Daten"}), 400

        wine_id = str(data.get("id"))

        lagerort = data.get("lagerort", "")
        platz = data.get("platz", "")

        existing = find_wine_by_id(wine_id)
        if existing:
            weine_db.remove(existing)

        wine_entry = {
            "id": wine_id,
            "name": data.get("name", ""),
            "jahrgang": data.get("jahrgang", ""),
            "region": data.get("region", ""),
            "winzer": data.get("winzer", ""),
            "alkohol": data.get("alkohol", ""),
            "lagerort": lagerort,
            "platz": platz,
            "anzahl": data.get("anzahl", 1),
            "notizen": data.get("notizen", ""),
            "rating": data.get("rating", ""),
            "preis": data.get("preis", ""),
            "trinkfensterVon": data.get("trinkfensterVon", ""),
            "trinkfensterBis": data.get("trinkfensterBis", ""),
            "bewertungsQuelle": data.get("bewertungsQuelle", ""),
            "ocrTextFront": data.get("ocrTextFront", ""),
            "ocrTextBack": data.get("ocrTextBack", ""),
            "bild": data.get("bild", ""),
            "bildRueck": data.get("bildRueck", "")
        }

        weine_db.append(wine_entry)
        save_db()

        return jsonify({"status": "ok", "id": wine_id})

    except Exception as e:
        print("SAVE ERROR:", str(e))
        return jsonify({"error": str(e)}), 500
        
@app.route("/api/weine/<wine_id>", methods=["DELETE"])
def delete_wine(wine_id):
    existing = find_wine_by_id(wine_id)
    if existing:
        weine_db.remove(existing)
        save_db()
    return jsonify({"status": "deleted"})

# ------------------------------
# KI Analyse
# ------------------------------
@app.route("/api/analyze-label-ai", methods=["POST"])
def analyze_label_ai():
    try:
        data = request.get_json(silent=True)

        if not data:
            return jsonify({"error": "Keine JSON-Daten empfangen"}), 400

        front = data.get("front_image")
        back = data.get("back_image")

        print("Front vorhanden:", bool(front))
        print("Back vorhanden:", bool(back))

        if not front:
            return jsonify({"error": "Kein Vorderetikett vorhanden"}), 400

        # Base64 Prefix ergänzen falls notwendig
        if not front.startswith("data:image"):
            front = f"data:image/jpeg;base64,{front}"

        if back and not back.startswith("data:image"):
            back = f"data:image/jpeg;base64,{back}"

        prompt = """
Du erhältst Vorder- und eventuell Rücketikett eines Weins.

Nutze beide Bilder gemeinsam zur Extraktion aller verfügbaren Daten.

Lies ALLE sichtbaren Texte sorgfältig.

Extrahiere insbesondere auch kleine Angaben wie:
- Alkoholgehalt (z.B. 13,5 % vol)
- Jahrgang
- Herkunft / Region
- Winzer / Weingut
- Preis falls sichtbar

Suche gezielt nach:
- Prozentangaben
- Jahreszahlen
- Regionen
- Herkunftsbezeichnungen

Gib ausschließlich reines JSON zurück:

{
  "name": "",
  "jahrgang": "",
  "region": "",
  "winzer": "",
  "alkohol": "",
  "notizen": "",
  "rating": "",
  "preis": "",
  "trinkfensterVon": "",
  "trinkfensterBis": ""
}

WICHTIG:
- nur JSON
- keine Erklärung
- keine Markdown Blöcke
- Alkohol nur als Zahl oder Prozentwert
"""

        # Nachrichtenblock vorbereiten
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": front
                        }
                    }
                ]
            }
        ]

        # Rücketikett ergänzen
        if back:
            messages[0]["content"].append({
                "type": "image_url",
                "image_url": {
                    "url": back
                }
            })

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            max_tokens=800
        )

        raw = response.choices[0].message.content.strip()

        print("KI RAW RESPONSE:")
        print(raw)

        # Markdown JSON Block entfernen
        if raw.startswith("```"):
            raw = raw.replace("```json", "")
            raw = raw.replace("```", "")
            raw = raw.strip()

        result = json.loads(raw)

        # Defaults absichern
        defaults = {
            "name": "",
            "jahrgang": "",
            "region": "",
            "winzer": "",
            "alkohol": "",
            "notizen": "",
            "rating": "",
            "preis": "",
            "trinkfensterVon": "",
            "trinkfensterBis": ""
        }

        defaults.update(result)

        print("========== FINAL RESULT ==========")
        print(defaults)

        return jsonify(defaults)

    except Exception as e:
        print("KI FEHLER:", str(e))
        return jsonify({"error": str(e)}), 500
        
# ------------------------------
# Serve Static Files
# ------------------------------
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_file(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, "index.html")

# ------------------------------
# Main
# ------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)