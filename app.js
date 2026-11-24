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
const ORDEN_WUBRG = 'WUBRG';
// Scryfall no garantiza el orden: se muestran en el orden clásico de Magic (blanco, azul, negro, rojo, verde)
const textoColor = (cols) => (cols.length
  ? [...cols].sort((a, b) => ORDEN_WUBRG.indexOf(a) - ORDEN_WUBRG.indexOf(b)).map((c) => NOMBRES_COLOR[c]).join(' / ')
  : 'Incolora');

// ---------- Utilidades de interfaz ----------

const $ = (id) => document.getElementById(id);

// Cuánto se permite ampliar una imagen sobre sus píxeles reales antes de que se note borrosa
const ESCALA_MAX = 1.15;

/** Cambia la imagen principal; su tamaño se ajusta al cargar (ver listener de 'load'). */
function mostrarImagen(src, alt) {
  const img = $('arte');
  img.style.width = '';
  img.alt = alt;
  img.src = src;
}

// Tamaño en píxeles CSS = píxeles reales × ESCALA_MAX ÷ escalado de pantalla (Windows al 150 %, 4K…)
$('arte').addEventListener('load', (e) => {
  const img = e.target;
  img.style.width = `${(img.naturalWidth * ESCALA_MAX) / devicePixelRatio}px`;
});

// ---------- Constructor de búsqueda por campos ----------

/** Traduce los campos del formulario a una query de Scryfall. */
function construirQuery() {
  const partes = [];
  const tipo = $('f-tipo').value;
  if (tipo) partes.push(`t:${tipo}`);

  // El subtipo se escribe libre; se quitan comillas y se agrupa si tiene espacios
  const subtipo = $('f-subtipo').value.trim().replace(/"/g, '');
  if (subtipo) partes.push(/\s/.test(subtipo) ? `t:"${subtipo}"` : `t:${subtipo}`);

  const colores = [...document.querySelectorAll('.colores input:checked')].map((c) => c.value);
  if (colores.includes('c')) partes.push('c:c'); // incolora excluye a los demás colores
  else if (colores.length) partes.push(`c${$('f-color-modo').value}${colores.join('')}`);

  const coste = $('f-coste').value;
  if (coste !== '') partes.push(`mv${$('f-coste-op').value}${Number(coste)}`);

  const idioma = $('f-idioma').value;
  if (idioma) partes.push(`lang:${idioma}`);
  return partes.join(' ');
}

// ---------- Estado de la sesión ----------

const CATEGORIAS = ['nombre', 'color', 'edicion'];

// Iconos en SVG propio (la CSP no deja cargar fuentes de iconos externas)
const ICONOS = {
  nombre: {
    titulo: 'Nombre de la carta',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="17.5" text-anchor="middle" font-size="15" font-weight="800" font-family="Georgia, serif" fill="currentColor">Aa</text></svg>',
  },
  color: {
    titulo: 'Color de la carta',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<circle cx="12" cy="5" r="3.2" fill="#f8f3d6"/><circle cx="18.7" cy="9.9" r="3.2" fill="#3b8fd6"/>'
      + '<circle cx="16.1" cy="17.7" r="3.2" fill="#8a7f88"/><circle cx="7.9" cy="17.7" r="3.2" fill="#e0443a"/>'
      + '<circle cx="5.3" cy="9.9" r="3.2" fill="#2f9e5b"/></svg>',
  },
  edicion: {
    titulo: 'Edición de la carta',
    svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 8l10 5 10-5-10-5zM2 12l10 5 10-5M2 16l10 5 10-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  },
};

const ceroAciertos = () => ({ nombre: 0, color: 0, edicion: 0 });
const total = (j) => CATEGORIAS.reduce((s, c) => s + j.aciertos[c], 0);

const estado = {
  jugadores: [],          // [{ nombre, aciertos: { nombre, color, edicion } }]
  pool: [],               // cartas mezcladas de la lista actual
  indice: 0,
  cartas: 0,              // cartas mostradas en la partida (para el contador "Carta N")
  resueltas: 0,           // cartas resueltas: las que cuentan como jugadas en las estadísticas
  vistas: new Set(),      // ilustraciones ya mostradas (no se repiten en la sesión)
  marcas: new Set(),      // aciertos marcados en la carta actual: "jugador:categoria"
};

/**
 * Lee los nombres del cuadro de texto. Conserva los aciertos de quien ya estaba
 * (así se puede cambiar de lista o añadir a alguien sin perder el marcador).
 */
function actualizarJugadores(texto) {
  const nombres = [...new Set(texto.split('\n').map((n) => n.trim()).filter(Boolean))];
  const previos = new Map(estado.jugadores.map((j) => [j.nombre, j.aciertos]));
  estado.jugadores = nombres.map((nombre) => ({ nombre, aciertos: previos.get(nombre) ?? ceroAciertos() }));
}

function nuevaPartida() {
  estado.jugadores.forEach((j) => (j.aciertos = ceroAciertos()));
  estado.cartas = 0;
  estado.resueltas = 0;
  estado.marcas.clear();
}

// ---------- Interfaz ----------

function mostrarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach((p) => (p.hidden = p.id !== id));
  $('btn-reiniciar').hidden = !estado.jugadores.some((j) => total(j) > 0);
}

