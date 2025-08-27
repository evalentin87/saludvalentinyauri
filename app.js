// ======= APP SALUD (Compat + Dashboard) =======

// 🔧 REEMPLAZA con tu configuración
const firebaseConfig = {
  apiKey: "AIzaSyALU3rLsa7TYHWXrZyYlgLEco5qy3NTZMg",
  authDomain: "saludvalentinyauri.firebaseapp.com",
  projectId: "saludvalentinyauri",
  storageBucket: "saludvalentinyauri.firebasestorage.app",
  messagingSenderId: "432013480982",
  appId: "1:432013480982:web:658f1cdff8a5d66d6b5137"
};

// 2) Inicializa Firebase (compat)
try{
  firebase.initializeApp(firebaseConfig);
}catch(err){
  alert("⚠️ Error al inicializar Firebase. Revisa que pegaste bien tu firebaseConfig.");
  console.error(err);
}
const db = firebase.firestore();
const storage = firebase.storage();

// ===== DOM =====
const $ = (s) => document.querySelector(s);
const nombreUsuario = $("#nombreUsuario");
const btnAgregarUsuario = $("#btnAgregarUsuario");
const selectUsuarios = $("#selectUsuarios");
const infoUsuario = $("#infoUsuario");
const btnEditarUsuario = $("#btnEditarUsuario");
const nombreEnfermedad = $("#nombreEnfermedad");
const sintomas = $("#sintomas");
const foto = $("#foto");
const btnTomarFoto = $("#btnTomarFoto");
const btnQuitarFoto = $("#btnQuitarFoto");
const preview = $("#preview");
const previewImg = $("#previewImg");
const btnRegistrarEnfermedad = $("#btnRegistrarEnfermedad");
const tablaCuerpo = document.querySelector("#tablaEnfermedades tbody");
const toastEl = $("#toast");
const emptyState = $("#emptyState");
const progress = $("#progress");
const progressBar = $("#progressBar");

// Dashboard
const fechaInicio = $("#fechaInicio");
const fechaFin = $("#fechaFin");
const btnAplicarFiltro = $("#btnAplicarFiltro");
const btnResetFiltro = $("#btnResetFiltro");
const resumenTop = $("#resumenTop");
const chartCanvas = document.getElementById("chartMeses");

let currentUserId = null;
let selectedFile = null;
let unsubscribe = null;
let grafico = null;
let enfermedadesRaw = []; // datos sin filtrar

// ===== Helpers =====
const toast = (msg) => {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  setTimeout(()=> toastEl.hidden = true, 2600);
};

const parseFecha = (f) => {
  if(!f) return null;
  if(typeof f === "string") return new Date(f);
  if(f.toDate) return f.toDate(); // Firestore Timestamp
  try { return new Date(f); } catch { return null; }
};

const formatDate = (f) => {
  const d = parseFecha(f);
  return d ? d.toLocaleString() : "—";
};

async function compressImage(file){
  try{
    const img = await createImageBitmap(file);
    const c = document.createElement('canvas');
    const max = 1600;
    let {width, height} = img;
    if(width > height && width > max){ height = Math.round(height * (max/width)); width = max; }
    else if(height > max){ width = Math.round(width * (max/height)); height = max; }
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(img, 0, 0, width, height);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', .85));
  }catch(e){
    console.warn("No se pudo comprimir, se sube original.", e);
    return file;
  }
}

// ===== Usuarios =====
async function cargarUsuarios(){
  try{
    selectUsuarios.innerHTML = "";
    const snap = await db.collection("usuarios").get();
    if(snap.empty){
      const opt = document.createElement('option');
      opt.textContent = "— Sin usuarios —";
      opt.disabled = true; opt.selected = true;
      selectUsuarios.appendChild(opt);
      emptyState.style.display = 'block';
      return;
    }
    const frag = document.createDocumentFragment();
    snap.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.data().nombre || '(sin nombre)';
      frag.appendChild(opt);
    });
    selectUsuarios.appendChild(frag);
    currentUserId = selectUsuarios.value;
    infoUsuario.textContent = "Usuario seleccionado: " + selectUsuarios.options[selectUsuarios.selectedIndex].text;
    suscribirEnfermedades(currentUserId);
  }catch(e){
    console.error(e); toast("No se pudo cargar usuarios (reglas o config).");
  }
}

