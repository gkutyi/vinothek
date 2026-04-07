function onScanSuccess(code){

fetch("https://world.openfoodfacts.org/api/v0/product/"+code+".json")

.then(r=>r.json())

.then(data=>{

let name=data.product.product_name||"";

let region=data.product.origins||"";

localStorage.setItem("scanData",JSON.stringify({
name:name,
region:region
}));

window.location.href="index.html";

});

}

new Html5Qrcode("reader").start(

{ facingMode:"environment" },

{ fps:10, qrbox:250 },

onScanSuccess

);
