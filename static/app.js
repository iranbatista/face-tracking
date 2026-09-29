// app.js — frontend sem framework. Três abas que conversam com a API em /api.
// Toda a "inteligência" está no backend; aqui só enviamos arquivos, desenhamos
// retângulos sobre as fotos e visualizamos scores.

const $ = (sel) => document.querySelector(sel);

const state = {
  eventId: null,
  events: [],
  threshold: 0.40,
  queryId: null,      // id da selfie já processada no servidor (cache do embedding)
  selfieBlob: null,   // guardamos a selfie para reenviar se o servidor reiniciar
  selfieUrl: null,
  result: null,       // última resposta de /api/search (usada por Participante e Debug)
};

// ------------------------------------------------------------ utilidades --

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* não-JSON */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") Object.assign(node.style, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  // textContent (nunca innerHTML) para nomes de arquivo: evita injeção de HTML
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(c));
  return node;
}

const pct = (s) => `${Math.round(s * 100)}%`;
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

/** Desenha retângulos sobre uma imagem. As bboxes vêm em pixels da foto
 *  ORIGINAL; convertendo para % elas servem para thumb, selfie e modal. */
function drawBoxes(layer, boxes, w, h) {
  layer.replaceChildren(...boxes.map(({ bbox: [x1, y1, x2, y2], other }) =>
    el("div", {
      class: other ? "facebox other" : "facebox",
      style: {
        left: `${(x1 / w) * 100}%`, top: `${(y1 / h) * 100}%`,
        width: `${((x2 - x1) / w) * 100}%`, height: `${((y2 - y1) / h) * 100}%`,
      },
    })));
}

/** Usa a thumbnail como background e dá zoom no rosto (recorte quadrado com
 *  margem). Tudo em %, então não depende do tamanho do elemento. */
function faceCrop(node, m) {
  const [x1, y1, x2, y2] = m.bbox;
  const W = m.width, H = m.height;
  const side = Math.min(Math.max(x2 - x1, y2 - y1) * 1.5, W, H);
  const clamp = (v, max) => Math.max(0, Math.min(v, max));
  const sx = clamp((x1 + x2) / 2 - side / 2, W - side);
  const sy = clamp((y1 + y2) / 2 - side / 2, H - side);
  Object.assign(node.style, {
    backgroundImage: `url(/api/photos/${m.photo_id}/thumb)`,
    backgroundSize: `${(W / side) * 100}% ${(H / side) * 100}%`,
    backgroundPosition: `${W > side ? (sx / (W - side)) * 100 : 0}% ${H > side ? (sy / (H - side)) * 100 : 0}%`,
  });
}

// ---------------------------------------------------------------- abas ----

function showTab(name) {
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.tab === name)));
  document.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = p.id !== `tab-${name}`));
  if (name === "photographer") refreshStats();
  if (name === "debug") renderDebug();
  try { localStorage.setItem("tab", name); } catch { /* storage bloqueado */ }
}
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));

// ------------------------------------------------------------- eventos ----

async function loadEvents(selectId) {
  state.events = await api("/api/events");
  const sel = $("#event-select");
  sel.replaceChildren(...state.events.map((e) =>
    el("option", { value: e.id }, `${e.name} (${e.n_photos} fotos)`)));
  if (!state.events.length) {
    sel.append(el("option", { value: "" }, "Crie um evento"));
    state.eventId = null;
  } else {
    const keep = selectId ?? state.eventId;
    state.eventId = state.events.some((e) => e.id === keep) ? keep : state.events[0].id;
    sel.value = state.eventId;
  }
  const ev = state.events.find((e) => e.id === state.eventId);
  $("#ph-event-name").textContent = ev ? ev.name : "Nenhum evento";
  refreshStats();
}

$("#event-select").addEventListener("change", (e) => {
  state.eventId = Number(e.target.value) || null;
  try { localStorage.setItem("event", state.eventId); } catch { /* ok */ }
  clearSearch();
  loadEvents(state.eventId);
});

