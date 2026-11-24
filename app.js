'use strict';

// ---------- Scryfall ----------

const API = 'https://api.scryfall.com';
const PAUSA_MS = 100;      // Scryfall pide ~100 ms entre peticiones
const MAX_PAGINAS = 20;    // 175 cartas por página → tope de 3.500 cartas por pool

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga todas las páginas de una búsqueda (unique=art).
 * Devuelve las cartas ya normalizadas. Lanza Error con mensaje en castellano.
 */
async function cargarPool(query, alProgresar = () => {}) {
  let url = `${API}/cards/search?unique=art&q=${encodeURIComponent(query)}`;
  const cartas = [];
  let total = 0;

  for (let pagina = 1; url && pagina <= MAX_PAGINAS; pagina++) {
    if (pagina > 1) await esperar(PAUSA_MS);
    // Solo se sigue la paginación si apunta a la API de Scryfall
    if (!url.startsWith(`${API}/`)) throw new Error('Respuesta inesperada de Scryfall.');

    let resp;
    try {
      resp = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      throw new Error('No se ha podido conectar con Scryfall. ¿Hay conexión a internet?');
    }
    if (resp.status === 429) throw new Error('Scryfall pide esperar un poco. Prueba de nuevo en un minuto.');

    let json;
    try {
      json = await resp.json();
    } catch {
      throw new Error(`Scryfall ha respondido con un error (${resp.status}).`);
    }

    if (!resp.ok || json.object === 'error') {
      if (resp.status === 404) throw new Error('La búsqueda no ha devuelto ninguna carta.');
      throw new Error(`Scryfall: ${json.details || `error ${resp.status}`}`);
    }

    total = json.total_cards;
    for (const c of json.data) {
      const n = normalizar(c);
      if (n) cartas.push(n);
    }
    alProgresar(cartas.length, total);
    url = json.has_more ? json.next_page : null;
  }
  return { cartas, total };
}

/**
 * Aplana una carta de Scryfall a lo que necesita el juego.
 * Las de doble cara no traen image_uris/colors/printed_name en la raíz: se usa la primera cara.
 */
function normalizar(c) {
  const cara = c.card_faces ? c.card_faces[0] : null;
  const img = c.image_uris || cara?.image_uris;
  if (!img?.art_crop) return null; // sin ilustración no sirve para el juego

  return {
    id: c.id,
    nombre: c.name,
    nombreImpreso: c.printed_name || cara?.printed_name || null, // castellano con lang:es
    edicion: c.set_name,
    codigo: c.set.toUpperCase(),
    fecha: c.released_at,
    colores: c.colors || cara?.colors || [],
    artista: c.artist || cara?.artist || 'desconocido',
    arte: img.art_crop,
    carta: img.large || img.normal,
    textoAmbientacion: c.flavor_text || cara?.flavor_text || null, // para el modo 2
  };
}

// Fisher–Yates
function mezclar(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

const NOMBRES_COLOR = { W: 'Blanco', U: 'Azul', B: 'Negro', R: 'Rojo', G: 'Verde' };
const textoColor = (cols) => (cols.length ? cols.map((c) => NOMBRES_COLOR[c]).join(' / ') : 'Incolora');

// ---------- Interfaz (sprint 0: prueba de humo) ----------

const $ = (id) => document.getElementById(id);
const estado = { pool: [], indice: 0 };

function mostrarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach((p) => (p.hidden = p.id !== id));
}

function mostrarCarta() {
  const c = estado.pool[estado.indice];
  $('arte').src = c.arte;
  $('artista').textContent = `Ilustración: ${c.artista}`;
  $('datos').hidden = true;
  $('btn-resolver').disabled = false;
}

$('btn-cargar').addEventListener('click', async () => {
  const query = $('query').value.trim();
  if (!query) return;
  const boton = $('btn-cargar');
  boton.disabled = true;
  $('estado').textContent = 'Cargando…';
  try {
    const { cartas, total } = await cargarPool(query, (n, t) => {
      $('estado').textContent = `Cargando… ${n} / ${t}`;
    });
    if (!cartas.length) throw new Error('Ninguna carta tiene ilustración.');
    estado.pool = mezclar(cartas);
    estado.indice = 0;
    const aviso = cartas.length < total ? ` (limitado a ${cartas.length} de ${total})` : '';
    $('estado').textContent = `${cartas.length} cartas cargadas${aviso}.`;
    mostrarPantalla('pantalla-prueba');
    mostrarCarta();
  } catch (e) {
    $('estado').textContent = e.message;
  } finally {
    boton.disabled = false;
  }
});

$('btn-resolver').addEventListener('click', () => {
  const c = estado.pool[estado.indice];
  $('arte').src = c.carta;
  // Se construye con textContent: los datos vienen de fuera y no se interpretan como HTML
  const datos = $('datos');
  datos.replaceChildren();
  const nombre = document.createElement('strong');
  nombre.textContent = c.nombreImpreso || c.nombre;
  datos.append(nombre);
  if (c.nombreImpreso && c.nombreImpreso !== c.nombre) {
    const original = document.createElement('small');
    original.textContent = ` (${c.nombre})`;
    datos.append(original);
  }
  for (const linea of [`${c.edicion} · ${c.codigo} · ${c.fecha.slice(0, 4)}`, textoColor(c.colores)]) {
    datos.append(document.createElement('br'), linea);
  }
  datos.hidden = false;
  $('btn-resolver').disabled = true;
});

$('btn-siguiente').addEventListener('click', () => {
  // Sin repetir: se avanza por el pool mezclado; al final, se avisa
  if (estado.indice + 1 >= estado.pool.length) {
    $('estado').textContent = 'Se ha acabado el pool. Carga otra lista.';
    mostrarPantalla('pantalla-config');
    return;
  }
  estado.indice++;
  mostrarCarta();
});

$('btn-volver').addEventListener('click', () => mostrarPantalla('pantalla-config'));
