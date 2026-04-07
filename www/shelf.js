const API_URL = "http://10.0.0.30:5000/api/weine";

fetch(API_URL)
.then(r=>r.json())
.then(data=>{

let grid = document.getElementById("grid");

grid.innerHTML="";

let vinothek = data.filter(w=>w.lagerort==="Vinothek");
let haus = data.filter(w=>w.lagerort==="Hauskeller");

renderSection("Vinothek",vinothek);
renderSection("Hauskeller",haus);

});


function renderSection(title,data){

let grid = document.getElementById("grid");

let h = document.createElement("h2");
h.innerText=title;

grid.appendChild(h);

let section = document.createElement("div");

section.style.display="grid";
section.style.gridTemplateColumns="repeat(5,1fr)";
section.style.gap="10px";

data.forEach(w=>{

if(w.deleted) return;

let cell=document.createElement("div");

cell.style.border="1px solid black";
cell.style.padding="10px";
cell.style.background=w.anzahl<3?"#ffcccc":"#ccffcc";

cell.innerHTML=`

<b>${w.platz}</b><br>
${w.name}<br>
(${w.anzahl})

`;

section.appendChild(cell);

});

grid.appendChild(section);

}