$("#new-event-btn").addEventListener("click", () => {
  $("#new-event-form").hidden = false;
  $("#new-event-name").focus();
});
$("#new-event-cancel").addEventListener("click", () => ($("#new-event-form").hidden = true));
$("#new-event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#new-event-name").value.trim();
  if (!name) return;
  const ev = await api("/api/events", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
  });
  $("#new-event-name").value = "";
  $("#new-event-form").hidden = true;
  clearSearch();
  await loadEvents(ev.id);
  showTab("photographer");
});

async function refreshStats() {
  if (!state.eventId) return;
  const s = await api(`/api/stats?event_id=${state.eventId}`);
  $("#st-photos").textContent = s.done;
  $("#st-faces").textContent = s.faces;
  $("#st-avg").textContent = s.avg_ms_per_photo ? fmtMs(s.avg_ms_per_photo) : "–";
  $("#st-pending").textContent = s.pending;
}

// ------------------------------------------------ fotógrafo: upload ------

const dz = $("#dropzone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("over");
  handleFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
});
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") $("#file-input").click(); });
$("#file-input").addEventListener("change", (e) => { handleFiles([...e.target.files]); e.target.value = ""; });

/** Cada arquivo tem uma linha na lista com barra própria.
 *  0–50% = upload dos bytes, 50–100% = indexação no servidor. */
function makeRow(file) {
  const fill = el("div", { class: "bar-fill" });
  const stateEl = el("span", { class: "state" }, "aguardando");
  const li = el("li", {}, el("span", { class: "name", title: file.name }, file.name),
    el("div", { class: "bar" }, fill), stateEl);
  $("#upload-list").prepend(li);
  return {
    set(text, cls = "", progress = null, working = false) {
      stateEl.textContent = text;
      stateEl.className = `state ${cls}`;
      if (progress !== null) fill.style.width = `${progress * 100}%`;
      fill.classList.toggle("working", working);
      fill.classList.toggle("done", cls === "ok" || cls === "dup");
    },
    finished: false,
  };
}

function uploadOne(file, row) {
  // XMLHttpRequest (e não fetch) porque só ele reporta progresso de upload.
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append("files", file);
    xhr.open("POST", `/api/events/${state.eventId}/photos`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) row.set(`enviando ${pct(e.loaded / e.total)}`, "", (e.loaded / e.total) * 0.5);
    };
    xhr.onload = () => {
      try { resolve(xhr.status === 200 ? JSON.parse(xhr.responseText)[0] : { status: "error", error: `HTTP ${xhr.status}` }); }
      catch { resolve({ status: "error", error: "resposta inválida" }); }
    };
    xhr.onerror = () => resolve({ status: "error", error: "falha de rede" });
    xhr.send(fd);
  });
}

function describe(item, row) {
  if (item.duplicate && item.status === "done") {
    row.set(`já indexada, ${item.n_faces} ${item.n_faces === 1 ? "rosto" : "rostos"}`, "dup", 1);
  } else if (item.status === "done") {
    row.set(`${item.n_faces} ${item.n_faces === 1 ? "rosto" : "rostos"}, ${fmtMs(item.proc_ms)}`, "ok", 1);
  } else if (item.status === "error") {
    row.set(item.error || "erro", "err", 1);
  } else if (item.status === "processing") {
    row.set("detectando rostos…", "", 0.75, true);
  } else {
    row.set("na fila", "", 0.5);
  }
  row.finished = item.status === "done" || item.status === "error";
}

