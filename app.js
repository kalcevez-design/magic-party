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
    // Identifica la ilustración aunque cambie la impresión: sirve para no repetir entre listas
    ilustracion: c.illustration_id || cara?.illustration_id || c.id,
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

// ---------- Estado de la sesión ----------

const estado = {
  jugadores: [],          // [{ nombre, puntos }]
  pool: [],               // cartas mezcladas de la lista actual
  indice: 0,
  ronda: 0,               // rondas jugadas en toda la sesión
  vistas: new Set(),      // ilustraciones ya mostradas (no se repiten en la sesión)
};

/**
 * Lee los nombres del cuadro de texto. Conserva los puntos de quien ya estaba
 * (así se puede cambiar de lista o añadir a alguien sin perder el marcador).
 */
function actualizarJugadores(texto) {
  const nombres = [...new Set(texto.split('\n').map((n) => n.trim()).filter(Boolean))];
  const previos = new Map(estado.jugadores.map((j) => [j.nombre, j.puntos]));
  estado.jugadores = nombres.map((nombre) => ({ nombre, puntos: previos.get(nombre) ?? 0 }));
}

// ---------- Interfaz ----------

const $ = (id) => document.getElementById(id);

function mostrarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach((p) => (p.hidden = p.id !== id));
  $('btn-reiniciar').hidden = !estado.jugadores.some((j) => j.puntos !== 0);
}

function pintarMarcador(sumado = -1) {
  const lista = $('marcador');
  lista.replaceChildren();
  const maximo = Math.max(...estado.jugadores.map((j) => j.puntos));

  estado.jugadores.forEach((j, i) => {
    const li = document.createElement('li');
    li.className = 'jugador';
    if (maximo > 0 && j.puntos === maximo) li.classList.add('lider');
    if (i === sumado) li.classList.add('sumado');

    const nombre = document.createElement('span');
    nombre.className = 'nombre';
    nombre.textContent = j.nombre;
    const puntos = document.createElement('span');
    puntos.className = 'puntos';
    puntos.textContent = j.puntos;

    const sumas = document.createElement('div');
    sumas.className = 'sumas';
    for (const n of [1, 2, 3, -1]) {
      const b = document.createElement('button');
      b.textContent = n > 0 ? `+${n}` : '−1';
      b.dataset.jugador = i;
      b.dataset.puntos = n;
      b.setAttribute('aria-label', `${n > 0 ? 'Sumar' : 'Restar'} ${Math.abs(n)} a ${j.nombre}`);
      if (n < 0) b.className = 'secundario restar';
      sumas.append(b);
    }
    li.append(nombre, puntos, sumas);
    lista.append(li);
  });
}

function mostrarCarta() {
  const c = estado.pool[estado.indice];
  estado.vistas.add(c.ilustracion);
  estado.ronda++;
  $('pantalla-juego').classList.remove('resuelta');
  $('arte').src = c.arte;
  $('arte').alt = 'Ilustración de la carta';
  $('artista').textContent = `Ilustración: ${c.artista}`;
  $('datos').hidden = true;
  $('btn-resolver').disabled = false;
  const quedan = estado.pool.length - estado.indice - 1;
  $('ronda').textContent = `Ronda ${estado.ronda} · quedan ${quedan} cartas en la lista`;
  $('btn-resolver').focus();

  // Precarga la siguiente ilustración para que en la tele no haya espera
  const siguiente = estado.pool[estado.indice + 1];
  if (siguiente) new Image().src = siguiente.arte;
}

function resolver() {
  const c = estado.pool[estado.indice];
  $('pantalla-juego').classList.add('resuelta');
  $('arte').src = c.carta;
  $('arte').alt = `Carta completa: ${c.nombre}`;

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
  $('btn-siguiente').focus();
}

function siguiente() {
  if (estado.indice + 1 >= estado.pool.length) {
    $('estado').textContent = 'Se ha acabado la lista. Elige otra para seguir; el marcador se mantiene.';
    mostrarPantalla('pantalla-config');
    $('query').select();
    return;
  }
  estado.indice++;
  mostrarCarta();
}

async function empezar() {
  const query = $('query').value.trim();
  actualizarJugadores($('jugadores').value);
  if (!query) return void ($('estado').textContent = 'Escribe una búsqueda de Scryfall.');
  if (!estado.jugadores.length) return void ($('estado').textContent = 'Añade al menos un jugador.');

  const boton = $('btn-cargar');
  boton.disabled = true;
  $('estado').textContent = 'Cargando…';
  try {
    const { cartas, total } = await cargarPool(query, (n, t) => {
      $('estado').textContent = `Cargando… ${n} / ${t}`;
    });
    // Fuera las ilustraciones ya vistas en la sesión (y duplicados dentro de la lista)
    const nuevas = [];
    const enLista = new Set();
    for (const c of cartas) {
      if (estado.vistas.has(c.ilustracion) || enLista.has(c.ilustracion)) continue;
      enLista.add(c.ilustracion);
      nuevas.push(c);
    }
    if (!nuevas.length) throw new Error('Ya habéis visto todas las cartas de esta lista. Prueba otra.');

    estado.pool = mezclar(nuevas);
    estado.indice = 0;
    const avisos = [];
    if (cartas.length < total) avisos.push(`limitada a ${cartas.length} de ${total}`);
    if (nuevas.length < cartas.length) avisos.push(`${cartas.length - nuevas.length} ya vistas`);
    $('estado').textContent = `${nuevas.length} cartas${avisos.length ? ` (${avisos.join(', ')})` : ''}.`;

    pintarMarcador();
    mostrarPantalla('pantalla-juego');
    mostrarCarta();
  } catch (e) {
    $('estado').textContent = e.message;
  } finally {
    boton.disabled = false;
  }
}

// ---------- Eventos ----------

$('btn-cargar').addEventListener('click', empezar);
$('btn-resolver').addEventListener('click', resolver);
$('btn-siguiente').addEventListener('click', siguiente);

$('btn-volver').addEventListener('click', () => {
  $('jugadores').value = estado.jugadores.map((j) => j.nombre).join('\n');
  $('estado').textContent = 'El marcador se mantiene al cambiar de lista.';
  mostrarPantalla('pantalla-config');
});

$('btn-reiniciar').addEventListener('click', () => {
  estado.jugadores.forEach((j) => (j.puntos = 0));
  $('estado').textContent = 'Marcador a cero.';
  mostrarPantalla('pantalla-config');
});

// Un único manejador para todos los botones de puntos del marcador
$('marcador').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-jugador]');
  if (!b) return;
  const i = Number(b.dataset.jugador);
  const n = Number(b.dataset.puntos);
  estado.jugadores[i].puntos = Math.max(0, estado.jugadores[i].puntos + n);
  pintarMarcador(n > 0 ? i : -1);
});
