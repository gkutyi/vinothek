const API_URL = "http://10.0.0.30:5000/api/weine";

fetch(API_URL)
.then(r=>r.json())
.then(data=>{

let total=0;
let value=0;

let regions={};
let years={};

data.forEach(w=>{

if(w.deleted) return;

total+=w.anzahl;

// Preis simuliert (bis API kommt)
let preis = parseFloat(w.preis || 10);

value += preis * w.anzahl;

// Regionen
if(!regions[w.region]) regions[w.region]=0;
regions[w.region]+=w.anzahl;

// Jahrgänge
if(!years[w.jahrgang]) years[w.jahrgang]=0;
years[w.jahrgang]+=w.anzahl;

});

document.getElementById("total").innerText = total;
document.getElementById("value").innerText = value.toFixed(2) + " €";

// REGION CHART
new Chart(document.getElementById("regionChart"),{

type:"bar",

data:{
labels:Object.keys(regions),
datasets:[{
label:"Flaschen",
data:Object.values(regions)
}]
}

});

// YEAR CHART
new Chart(document.getElementById("yearChart"),{

type:"line",

data:{
labels:Object.keys(years),
datasets:[{
label:"Flaschen",
data:Object.values(years)
}]
}

});

});