async function handleFiles(files) {
  if (!files.length) return;
  if (!state.eventId) { alert("Crie um evento primeiro."); return; }
  const eventId = state.eventId;
  $("#batch").hidden = false;
  const rows = files.map(makeRow);
  const byId = new Map();   // photo_id -> row, para o SSE atualizar a linha certa

  const updateTotal = () => {
    const done = rows.filter((r) => r.finished).length;
    $("#batch-bar").style.width = `${(done / rows.length) * 100}%`;
    $("#batch-bar").classList.toggle("done", done === rows.length);
    $("#batch-count").textContent = `${done} de ${rows.length}`;
    $("#batch-label").textContent = done === rows.length ? "Pronto" : "Indexando";
  };
  updateTotal();

  // Envia 3 arquivos por vez: rápido, sem abrir 200 conexões de uma vez.
  let next = 0;
  async function lane() {
    while (next < files.length) {
      const i = next++;
      const item = await uploadOne(files[i], rows[i]);
      describe(item, rows[i]);
      if (item.id && !rows[i].finished) byId.set(item.id, rows[i]);
      updateTotal();
    }
  }
  await Promise.all([lane(), lane(), lane()]);

  if (!byId.size) { refreshStats(); loadEvents(); return; }

  // Server-Sent Events: o servidor empurra o status até tudo terminar.
  const es = new EventSource(`/api/events/${eventId}/progress?ids=${[...byId.keys()].join(",")}`);
  es.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    for (const item of data.items) {
      const row = byId.get(item.id);
      if (row) describe(item, row);
    }
    updateTotal();
    refreshStats();
    if (data.done) {
      es.close(); // sem isso o EventSource reconecta sozinho quando o servidor fecha
      loadEvents();
    }
  };
  es.onerror = () => es.close();
}

// ------------------------------------------------- participante: busca ---

function clearSearch() {
  state.queryId = null;
  state.result = null;
  galleryItems = [];
  $("#gallery").replaceChildren();
  $("#result-count").textContent = "";
  $("#zip-btn").disabled = true;
  $("#selfie-msg").textContent = "";
}

async function runSearch({ blob } = {}) {
  if (!state.eventId) { setMsg("Escolha um evento primeiro.", "err"); return; }
  const fd = new FormData();
  fd.append("event_id", state.eventId);
  fd.append("threshold", state.threshold);
  if (blob) fd.append("selfie", blob, "selfie.jpg");
  else fd.append("query_id", state.queryId);

  if (blob) setMsg("Procurando seu rosto…");
  try {
    const r = await api("/api/search", { method: "POST", body: fd });
    state.queryId = r.query_id;
    state.result = r;
    setMsg(r.selfie.warning || "", r.selfie.warning ? "warn" : "");
    renderParticipant();
    renderDebug();
  } catch (err) {
    // query_id esquecido (servidor reiniciou): reenvia a selfie guardada.
    if (err.status === 400 && !blob && state.selfieBlob) return runSearch({ blob: state.selfieBlob });
    setMsg(err.message, "err");
    if (blob) { state.result = null; renderParticipant(); renderDebug(); }
  }
}

function setMsg(text, cls = "") {
  const m = $("#selfie-msg");
  m.textContent = text;
  m.className = `msg ${cls}`;
}

function useSelfie(blob) {
  state.selfieBlob = blob;
  if (state.selfieUrl) URL.revokeObjectURL(state.selfieUrl);
  state.selfieUrl = URL.createObjectURL(blob);
  $("#selfie-img").src = state.selfieUrl;
  $("#selfie-empty").hidden = true;
  $("#selfie-view").hidden = false;
  $("#selfie-boxes").replaceChildren();
  stopCamera();
  runSearch({ blob });
}

$("#selfie-input").addEventListener("change", (e) => {
  if (e.target.files[0]) useSelfie(e.target.files[0]);
  e.target.value = "";
});
$("#debug-input").addEventListener("change", (e) => {
  if (e.target.files[0]) useSelfie(e.target.files[0]);
  e.target.value = "";
});

