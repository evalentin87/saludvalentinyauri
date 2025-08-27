// ======= APP SALUD (V2 con manejo de errores) =======
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs, doc, deleteDoc,
  query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// 🔧 REEMPLAZA con tu configuración
const firebaseConfig = {
  apiKey: "AIzaSyALU3rLsa7TYHWXrZyYlgLEco5qy3NTZMg",
  authDomain: "saludvalentinyauri.firebaseapp.com",
  projectId: "saludvalentinyauri",
  storageBucket: "saludvalentinyauri.firebasestorage.app",
  messagingSenderId: "432013480982",
  appId: "1:432013480982:web:658f1cdff8a5d66d6b5137"
};

// ===== Init Firebase =====
let app, db, storage;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
} catch (e) {
  alert("⚠️ Error al inicializar Firebase. Revisa tu firebaseConfig en app.js");
  console.error(e);
}

// ===== DOM =====
const $ = (s) => document.querySelector(s);
const nombreUsuario = $("#nombreUsuario");
const btnAgregarUsuario = $("#btnAgregarUsuario");
const selectUsuarios = $("#selectUsuarios");
const infoUsuario = $("#infoUsuario");
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

let currentUserId = null;
let selectedFile = null;
let unsub = null;

// ===== Helpers =====
const toast = (msg) => {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  setTimeout(()=> toastEl.hidden = true, 2600);
};

window.addEventListener("error", (e) => {
  console.error("JS Error:", e.error || e.message);
  toast("⚠️ Revisa la consola (F12) para ver el error");
});

const formatDate = (iso) => new Date(iso).toLocaleString();

async function compressImage(file){
  try{
    const img = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const max = 1600;
    let {width, height} = img;
    if(width > height && width > max){ height = Math.round(height * (max/width)); width = max; }
    else if(height > max){ width = Math.round(width * (max/height)); height = max; }
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise(res => canvas.toBlob(res, 'image/jpeg', .85));
  }catch(e){
    console.warn("No se pudo comprimir, se sube original.", e);
    return file;
  }
}

// ===== Usuarios =====
async function cargarUsuarios(){
  try{
    selectUsuarios.innerHTML = "";
    const snap = await getDocs(collection(db, "usuarios"));
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

btnAgregarUsuario?.addEventListener("click", async () => {
  try{
    const nombre = (nombreUsuario.value || "").trim();
    if(!nombre) return toast("Escribe un nombre");
    await addDoc(collection(db, "usuarios"), { nombre });
    nombreUsuario.value="";
    toast("Usuario agregado");
    cargarUsuarios();
  }catch(e){
    console.error(e); toast("Error al agregar usuario");
  }
});

selectUsuarios?.addEventListener("change", () => {
  currentUserId = selectUsuarios.value;
  infoUsuario.textContent = "Usuario seleccionado: " + selectUsuarios.options[selectUsuarios.selectedIndex].text;
  suscribirEnfermedades(currentUserId);
});

// ===== Foto =====
btnTomarFoto?.addEventListener('click', () => foto.click());

foto?.addEventListener('change', () => {
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

btnQuitarFoto?.addEventListener('click', () => {
  selectedFile = null;
  foto.value = "";
  previewImg.src = "";
  preview.classList.remove('has-img');
  preview.classList.add('empty');
  btnQuitarFoto.disabled = true;
});

// ===== Enfermedad =====
btnRegistrarEnfermedad?.addEventListener('click', async () => {
  if(!currentUserId) return toast("Selecciona un usuario");
  const enf = (nombreEnfermedad.value || "").trim();
  const sin = (sintomas.value || "").trim();
  if(!enf) return toast("Escribe la enfermedad");

  try{
    let fotoURL = "";
    if(selectedFile){
      const blob = await compressImage(selectedFile);
      const filename = `fotos/${Date.now()}-${(selectedFile.name||'foto')}.jpg`;
      const storageRef = ref(storage, filename);
      const uploadTask = uploadBytesResumable(storageRef, blob);

      progress.hidden = false; progressBar.style.width = "0%";

      await new Promise((resolve, reject)=>{
        uploadTask.on('state_changed', (snap)=>{
          const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
          progressBar.style.width = pct.toFixed(0) + "%";
        }, reject, async ()=>{
          fotoURL = await getDownloadURL(uploadTask.snapshot.ref);
          resolve();
        });
      });
      progress.hidden = true;
    }

    await addDoc(collection(db, `usuarios/${currentUserId}/enfermedades`), {
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

function suscribirEnfermedades(userId){
  try{
    if(unsub) unsub();
    emptyState.style.display = 'none';
    tablaCuerpo.innerHTML = "<tr><td colspan='5' class='muted'>Cargando…</td></tr>";
    const q = query(collection(db, `usuarios/${userId}/enfermedades`), orderBy("fecha","desc"));
    unsub = onSnapshot(q, (snap)=>{
      tablaCuerpo.innerHTML = "";
      if(snap.empty){
        emptyState.style.display = 'block';
        return;
      }
      snap.forEach(d=>{
        const data = d.data();
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
              const url = new URL(data.fotoURL);
              const path = decodeURIComponent(url.pathname.split('/o/')[1]);
              const refPath = path.split('?')[0];
              await deleteObject(ref(storage, refPath));
            }catch(e){ /* ignore */ }
          }
          await deleteDoc(doc(db, `usuarios/${userId}/enfermedades/${d.id}`));
          toast("Eliminado");
        });
        tablaCuerpo.appendChild(tr);
      });
    }, (err)=>{
      console.error(err);
      toast("No se pudo leer historial (reglas Firestore).");
    });
  }catch(e){
    console.error(e); toast("Error al suscribirse al historial.");
  }
}

// Boot
cargarUsuarios();