btnAgregarUsuario.addEventListener("click", async () => {
  try{
    const nombre = (nombreUsuario.value || "").trim();
    if(!nombre) return toast("Escribe un nombre");
    await db.collection("usuarios").add({ nombre });
    nombreUsuario.value="";
    toast("Usuario agregado");
    cargarUsuarios();
  }catch(e){
    console.error(e); toast("Error al agregar usuario (revisa reglas Firestore).");
  }
});

selectUsuarios.addEventListener("change", () => {
  currentUserId = selectUsuarios.value;
  infoUsuario.textContent = "Usuario seleccionado: " + selectUsuarios.options[selectUsuarios.selectedIndex].text;
  suscribirEnfermedades(currentUserId);
});

// ✏️ Editar usuario
btnEditarUsuario.addEventListener("click", async () => {
  if(!currentUserId) return toast("Selecciona un usuario");
  const nuevoNombre = prompt("Nuevo nombre para el usuario:");
  if(nuevoNombre && nuevoNombre.trim()){
    try{
      await db.collection("usuarios").doc(currentUserId).update({ nombre: nuevoNombre.trim() });
      toast("Usuario actualizado");
      cargarUsuarios();
    }catch(e){
      console.error(e); toast("No se pudo actualizar el usuario");
    }
  }
});

// ===== Foto =====
btnTomarFoto.addEventListener('click', () => foto.click());

foto.addEventListener('change', () => {
  if(foto.files && foto.files[0]){
    selectedFile = foto.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      previewImg.src = reader.result;
      preview.classList.remove('empty');
      preview.classList.add('has-img');
      btnQuitarFoto.disabled = false;
    };
    reader.readAsDataURL(selectedFile);
  }
});

btnQuitarFoto.addEventListener('click', () => {
  selectedFile = null;
  foto.value = "";
  previewImg.src = "";
  preview.classList.remove('has-img');
  preview.classList.add('empty');
  btnQuitarFoto.disabled = true;
});

// ===== Enfermedad =====
btnRegistrarEnfermedad.addEventListener('click', async () => {
  if(!currentUserId) return toast("Selecciona un usuario");
  const enf = (nombreEnfermedad.value || "").trim();
  const sin = (sintomas.value || "").trim();
  if(!enf) return toast("Escribe la enfermedad");

  try{
    let fotoURL = "";
    if(selectedFile){
      const blob = await compressImage(selectedFile);
      const safeName = (selectedFile.name || 'foto').replace(/\\s+/g,'_');
      const ref = storage.ref().child(`fotos/${Date.now()}-${safeName}`);
      const task = ref.put(blob);

      progress.hidden = false; progressBar.style.width = "0%";
      await new Promise((resolve, reject)=>{
        task.on('state_changed', (snap)=>{
          const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
          progressBar.style.width = pct.toFixed(0) + "%";
        }, reject, async ()=>{
          fotoURL = await ref.getDownloadURL();
          resolve();
        });
      });
      progress.hidden = true;
    }

    await db.collection("usuarios").doc(currentUserId)
      .collection("enfermedades")
      .add({
        enfermedad: enf,
        sintomas: sin,
        fecha: new Date().toISOString(),
        fotoURL
      });

    nombreEnfermedad.value = "";
    sintomas.value = "";
    btnQuitarFoto.click();
    toast("Registro guardado");
  }catch(e){
    console.error(e); toast("Error al guardar registro (revisa reglas/Storage)");
  }
});