// Webcam: getUserMedia funciona em localhost/127.0.0.1 sem HTTPS.
let stream = null;
$("#cam-btn").addEventListener("click", async () => {
  if (stream) { stopCamera(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 960, facingMode: "user" } });
  } catch (err) {
    setMsg(`Não foi possível abrir a webcam: ${err.message}`, "err");
    return;
  }
  const v = $("#cam-video");
  v.srcObject = stream;
  v.hidden = false;
  $("#selfie-empty").hidden = true;
  $("#selfie-view").hidden = true;
  $("#cam-shot").hidden = false;
  $("#cam-btn").textContent = "Fechar webcam";
  $(".selfie-side").classList.add("cam-on");
});
$("#cam-shot").addEventListener("click", () => {
  const v = $("#cam-video");
  const c = document.createElement("canvas");
  c.width = v.videoWidth;
  c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  c.toBlob((b) => useSelfie(b), "image/jpeg", 0.92);
});
function stopCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("#cam-video").hidden = true;
  $("#cam-shot").hidden = true;
  $("#cam-btn").textContent = "Usar webcam";
  $(".selfie-side").classList.remove("cam-on");
  if (!state.selfieUrl) $("#selfie-empty").hidden = false;
  else $("#selfie-view").hidden = false;
}

// Threshold: dois sliders (Participante e Debug) sincronizados.
const researchSoon = debounce(() => { if (state.queryId) runSearch(); }, 150);
function setThreshold(v) {
  state.threshold = Number(v);
  for (const id of ["thr", "thr-debug"]) $(`#${id}`).value = v;
  $("#thr-out").textContent = state.threshold.toFixed(2);
  $("#thr-debug-out").textContent = state.threshold.toFixed(2);
  moveFinishLine();  // feedback imediato na régua, antes da resposta
  researchSoon();
}
$("#thr").addEventListener("input", (e) => setThreshold(e.target.value));
$("#thr-debug").addEventListener("input", (e) => setThreshold(e.target.value));

function renderParticipant() {
  const r = state.result;
  const gallery = $("#gallery");
  if (!r) { galleryItems = []; gallery.replaceChildren(); $("#result-count").textContent = ""; $("#zip-btn").disabled = true; return; }

  // selfie: rosto usado em âmbar, outros tracejados
  const s = r.selfie;
  drawBoxes($("#selfie-boxes"), s.all_bboxes.map((b, i) => ({ bbox: b, other: i > 0 })), s.width, s.height);

  const n = r.matches.length;
  $("#result-count").replaceChildren(
    el("b", {}, String(n)), ` ${n === 1 ? "foto encontrada" : "fotos encontradas"} de ${r.total_photos}`);
  $("#zip-btn").disabled = n === 0;

  if (!n) {
    galleryItems = [];
    gallery.replaceChildren(el("p", { class: "gallery-empty" },
      `Nenhuma foto passou de ${r.threshold.toFixed(2)}. Baixe a semelhança mínima ou tente uma selfie de frente, com boa luz.`));
    return;
  }
  layoutGallery(r.matches.map((m) => {
    const boxes = el("div");
    const card = el("button", { class: "card", type: "button", onclick: () => openModal(m) },
      el("div", { class: "frame" },
        el("img", { src: `/api/photos/${m.photo_id}/thumb`, alt: m.filename, loading: "lazy",
                    width: m.width, height: m.height }),
        boxes),
      el("span", { class: "bib" }, pct(m.score)));
    drawBoxes(boxes, [{ bbox: m.bbox }], m.width, m.height);
    return { card, ratio: m.height / m.width };
  }));
}