function pintarMarcador(sumado = -1) {
  const lista = $('marcador');
  lista.replaceChildren();
  const maximo = Math.max(...estado.jugadores.map(total));

  estado.jugadores.forEach((j, i) => {
    const li = document.createElement('li');
    li.className = 'jugador';
    if (maximo > 0 && total(j) === maximo) li.classList.add('lider');
    if (i === sumado) li.classList.add('sumado');

    const nombre = document.createElement('span');
    nombre.className = 'nombre';
    nombre.textContent = j.nombre;
    const puntos = document.createElement('span');
    puntos.className = 'puntos';
    puntos.textContent = total(j);

    // Un botón por categoría: se pulsa para dar el punto y otra vez para quitarlo (solo en esta carta)
    const aciertos = document.createElement('div');
    aciertos.className = 'aciertos';
    for (const cat of CATEGORIAS) {
      const b = document.createElement('button');
      b.className = `acierto ${cat}`;
      b.innerHTML = ICONOS[cat].svg; // contenido fijo del propio código, no datos externos
      b.dataset.jugador = i;
      b.dataset.cat = cat;
      b.dataset.tip = ICONOS[cat].titulo;
      const marcado = estado.marcas.has(`${i}:${cat}`);
      b.setAttribute('aria-pressed', marcado);
      b.setAttribute('aria-label', `${ICONOS[cat].titulo}: punto para ${j.nombre}`);
      aciertos.append(b);
    }
    li.append(nombre, puntos, aciertos);
    lista.append(li);
  });
}

function mostrarCarta() {
  const c = estado.pool[estado.indice];
  estado.vistas.add(c.ilustracion);
  estado.cartas++;
  estado.marcas.clear();
  pintarMarcador();
  $('pantalla-juego').classList.remove('resuelta');
  mostrarImagen(c.arte, 'Ilustración de la carta');
  $('artista').textContent = `Ilustración: ${c.artista}`;
  $('datos').hidden = true;
  $('btn-resolver').disabled = false;
  const quedan = estado.pool.length - estado.indice - 1;
  $('ronda').textContent = `Carta ${estado.cartas} · quedan ${quedan} en la lista`;
  $('btn-resolver').focus();

  // Precarga la siguiente ilustración para que en la tele no haya espera
  const siguiente = estado.pool[estado.indice + 1];
  if (siguiente) new Image().src = siguiente.arte;
}

function resolver() {
  const c = estado.pool[estado.indice];
  $('pantalla-juego').classList.add('resuelta');
  mostrarImagen(c.carta, `Carta completa: ${c.nombre}`);

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
  estado.resueltas++;
  $('btn-siguiente').focus();
}

function siguiente() {
  if (estado.indice + 1 >= estado.pool.length) {
    mostrarEstadisticas('Se ha acabado la lista.');
    return;
  }
  estado.indice++;
  mostrarCarta();
}

const NOMBRE_CAT = { nombre: 'Nombre', color: 'Color', edicion: 'Edición' };