// ===== Historial + Dashboard =====
function suscribirEnfermedades(userId){
  try{
    if(unsubscribe) unsubscribe();
    emptyState.style.display = 'none';
    tablaCuerpo.innerHTML = "<tr><td colspan='5' class='muted'>Cargando…</td></tr>";

    unsubscribe = db.collection("usuarios").doc(userId)
      .collection("enfermedades")
      .orderBy("fecha","desc")
      .onSnapshot((snap)=>{
        enfermedadesRaw = [];
        tablaCuerpo.innerHTML = "";
        if(snap.empty){
          emptyState.style.display = 'block';
          actualizarDashboard();
          return;
        }

        snap.forEach(d=>{
          const data = d.data();
          enfermedadesRaw.push({ id: d.id, ...data });
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${formatDate(data.fecha)}</td>
            <td>${data.enfermedad || ""}</td>
            <td>${data.sintomas || ""}</td>
            <td>${data.fotoURL ? `<a href="${data.fotoURL}" target="_blank" rel="noopener"><span class="badge">Ver foto</span></a>` : '<span class="muted">—</span>'}</td>
            <td><button class="ghost" data-id="${d.id}">Eliminar</button></td>`;
          tr.querySelector('button').addEventListener('click', async () => {
            if(!confirm('¿Eliminar este registro?')) return;
            if(data.fotoURL){
              try{
                await firebase.storage().refFromURL(data.fotoURL).delete();
              }catch(e){ /* ignore */ }
            }
            await db.collection("usuarios").doc(userId)
              .collection("enfermedades").doc(d.id).delete();
            toast("Eliminado");
          });
          tablaCuerpo.appendChild(tr);
        });

        actualizarDashboard(); // recalcular gráfico + top
      }, (err)=>{
        console.error(err);
        toast("No se pudo leer historial (reglas Firestore).");
      });
  }catch(e){
    console.error(e); toast("Error al suscribirse al historial.");
  }
}

// Filtro y dashboard
function getFiltroFechas(){
  let ini = fechaInicio.value ? new Date(fechaInicio.value + "T00:00:00") : null;
  let fin = fechaFin.value ? new Date(fechaFin.value + "T23:59:59") : null;
  return {ini, fin};
}
function dentroDeRango(d, ini, fin){
  if(!d) return false;
  if(ini && d < ini) return false;
  if(fin && d > fin) return false;
  return true;
}

function actualizarDashboard(){
  const {ini, fin} = getFiltroFechas();
  const filtradas = enfermedadesRaw.filter(e => {
    const d = parseFecha(e.fecha);
    return d && dentroDeRango(d, ini, fin);
  });

  // Conteo por mes (0-11)
  const meses = Array(12).fill(0);
  filtradas.forEach(e => {
    const d = parseFecha(e.fecha);
    if(!d) return;
    meses[d.getMonth()]++;
  });

  // Top enfermedades
  const mapa = {};
  filtradas.forEach(e => {
    const n = (e.enfermedad || "").trim().toLowerCase();
    if(!n) return;
    mapa[n] = (mapa[n] || 0) + 1;
  });
  const top = Object.entries(mapa).sort((a,b)=> b[1]-a[1]).slice(0,5);

  // Pintar Top
  resumenTop.innerHTML = "";
  if(top.length === 0){
    resumenTop.innerHTML = "<li class='muted'>Sin datos en el rango</li>";
  }else{
    top.forEach(([name, count]) => {
      const li = document.createElement('li');
      li.textContent = `${name} — ${count}`;
      resumenTop.appendChild(li);
    });
  }

  // Gráfico
  const labels = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const data = {
    labels,
    datasets: [{
      label: "Registros por mes",
      data: meses
    }]
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { beginAtZero: true, ticks: { precision:0 } }
    },
    plugins: {
      legend: { display: false }
    }
  };
  // Altura del canvas
  chartCanvas.parentElement.style.height = '320px';
  if(grafico){ grafico.destroy(); }
  grafico = new Chart(chartCanvas, { type: 'bar', data, options });
}

// Filtros
btnAplicarFiltro.addEventListener("click", actualizarDashboard);
btnResetFiltro.addEventListener("click", () => {
  fechaInicio.value = "";
  fechaFin.value = "";
  actualizarDashboard();
});

// Boot
// Rango por defecto: año actual completo
(function setDefaultDates(){
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31);
  const toYmd = (d) => d.toISOString().slice(0,10);
  fechaInicio.value = toYmd(start);
  fechaFin.value = toYmd(end);
})();
cargarUsuarios();