// Masonry: cada card vai para a coluna mais baixa até agora. Como sabemos a
// proporção de cada foto (width/height vêm da API), dá para calcular a altura
// ANTES da imagem carregar: nada pula na tela. E a ordem por score continua
// lendo da esquerda para a direita, de cima para baixo (CSS `columns` leria
// a coluna 1 inteira antes da 2, bagunçando o ranking).
let galleryItems = [];
function galleryColumns() {
  const w = $("#gallery").clientWidth || window.innerWidth;
  return w < 600 ? 2 : Math.max(2, Math.floor(w / 240));
}
function layoutGallery(items = galleryItems) {
  galleryItems = items;
  const n = galleryColumns();
  const cols = Array.from({ length: n }, () => el("div", { class: "gallery-col" }));
  const heights = new Array(n).fill(0);
  for (const { card, ratio } of items) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].append(card);
    heights[i] += ratio + 0.04; // 0.04 ≈ o gap, em "larguras de coluna"
  }
  $("#gallery").replaceChildren(...cols);
  $("#gallery").dataset.cols = n;
}
window.addEventListener("resize", debounce(() => {
  // só refaz se o número de colunas mudou (resize contínuo não recria DOM)
  if (galleryItems.length && Number($("#gallery").dataset.cols) !== galleryColumns()) layoutGallery();
}, 150));

$("#zip-btn").addEventListener("click", () => {
  const ids = state.result.matches.map((m) => m.photo_id).join(",");
  window.location.href = `/api/zip?ids=${ids}`;
});

// --------------------------------------------------------------- modal ---

let modalToken = 0;
function openModal(m) {
  const img = $("#modal-img");
  // Abre na hora com a thumbnail (já está em cache) e troca pela original
  // quando ela terminar de baixar. Mesma proporção => retângulos não mudam.
  // O token evita que uma original atrasada apareça no modal de outra foto.
  const token = ++modalToken;
  img.src = `/api/photos/${m.photo_id}/thumb`;
  img.width = m.width;
  img.height = m.height;
  img.alt = m.filename;
  const full = new Image();
  full.onload = () => { if (token === modalToken) img.src = full.src; };
  full.src = `/api/photos/${m.photo_id}/full`;

  drawBoxes($("#modal-boxes"), [{ bbox: m.bbox }], m.width, m.height);
  $("#modal-score").textContent = `${pct(m.score)} de semelhança`;
  $("#modal-caption").textContent = `${m.filename} (${m.score.toFixed(3)})`;
  $("#modal-caption").title = m.filename;
  $("#modal-download").href = `/api/photos/${m.photo_id}/full?download=1`;
  document.body.classList.add("modal-open");
  $("#modal").showModal();
}
const closeModal = () => $("#modal").close();
$("#modal-close").addEventListener("click", closeModal);
// fechar ao tocar fora da foto: no backdrop (desktop) ou no palco vazio (celular)
$("#modal").addEventListener("click", (e) => {
  if (e.target.id === "modal" || e.target.id === "modal-stage") closeModal();
});
// "close" dispara também com Esc / gesto de voltar
$("#modal").addEventListener("close", () => document.body.classList.remove("modal-open"));

// --------------------------------------------------------------- debug ---

const STAGES = [
  ["decode", "Ler a imagem", "#5b7285"],
  ["resize", "Redimensionar", "#8ea3b3"],
  ["detection", "Detecção (SCRFD)", "#ffb020"],
  ["embedding", "Embedding (ArcFace)", "#5fd39a"],
  ["search", "Busca no índice (FAISS)", "#eef1f3"],
];

// Converte score (0..1) em posição horizontal na régua, com 20px de margem
// de cada lado para os rostos nas pontas não serem cortados.
const rulerX = (score) => `calc(20px + (100% - 40px) * ${Math.max(0, Math.min(1, score))})`;

function moveFinishLine() {
  const line = $("#ruler .finish-line");
  if (!line) return;
  const x = rulerX(state.threshold);
  line.style.left = x;
  line.querySelector("span").textContent = `corte ${state.threshold.toFixed(2)}`;
  $("#ruler .accepted").style.left = x;
  // recolore os pontos sem esperar o servidor
  document.querySelectorAll("#ruler .dot").forEach((d) =>
    d.classList.toggle("above", Number(d.dataset.score) > state.threshold));
}