/** Pantalla final: aciertos de cada uno por categoría, su fuerte y quién destaca en cada una. */
function mostrarEstadisticas(motivo = '') {
  const jugadores = [...estado.jugadores].sort((a, b) => total(b) - total(a));
  const tbody = $('tabla-estadisticas');
  tbody.replaceChildren();

  for (const j of jugadores) {
    const tr = document.createElement('tr');
    const celda = (texto, clase) => {
      const td = document.createElement('td');
      td.textContent = texto;
      if (clase) td.className = clase;
      tr.append(td);
    };
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = j.nombre;
    tr.append(th);

    const mejor = Math.max(...CATEGORIAS.map((c) => j.aciertos[c]));
    for (const cat of CATEGORIAS) celda(j.aciertos[cat], mejor > 0 && j.aciertos[cat] === mejor ? 'fuerte' : '');
    celda(total(j), 'total');
    const fuertes = CATEGORIAS.filter((c) => mejor > 0 && j.aciertos[c] === mejor).map((c) => NOMBRE_CAT[c]);
    celda(fuertes.length ? fuertes.join(' y ') : '—');
    tbody.append(tr);
  }

  // Quién ha acertado más en cada categoría (empates incluidos)
  const destacados = $('destacados');
  destacados.replaceChildren();
  for (const cat of CATEGORIAS) {
    const max = Math.max(0, ...estado.jugadores.map((j) => j.aciertos[cat]));
    if (!max) continue;
    const quienes = estado.jugadores.filter((j) => j.aciertos[cat] === max).map((j) => j.nombre);
    const li = document.createElement('li');
    li.innerHTML = ICONOS[cat].svg; // icono fijo
    li.append(` Más aciertos de ${NOMBRE_CAT[cat].toLowerCase()}: ${quienes.join(', ')} (${max})`);
    destacados.append(li);
  }

  $('resumen').textContent = `${motivo ? `${motivo} ` : ''}${estado.resueltas} cartas jugadas.`;
  $('btn-seguir').hidden = estado.indice + 1 >= estado.pool.length;
  mostrarPantalla('pantalla-estadisticas');
  $(($('btn-seguir').hidden ? 'btn-otra-lista' : 'btn-seguir')).focus();
}

function irAConfig(mensaje) {
  $('jugadores').value = estado.jugadores.map((j) => j.nombre).join('\n');
  $('estado').textContent = mensaje;
  mostrarPantalla('pantalla-config');
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
    const { cartas, total: totalScryfall } = await cargarPool(query, (n, t) => {
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
    if (cartas.length < totalScryfall) avisos.push(`limitada a ${cartas.length} de ${totalScryfall}`);
    if (nuevas.length < cartas.length) avisos.push(`${cartas.length - nuevas.length} ya vistas`);
    $('estado').textContent = `${nuevas.length} cartas${avisos.length ? ` (${avisos.join(', ')})` : ''}.`;

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
$('btn-terminar').addEventListener('click', () => mostrarEstadisticas());
$('btn-volver').addEventListener('click', () => irAConfig('El marcador se mantiene al cambiar de lista.'));

$('btn-seguir').addEventListener('click', () => {
  mostrarPantalla('pantalla-juego');
  siguiente();
});
$('btn-otra-lista').addEventListener('click', () => irAConfig('El marcador se mantiene al cambiar de lista.'));
$('btn-nueva').addEventListener('click', () => {
  nuevaPartida();
  irAConfig('Nueva partida: marcador a cero. Las cartas ya vistas no se repiten hasta recargar la página.');
});
$('btn-reiniciar').addEventListener('click', () => {
  nuevaPartida();
  irAConfig('Marcador a cero.');
});

// Panel de búsqueda por campos: se abre/cierra y enseña la query que generará
$('btn-filtros').addEventListener('click', () => {
  const abierto = $('filtros').hidden;
  $('filtros').hidden = !abierto;
  $('btn-filtros').setAttribute('aria-expanded', abierto);
  if (abierto) $('f-vista').textContent = construirQuery() || '(rellena algún campo)';
});
$('filtros').addEventListener('input', () => {
  $('f-vista').textContent = construirQuery() || '(rellena algún campo)';
});
$('btn-aplicar-filtros').addEventListener('click', () => {
  const query = construirQuery();
  if (!query) return;
  $('query').value = query;
  $('filtros').hidden = true;
  $('btn-filtros').setAttribute('aria-expanded', false);
  $('estado').textContent = 'Búsqueda lista. Pulsa Empezar.';
});

// Un único manejador para los botones de acierto: alterna el punto de esa categoría en esta carta
$('marcador').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cat]');
  if (!b) return;
  const i = Number(b.dataset.jugador);
  const cat = b.dataset.cat;
  const clave = `${i}:${cat}`;
  const marcar = !estado.marcas.has(clave);
  if (marcar) estado.marcas.add(clave);
  else estado.marcas.delete(clave);
  estado.jugadores[i].aciertos[cat] += marcar ? 1 : -1;
  pintarMarcador(marcar ? i : -1);
});