function renderDebug() {
  const r = state.result;
  $("#debug-empty").hidden = !!r;
  $("#debug-body").hidden = !r;
  if (!r || $("#tab-debug").hidden) return;

  // Régua: cada rosto num x = score. Empilha em linhas para não se sobrepor.
  const ruler = $("#ruler");
  const widthPx = ruler.clientWidth || 800;
  const dot = widthPx < 600 ? 26 : 34;  // rosto menor no celular
  // Na mesma linha, rostos podem se sobrepor até ~40% (parecem fichas
  // empilhadas); mais que isso vira uma linha nova. Sem limite de linhas:
  // a régua cresce na altura em vez de amontoar rostos uns sobre os outros.
  const dotPct = ((dot * 0.6) / (widthPx - 40)) * 100;
  const rowsLastX = [];
  const dots = [...r.debug_top].sort((a, b) => a.score - b.score).map((m) => {
    const x = Math.max(0, Math.min(1, m.score)) * 100;
    let row = rowsLastX.findIndex((last) => x - last >= dotPct);
    if (row === -1) { row = rowsLastX.length; rowsLastX.push(x); } else rowsLastX[row] = x;
    const d = el("button", {
      class: "dot", type: "button", "data-score": m.score,
      title: `${m.score.toFixed(3)} — ${m.filename}`,
      "aria-label": `score ${m.score.toFixed(3)}, ${m.filename}`,
      style: { left: rulerX(m.score), top: `${36 + row * (dot + 3)}px` },
      onclick: () => openModal(m),
    });
    faceCrop(d, m);
    return d;
  });
  ruler.style.setProperty("--dot", `${dot}px`);
  ruler.style.height = `${36 + rowsLastX.length * (dot + 3) + 10}px`;
  ruler.replaceChildren(
    el("div", { class: "accepted" }),
    el("div", { class: "finish-line" }, el("span")),
    ...dots);
  moveFinishLine();

  // Tempos por etapa
  const t = r.timings_ms;
  const present = STAGES.filter(([k]) => t[k] !== undefined);
  const total = present.reduce((a, [k]) => a + t[k], 0) || 1;
  $("#timing-bar").replaceChildren(...present.map(([k, label, c]) =>
    el("div", { title: `${label}: ${t[k]} ms`, style: { width: `${(t[k] / total) * 100}%`, background: c } })));
  $("#timing-legend").replaceChildren(
    ...present.map(([k, label, c]) =>
      el("li", {}, el("span", { class: "sw", style: { background: c } }), label, el("span", { class: "ms" }, `${t[k]} ms`))),
    el("li", {}, el("span", { class: "sw" }), el("strong", {}, "Total"), el("span", { class: "ms" }, `${Math.round(total)} ms`)));
  if (r.timings_from_cache) {
    $("#timing-legend").append(el("li", { class: "hint" },
      "Nesta última busca só o FAISS rodou: o embedding da selfie veio do cache. Os outros tempos são de quando a selfie foi enviada."));
  }

  // Lista top 30
  $("#debug-list").replaceChildren(...r.debug_top.map((m, i) => {
    const crop = el("div", { class: "face-crop" });
    faceCrop(crop, m);
    return el("li", { class: m.score > state.threshold ? "above" : "", onclick: () => openModal(m), title: m.filename },
      crop,
      el("div", {},
        el("div", { class: "score" }, m.score.toFixed(3)),
        el("div", { class: "meta" }, `#${i + 1}, foto ${m.photo_id}`)));
  }));
}
window.addEventListener("resize", debounce(renderDebug, 200));

// ---------------------------------------------------------------- init ---

(async function init() {
  let savedEvent = null, savedTab = "photographer";
  try {
    savedEvent = Number(localStorage.getItem("event")) || null;
    savedTab = localStorage.getItem("tab") || savedTab;
  } catch { /* storage bloqueado: usa padrões */ }
  await loadEvents(savedEvent);
  showTab(savedTab);
})();
