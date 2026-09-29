// app.js — Foco. Frontend sem framework, três vistas que conversam com /api:
//   #galeria     página pública do evento: selfie -> fotos da pessoa
//   #estudio     fotógrafo: eventos, upload com progresso, folha de contato
//   #calibracao  onde fica a fronteira entre acerto e erro (top 30 + tempos)
//   #backoffice  admin: liga e desliga funcionalidades (ex.: a Calibração)
// Toda a "inteligência" está no backend; aqui enviamos arquivos, desenhamos
// os colchetes de foco sobre os rostos e visualizamos scores.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  view: null,
  eventId: null,
  events: [],
  threshold: 0.40,
  queryToken: null,   // embedding da selfie assinado pelo servidor: refaz a busca sem reenviar a foto
  selfieInfo: null,   // rosto usado na busca (só vem na resposta com selfie)
  firstTimings: null, // tempos da busca com selfie, reaproveitados na Calibração
  selfieBlob: null,   // guardada para reenviar se o servidor reiniciar
  selfieUrl: null,
  result: null,       // última resposta de /api/search (Galeria e Calibração)
  features: {},       // flags do backoffice (/api/features); vazio = tudo desligado
};

// ------------------------------------------------------------ utilidades --

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const d = (await res.json()).detail;
      if (typeof d === "string" && d) detail = d;  // 422 do pydantic vem como array
    } catch { /* não-JSON */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "class") node.className = v;
    else if (k === "style") Object.assign(node.style, v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  // textContent (nunca innerHTML) para nomes vindos do usuário: evita injeção de HTML
  for (const c of children) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(c));
  return node;
}

/** Ícone do sprite em index.html. */
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "ico");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

const pct = (s) => `${Math.round(s * 100)}%`;
const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(ms)} ms`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function fmtDate(ts) {
  // created_at vem do Postgres em ISO 8601 com fuso ("2026-09-29T00:49:24.123+00:00")
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}
function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}
let toastTimer;
function toast(text) {
  const t = $("#toast");
  t.replaceChildren(icon("check"), text);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

/** Colchetes de foco sobre os rostos. Bboxes vêm em pixels da foto ORIGINAL;
 *  convertendo para % servem para miniatura, galeria e tela cheia. */
function drawAF(layer, boxes, w, h) {
  layer.replaceChildren(...boxes.map(({ bbox: [x1, y1, x2, y2], other }) =>
    el("div", {
      class: other ? "af-box other" : "af-box",
      style: {
        left: `${(x1 / w) * 100}%`, top: `${(y1 / h) * 100}%`,
        width: `${((x2 - x1) / w) * 100}%`, height: `${((y2 - y1) / h) * 100}%`,
      },
    })));
}

/** Usa uma imagem como background e dá zoom no rosto (recorte quadrado).
 *  `pad` = quanto de margem em volta do rosto. Tudo em %, independe do tamanho. */
function faceCrop(node, { url, bbox: [x1, y1, x2, y2], width: W, height: H }, pad = 1.5) {
  const side = Math.min(Math.max(x2 - x1, y2 - y1) * pad, W, H);
  const clamp = (v, max) => Math.max(0, Math.min(v, max));
  const sx = clamp((x1 + x2) / 2 - side / 2, W - side);
  const sy = clamp((y1 + y2) / 2 - side / 2, H - side);
  Object.assign(node.style, {
    backgroundImage: `url(${url})`,
    backgroundSize: `${(W / side) * 100}% ${(H / side) * 100}%`,
    backgroundPosition: `${W > side ? (sx / (W - side)) * 100 : 0}% ${H > side ? (sy / (H - side)) * 100 : 0}%`,
  });
}
const thumbUrl = (id) => `/api/photos/${id}/thumb`;

/** Recorte guiado pelos rostos: a API manda o ponto de foco (fx, fy em 0..1,
 *  média dos centros dos rostos); `object-position` alinha o corte nele, e a
 *  miniatura cortada não decapita ninguém. */
const focusPos = (p) => `${((p.fx ?? 0.5) * 100).toFixed(1)}% ${((p.fy ?? 0.33) * 100).toFixed(1)}%`;

/** Imagem com duas resoluções: o navegador escolhe a miniatura (400px) ou a
 *  média (1600px) conforme o tamanho na tela e a densidade (tela retina). */
function photoImg(p, sizes, attrs = {}) {
  return el("img", {
    src: thumbUrl(p.id), srcset: `${thumbUrl(p.id)} 400w, /api/photos/${p.id}/medium 1600w`, sizes,
    alt: "", loading: "lazy", decoding: "async", style: { objectPosition: focusPos(p) }, ...attrs,
  });
}

// ----------------------------------------------------------- navegação ----
// Endereço = estado (o botão voltar do navegador funciona). Rotas:
//   #galeria           índice público de galerias
//   #galeria?e=3       galeria do evento 3, o link que o fotógrafo compartilha
//   #estudio           lista de eventos do fotógrafo
//   #estudio?e=3       gerenciar o evento 3
//   #calibracao?e=3    calibração com o evento 3 (só com a flag ligada)
//   #backoffice        funcionalidades (sem link na nav)

const ROUTES = { galeria: "gallery", estudio: "studio", calibracao: "lab", backoffice: "admin" };
const HASH_OF = { gallery: "galeria", studio: "estudio", lab: "calibracao", admin: "backoffice" };
const SECTIONS = {
  "gallery-index": "view-index", "gallery-event": "view-gallery",
  "studio-index": "view-studio-index", "studio-event": "view-studio", lab: "view-lab", admin: "view-backoffice",
};

const feature = (key) => state.features[key] === true;
async function loadFeatures() {
  try { state.features = (await api("/api/features")) ?? {}; } catch { state.features = {}; }
}
/** Links da nav que dependem de flag. */
function syncNav() {
  $('.nav a[data-nav="lab"]').hidden = !feature("calibration");
}

function parseHash() {
  const [name, query = ""] = location.hash.slice(1).split("?");
  return { area: ROUTES[name] || "gallery", eventId: Number(new URLSearchParams(query).get("e")) || null };
}
const hrefFor = (area, eventId) => `#${HASH_OF[area]}${eventId ? `?e=${eventId}` : ""}`;
function go(area, eventId = null) {
  const h = hrefFor(area, eventId);
  if (location.hash === h) route(); else location.hash = h;   // hashchange chama route()
}

/** Troca o evento "aberto". A busca é por evento, então trocar de evento a limpa. */
function setEventId(id) {
  if (id === state.eventId) return;
  clearSearch();
  state.eventId = id;
  try { localStorage.setItem("event", id ?? ""); } catch { /* storage bloqueado */ }
}

function route() {
  const { area, eventId } = parseHash();
  // Calibração desligada no backoffice: a rota não existe. replaceState para o
  // voltar do navegador não cair de novo aqui.
  if (area === "lab" && !feature("calibration")) {
    history.replaceState(null, "", hrefFor("gallery"));
    return route();
  }
  let id = eventId;
  if (area === "lab") {
    // Calibração sempre precisa de um evento: o aberto por último ou o primeiro com fotos
    id = eventId ?? (currentEvent()?.n_done ? state.eventId : null) ?? state.events.find((e) => e.n_done)?.id ?? null;
    if (id && !eventId) history.replaceState(null, "", hrefFor("lab", id));
  }
  if (id) setEventId(id);

  const view = area === "lab" || area === "admin" ? area : `${area}-${id ? "event" : "index"}`;
  const changed = view !== state.view;
  state.view = view;
  document.body.dataset.view = view;
  syncNav();
  for (const [v, sectionId] of Object.entries(SECTIONS)) $(`#${sectionId}`).hidden = v !== view;
  $$(".nav a, .gear").forEach((a) => (a.dataset.nav === area
    ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (changed) window.scrollTo(0, 0);
  renderView();
}
window.addEventListener("hashchange", route);

function renderView() {
  if (state.view === "gallery-index") renderIndex();
  if (state.view === "gallery-event") renderGalleryEvent();
  if (state.view === "studio-index") renderStudioIndex();
  if (state.view === "studio-event") renderStudioEvent();
  if (state.view === "lab") { renderLabPicker(); renderDebug(); }
  if (state.view === "admin") renderBackoffice();
}

// ------------------------------------------------------------- eventos ----

const currentEvent = () => state.events.find((e) => e.id === state.eventId);

async function loadEvents() {
  state.events = await api("/api/events");
  renderView();
}

/** "13 de setembro de 2026" a partir de "2026-09-13" (data local, sem fuso). */
function fmtEventDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
}
/** Fatos do evento separados por filete: data | local | fotos. */
function factsEl(ev, { count = true, tag = "p", cls = "facts" } = {}) {
  const items = [
    ev.event_date ? el("span", {}, fmtEventDate(ev.event_date)) : null,
    ev.location ? el("span", {}, ev.location) : null,
    count ? el("span", {}, plural(ev.n_done, "foto", "fotos")) : null,
  ].filter(Boolean);
  return el(tag, { class: cls }, items.length ? el("span", { class: "facts-in" }, ...items) : null);
}
function fillFacts(node, ev, opts) { node.replaceChildren(...factsEl(ev, opts).childNodes); }

/** Mostra a miniatura (já em cache) na hora e troca pela versão maior quando
 *  ela chegar. `size`: "medium" (1600px, capa e visualizador) ou "full". */
const progressiveTokens = new WeakMap();
function loadProgressive(img, photoId, size = "medium") {
  const token = {};
  progressiveTokens.set(img, token);
  img.src = thumbUrl(photoId);
  const big = new Image();
  big.onload = () => { if (progressiveTokens.get(img) === token) img.src = big.src; };
  big.src = `/api/photos/${photoId}/${size}`;
}

// ---- galerias: índice público

// busca sem acento e sem caixa: "florianopolis" acha "Florianópolis"
const fold = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function renderIndex() {
  const published = state.events.filter((e) => e.n_done > 0);   // sem fotos não aparece para o público
  const q = fold($("#index-search").value.trim());
  const list = q ? published.filter((e) => fold(`${e.name} ${e.location}`).includes(q)) : published;
  $("#index-search-wrap").hidden = published.length < 4;          // busca só quando ajuda
  $("#index-grid").replaceChildren(...list.map((e) =>
    el("a", { class: "gal-card", href: hrefFor("gallery", e.id) },
      galCover(e.cover),
      el("div", { class: "gal-title" }, el("h2", { class: "display" }, e.name),
        el("span", { class: "gal-count" }, plural(e.n_done, "foto", "fotos"))),
      factsEl(e, { count: false }))));
  $("#index-empty").hidden = list.length > 0;
  $("#index-empty-text").textContent = published.length
    ? `Nenhuma galeria com “${$("#index-search").value.trim()}”. Tente o nome do evento ou a cidade.`
    : "Nenhuma galeria publicada ainda.";
}
$("#index-search").addEventListener("input", debounce(renderIndex, 120));

/** Capa do card: 1 foto, díptico (2) ou uma grande + duas empilhadas (3). */
function galCover(cover) {
  const photos = cover.slice(0, 3);
  const big = "(max-width: 820px) 100vw, 30vw", small = "(max-width: 820px) 40vw, 12vw";
  return el("div", { class: "gal-cover", "data-n": photos.length },
    ...photos.map((p, i) => el("div", { class: `gt gt-${"abc"[i]}` },
      photoImg(p, i === 0 && photos.length !== 2 ? big : small))));
}

// ---- galerias: um evento

function renderGalleryEvent() {
  const ev = currentEvent();
  $("#g-title").textContent = ev ? ev.name : "Galeria não encontrada";
  if (ev) fillFacts($("#g-meta"), ev); else $("#g-meta").replaceChildren();
  const cover = ev?.cover ?? [];
  const published = cover.length > 0;
  renderCollage(cover);
  $("#event-hero").classList.toggle("has-cover", published);
  $("#g-empty").hidden = published;
  $("#finder").hidden = !published;
  $("#results").hidden = !published || !state.result;
  if (galleryItems.length) layoutGallery();
  document.title = ev ? `${ev.name}, Foco` : "Foco";
}

/** Capa em mosaico. A composição depende de quantas fotos há (1 a 5): o CSS
 *  escolhe o desenho da grade por data-n; cada foto ocupa a área a, b, c... */
function renderCollage(cover) {
  const collage = $("#collage");
  const key = cover.map((p) => p.id).join(",");
  if (collage.dataset.key === key) return;      // mesma capa: não recria (nem reanima)
  collage.dataset.key = key;
  collage.dataset.n = cover.length;
  collage.replaceChildren(...cover.map((p, i) => {
    const img = el("img", { alt: "", decoding: "async", style: { objectPosition: focusPos(p) } });
    loadProgressive(img, p.id, "medium");
    return el("div", { class: `ct ct-${"abcde"[i]}`, style: { "--i": i } }, img);
  }));
}

// ---- estúdio: lista de eventos

let pollTimer;
function renderStudioIndex() {
  document.title = "Estúdio, Foco";
  $("#studio-empty").hidden = state.events.length > 0;
  $("#event-rows").hidden = !state.events.length;
  $("#event-rows").replaceChildren(...state.events.map((e) => {
    const status = e.n_pending
      ? el("span", { class: "status busy" }, `Indexando ${plural(e.n_pending, "foto", "fotos")}`)
      : e.n_done
        ? el("span", { class: "status live" }, "Na galeria")
        : el("span", { class: "status" }, "Sem fotos");
    return el("li", {}, el("a", { class: "event-row", href: hrefFor("studio", e.id) },
      // desktop: miniatura única ao lado do nome; celular: faixa com o mosaico do evento
      el("div", { class: "row-thumb" }, e.cover.length ? photoImg(e.cover[0], "88px") : icon("images")),
      el("div", { class: "row-banner" }, e.cover.length ? galCover(e.cover) : el("div", { class: "row-banner-empty" }, icon("images"), "Sem fotos ainda")),
      el("div", { class: "row-main" }, el("div", { class: "row-name" }, e.name), factsEl(e, { count: false })),
      el("div", { class: "row-fig fig-photos" }, el("b", {}, String(e.n_done)), e.n_done === 1 ? "foto" : "fotos"),
      el("div", { class: "row-fig fig-faces" }, el("b", {}, String(e.n_faces)), e.n_faces === 1 ? "rosto" : "rostos"),
      status,
      el("span", { class: "row-go" }, icon("chev-r"))));
  }));
  // enquanto houver fotos na fila, atualiza a lista sozinha
  clearTimeout(pollTimer);
  if (state.events.some((e) => e.n_pending)) pollTimer = setTimeout(() => state.view === "studio-index" && loadEvents(), 3000);
}

// ---- estúdio: um evento

function renderStudioEvent() {
  const ev = currentEvent();
  if (!ev) { $("#s-title").textContent = "Evento não encontrado"; $("#s-crumb").textContent = ""; return; }
  document.title = `${ev.name}, Estúdio, Foco`;
  $("#s-title").textContent = ev.name;
  $("#s-crumb").textContent = ev.name;
  fillFacts($("#s-meta"), ev, { count: false });
  if (!ev.event_date && !ev.location) {
    $("#s-meta").replaceChildren(el("span", { class: "facts-in" }, el("span", {}, `Criado em ${fmtDate(ev.created_at)}`)));
  }
  $("#view-public").href = hrefFor("gallery", ev.id);
  // o resumo de envio pertence ao evento que recebeu as fotos
  $("#batch").hidden = !upload.items.length || upload.eventId !== ev.id;
  refreshStats();
  loadSheet();
}

$("#copy-link").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}${hrefFor("gallery", state.eventId)}`;
  try { await navigator.clipboard.writeText(url); toast("Link da galeria copiado"); }
  catch { prompt("Copie o link da galeria:", url); }
});

async function refreshStats() {
  if (!state.eventId) return;
  const s = await api(`/api/stats?event_id=${state.eventId}`);
  $("#st-photos").textContent = s.done;
  $("#st-faces").textContent = s.faces;
  $("#st-avg").textContent = s.avg_ms_per_photo ? fmtMs(s.avg_ms_per_photo) : "–";
  $("#st-pending").textContent = s.pending;
}

/** Folha de contato: miniaturas do evento com a contagem de rostos. */
async function loadSheet() {
  if (!state.eventId) return;
  const photos = await api(`/api/events/${state.eventId}/photos`);
  $("#sheet-empty").hidden = photos.length > 0;
  $("#sheet").replaceChildren(...photos.map((p) => p.status === "done"
    ? el("div", { class: "tile", title: p.filename },
        el("img", { src: thumbUrl(p.id), alt: p.filename, loading: "lazy", style: { objectPosition: focusPos(p) } }),
        el("span", { class: "faces", title: plural(p.n_faces, "rosto", "rostos") }, icon("face"), String(p.n_faces)))
    : el("div", { class: "tile pending", title: p.filename },
        p.status === "error" ? "Erro" : p.status === "processing" ? "Detectando" : "Na fila")));
}

// ---- diálogo: criar, editar e excluir evento

const dlg = $("#event-dialog");
let editing = null;      // evento sendo editado; null = criando um novo
let confirming = false;  // segunda etapa da exclusão

function openEventDialog(ev = null) {
  editing = ev;
  setConfirming(false);
  $("#ed-title").textContent = ev ? "Editar evento" : "Novo evento";
  $("#ed-name").value = ev?.name ?? "";
  $("#ed-date").value = ev?.event_date ?? "";
  $("#ed-location").value = ev?.location ?? "";
  $("#ed-delete").hidden = !ev;
  $("#ed-error").textContent = "";
  dlg.showModal();
  $("#ed-name").focus();
}
function setConfirming(on) {
  confirming = on;
  $("#ed-fields").hidden = on;
  $("#ed-confirm").hidden = !on;
  $("#ed-delete").hidden = on || !editing;
  $("#ed-submit").textContent = on ? "Excluir evento" : editing ? "Salvar" : "Criar evento";
  $("#ed-submit").classList.toggle("danger", on);
  $("#ed-submit").classList.toggle("primary", !on);
  if (on) {
    const n = editing.n_photos;
    $("#ed-confirm-text").textContent = `${n ? `As ${plural(n, "foto", "fotos")} de “${editing.name}” e os rostos encontrados nelas serão apagados deste servidor, e o link da galeria deixa de funcionar.` : `“${editing.name}” será apagado.`} Isso não pode ser desfeito.`;
  }
}

$("#new-event-btn").addEventListener("click", () => openEventDialog());
$$("[data-new-event]").forEach((b) => b.addEventListener("click", () => openEventDialog()));
$("#edit-event").addEventListener("click", () => openEventDialog(currentEvent()));
$("#ed-delete").addEventListener("click", () => setConfirming(true));
$("#ed-cancel").addEventListener("click", () => (confirming ? setConfirming(false) : dlg.close()));

$("#event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submit = $("#ed-submit");
  submit.disabled = true;
  try {
    if (confirming) {
      await api(`/api/events/${editing.id}`, { method: "DELETE" });
      dlg.close();
      setEventId(null);
      toast("Evento excluído");
      await loadEvents();
      go("studio");
      return;
    }
    const body = JSON.stringify({
      name: $("#ed-name").value, event_date: $("#ed-date").value || null, location: $("#ed-location").value,
    });
    const saved = await api(editing ? `/api/events/${editing.id}` : "/api/events", {
      method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body,
    });
    dlg.close();
    toast(editing ? "Evento salvo" : "Evento criado");
    await loadEvents();
    if (!editing) go("studio", saved.id);
  } catch (err) {
    $("#ed-error").textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});

// ---- calibração: seletor de evento

const picker = { btn: $("#lab-picker-btn"), list: $("#lab-picker-list") };
function renderLabPicker() {
  const ev = currentEvent();
  $("#lab-picker-value").textContent = ev ? ev.name : "Nenhum evento com fotos";
  picker.list.replaceChildren(...state.events.filter((e) => e.n_done).map((e) =>
    el("li", { role: "option", tabindex: "-1", "aria-selected": String(e.id === state.eventId), "data-id": e.id },
      el("span", {}, e.name), el("span", { class: "n" }, plural(e.n_done, "foto", "fotos")))));
}
function togglePicker(open = picker.list.hidden) {
  picker.list.hidden = !open;
  picker.btn.setAttribute("aria-expanded", String(open));
  if (open) (picker.list.querySelector('[aria-selected="true"]') || picker.list.firstElementChild)?.focus();
}
picker.btn.addEventListener("click", () => togglePicker());
picker.list.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  togglePicker(false);
  go("lab", Number(li.dataset.id));
});
picker.list.addEventListener("keydown", (e) => {
  const items = [...picker.list.children];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(i - 1, 0)]?.focus(); }
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.activeElement.click(); }
  if (e.key === "Escape") { togglePicker(false); picker.btn.focus(); }
});
document.addEventListener("click", (e) => { if (!e.target.closest("#lab-picker")) togglePicker(false); });

// ------------------------------------------------ estúdio: upload ------

const dz = $("#dropzone");
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
dz.addEventListener("dragleave", () => dz.classList.remove("over"));
dz.addEventListener("drop", (e) => {
  e.preventDefault();
  dz.classList.remove("over");
  handleFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
});
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#file-input").click(); } });
$("#file-input").addEventListener("change", (e) => { handleFiles([...e.target.files]); e.target.value = ""; });

// Sessão de envio: tudo que for solto até a fila esvaziar entra no MESMO
// resumo (soltar mais fotos no meio do envio não cria um segundo contador).
// Cada foto passa por: aguardando -> enviando -> na fila -> detectando -> pronta.
const upload = { items: [], queue: [], running: 0, byId: new Map(), es: null, eventId: null };
const FINAL = new Set(["done", "dup", "error"]);
const isFinal = (it) => FINAL.has(it.phase);
// quanto cada fase vale na barra geral (envio = primeira metade, indexação = segunda)
const PHASE_PROGRESS = { waiting: 0, queued: 0.5, processing: 0.75, done: 1, dup: 1, error: 1 };

function newItem(file) {
  const fill = el("div", { class: "bar-fill" });
  const stateEl = el("span", { class: "state" });
  const li = el("li", { class: "active" }, el("span", { class: "name", title: file.name }, file.name),
    stateEl, el("div", { class: "bar" }, fill));
  $("#upload-list").append(li);
  const it = { file, li, fill, stateEl, phase: "waiting", sent: 0, n_faces: 0, proc_ms: null, id: null, error: null };
  paintItem(it);
  return it;
}

function setItem(it, patch) {
  Object.assign(it, patch);
  paintItem(it);
  paintSummary();
}

function paintItem(it) {
  const faces = plural(it.n_faces, "rosto", "rostos");
  const [text, cls] = {
    waiting: ["Aguardando", ""],
    uploading: [`Enviando ${pct(it.sent)}`, ""],
    queued: ["Na fila", ""],
    processing: ["Detectando rostos", ""],
    done: [`${faces}, ${fmtMs(it.proc_ms ?? 0)}`, "ok"],
    dup: [`Já enviada, ${faces}`, "dup"],
    error: [it.error || "Erro", "err"],
  }[it.phase];
  it.stateEl.replaceChildren(...(cls === "ok" ? [icon("check")] : cls === "err" ? [icon("alert")] : []), text);
  it.stateEl.className = `state ${cls}`;
  // barra por linha só no que está acontecendo agora (envio ou detecção)
  it.li.classList.toggle("active", it.phase === "uploading" || it.phase === "processing");
  const p = it.phase === "uploading" ? it.sent * 0.5 : PHASE_PROGRESS[it.phase];
  it.fill.style.width = `${p * 100}%`;
  it.fill.classList.toggle("working", it.phase === "processing");
}

function fmtEta(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `cerca de ${Math.max(s, 5)} s restantes`;
  const m = Math.round(s / 60);
  return `cerca de ${m} min restante${m === 1 ? "" : "s"}`;
}

function paintSummary() {
  const items = upload.items;
  const n = (ph) => items.filter((it) => it.phase === ph).length;
  const counts = { done: n("done"), dup: n("dup"), error: n("error"), processing: n("processing"), queued: n("queued"),
    sending: n("uploading") + n("waiting") };
  const finished = counts.done + counts.dup + counts.error;
  const total = items.length;
  const allDone = finished === total;

  // barra geral: média do progresso de cada foto (anda suave, não aos saltos)
  const prog = items.reduce((a, it) => a + (it.phase === "uploading" ? it.sent * 0.5 : PHASE_PROGRESS[it.phase]), 0) / (total || 1);
  $("#batch-bar").style.width = `${prog * 100}%`;
  $("#batch-bar").classList.toggle("done", allDone && !counts.error);

  const label = $("#batch-label");
  label.textContent = allDone
    ? (counts.error ? `Pronto, ${plural(counts.error, "foto com erro", "fotos com erro")}` : "Pronto")
    : counts.sending ? "Enviando" : "Indexando";
  label.className = `status ${allDone ? (counts.error ? "err" : "live") : "busy"}`;
  $("#batch-count").textContent = `${finished} de ${plural(total, "foto", "fotos")}`;

  // rostos encontrados + estimativa: fotos restantes x tempo médio medido nesta sessão
  const faces = items.reduce((a, it) => a + (it.phase === "done" ? it.n_faces : 0), 0);
  const timed = items.filter((it) => it.phase === "done" && it.proc_ms);
  const avg = timed.length ? timed.reduce((a, it) => a + it.proc_ms, 0) / timed.length : null;
  const left = total - finished;
  $("#batch-extra").textContent = [
    counts.done ? plural(faces, "rosto encontrado", "rostos encontrados") : null,
    !allDone && avg && left ? fmtEta(left * avg) : null,
  ].filter(Boolean).join(", ");

  const tally = [
    ["done", "pronta", "prontas"], ["processing", "detectando", "detectando"], ["queued", "na fila", "na fila"],
    ["sending", "enviando", "enviando"], ["dup", "já enviada", "já enviadas"], ["error", "com erro", "com erro"],
  ].filter(([k]) => counts[k]).map(([k, one, many]) =>
    el("span", { class: k === "error" ? "err" : "" }, el("b", {}, String(counts[k])), ` ${counts[k] === 1 ? one : many}`));
  $("#batch-tally").replaceChildren(...tally);

  $("#batch-close").hidden = !allDone;
}

function toggleUploadList(open = $("#upload-list").hidden) {
  $("#upload-list").hidden = !open;
  $("#batch-toggle").setAttribute("aria-expanded", String(open));
  $("#batch-toggle span").textContent = open ? "Ocultar fotos" : "Ver fotos";
}
$("#batch-toggle").addEventListener("click", () => toggleUploadList());
$("#batch-close").addEventListener("click", () => resetUpload());

function resetUpload() {
  if (upload.es) upload.es.close();
  Object.assign(upload, { items: [], queue: [], running: 0, byId: new Map(), es: null, eventId: null });
  $("#upload-list").replaceChildren();
  toggleUploadList(false);
  $("#batch").hidden = true;
}

function handleFiles(files) {
  if (!files.length || !state.eventId) return;
  // sessão anterior terminada (ou de outro evento): começa um resumo novo
  if (upload.items.length && (upload.items.every(isFinal) || upload.eventId !== state.eventId)) resetUpload();
  upload.eventId = state.eventId;
  $("#batch").hidden = false;
  const items = files.map(newItem);
  upload.items.push(...items);
  upload.queue.push(...items);
  paintSummary();
  pump();
}

// até 3 envios ao mesmo tempo: rápido, sem abrir 200 conexões de uma vez
function pump() {
  while (upload.running < 3 && upload.queue.length) {
    const it = upload.queue.shift();
    upload.running++;
    sendItem(it, upload.eventId).finally(() => { upload.running--; pump(); });
  }
}

async function sendItem(it, eventId) {
  setItem(it, { phase: "uploading", sent: 0 });
  const r = await xhrUpload(it, eventId);
  if (!upload.items.includes(it)) return;   // resumo fechado no meio do envio
  if (r.duplicate) setItem(it, { phase: r.status === "done" ? "dup" : "queued", n_faces: r.n_faces, id: r.id });
  else if (r.status === "error") setItem(it, { phase: "error", error: r.error });
  else setItem(it, { phase: r.status === "done" ? "done" : r.status, id: r.id, n_faces: r.n_faces, proc_ms: r.proc_ms });
  if (it.id && !isFinal(it)) { upload.byId.set(it.id, it); watchSoon(); }
  if (upload.items.every(isFinal)) sessionFinished();
}

function xhrUpload(it, eventId) {
  // XMLHttpRequest (e não fetch) porque só ele reporta progresso de upload.
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append("files", it.file);
    xhr.open("POST", `/api/events/${eventId}/photos`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setItem(it, { sent: e.loaded / e.total }); };
    xhr.onload = () => {
      if (xhr.status === 413) return resolve({ status: "error", error: "Arquivo grande demais" });
      try { resolve(xhr.status === 200 ? JSON.parse(xhr.responseText)[0] : { status: "error", error: `Erro ${xhr.status}` }); }
      catch { resolve({ status: "error", error: "Resposta inválida" }); }
    };
    xhr.onerror = () => resolve({ status: "error", error: "Falha de conexão" });
    xhr.send(fd);
  });
}

// Server-Sent Events com TODAS as fotos ainda pendentes. Quando entram fotos
// novas na sessão, reabre o stream com a lista atualizada (agrupando em 300ms).
const sheetSoon = debounce(loadSheet, 800);
const statsSoon = debounce(refreshStats, 500);
const watchSoon = debounce(() => {
  if (upload.es) upload.es.close();
  const ids = [...upload.byId.values()].filter((it) => !isFinal(it)).map((it) => it.id);
  if (!ids.length) return;
  const es = new EventSource(`/api/events/${upload.eventId}/progress?ids=${ids.join(",")}`);
  upload.es = es;
  es.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    for (const p of data.items) {
      const it = upload.byId.get(p.id);
      if (!it || isFinal(it)) continue;
      setItem(it, p.status === "error"
        ? { phase: "error", error: p.error || "Erro ao processar" }
        : { phase: p.status, n_faces: p.n_faces, proc_ms: p.proc_ms });
    }
    statsSoon();
    sheetSoon();
    if (data.done) {                 // sem close o EventSource reconecta sozinho
      es.close();
      if (upload.es === es) upload.es = null;
      if (upload.items.every(isFinal)) sessionFinished();
    }
  };
  es.onerror = () => es.close();
}, 300);

function sessionFinished() {
  paintSummary();
  // deu erro em alguma foto: abre a lista com as fotos com erro no topo
  const failed = upload.items.filter((it) => it.phase === "error");
  if (failed.length) {
    $("#upload-list").prepend(...failed.map((it) => it.li));
    toggleUploadList(true);
    $("#upload-list").scrollTop = 0;
  }
  refreshStats();
  loadSheet();
  loadEvents();
}

// ------------------------------------------------ galeria: busca -------

const vf = $("#viewfinder");

function clearSearch() {
  state.queryToken = null;
  state.selfieInfo = null;
  state.firstTimings = null;
  state.result = null;
  galleryItems = [];
  $("#gallery").replaceChildren();
  $("#results").hidden = true;
  setMsg("");
}

function setMsg(text, cls = "") {
  const m = $("#selfie-msg");
  m.textContent = text;
  m.className = `msg ${cls}`;
}

/** O visor mostra: silhueta (vazio) | câmera | selfie inteira (procurando) | rosto recortado (achou). */
function setViewfinder(mode) {
  $("#vf-empty").hidden = mode !== "empty";
  $("#cam-video").hidden = mode !== "cam";
  $("#vf-face").hidden = !(mode === "searching" || mode === "face");
  vf.classList.toggle("cam", mode === "cam");
  vf.classList.toggle("face", mode === "searching" || mode === "face");
  vf.classList.toggle("searching", mode === "searching");
  vf.classList.remove("locked");
  if (mode === "face") {
    void vf.offsetWidth;          // reinicia a animação de "trava de foco"
    vf.classList.add("locked");
  }
}

async function runSearch({ blob } = {}) {
  if (!state.eventId) return;
  const fd = new FormData();
  fd.append("event_id", state.eventId);
  fd.append("threshold", state.threshold);
  if (blob) fd.append("selfie", blob, "selfie.jpg");
  else fd.append("query_token", state.queryToken);

  if (blob) setMsg("Procurando você nas fotos do evento");
  try {
    const r = await api("/api/search", { method: "POST", body: fd });
    state.queryToken = r.query_token;
    // A busca pelo token não traz a selfie nem os tempos da detecção: reaproveita os da primeira.
    if (r.selfie) {
      state.selfieInfo = r.selfie;
      state.firstTimings = r.timings_ms ?? null;
    } else {
      r.selfie = state.selfieInfo;
      if (r.timings_ms && state.firstTimings) r.timings_ms = { ...state.firstTimings, search: r.timings_ms.search };
    }
    state.result = r;
    // Desligaram a Calibração com a página aberta: a resposta veio sem o top 30.
    // Termina de desenhar a busca e só então sai da rota.
    let healed = false;
    if (!r.debug_top && feature("calibration")) {
      state.features = { ...state.features, calibration: false };
      syncNav();
      healed = true;
    }
    if (blob) {
      // recorta a selfie no rosto usado na busca e "trava o foco" nele
      faceCrop($("#vf-face"), { url: state.selfieUrl, ...r.selfie }, 1.9);
      setViewfinder("face");
      setMsg(r.selfie.warning ? `${r.selfie.n_faces} rostos na selfie. Usamos o maior.` : "", r.selfie.warning ? "warn" : "");
    }
    renderGallery();
    renderDebug();
    if (healed && state.view === "lab") route();
  } catch (err) {
    // token expirado (410): reenvia a selfie guardada.
    if (err.status === 410 && !blob && state.selfieBlob) return runSearch({ blob: state.selfieBlob });
    if (blob) {
      state.result = null;
      setViewfinder("searching");
      vf.classList.remove("searching");
      renderGallery();
      renderDebug();
    }
    setMsg(err.status === 422 ? "Não encontramos um rosto nesta foto. Tente de frente, com mais luz." : err.message, "err");
  }
}

function useSelfie(blob) {
  state.selfieBlob = blob;
  if (state.selfieUrl) URL.revokeObjectURL(state.selfieUrl);
  state.selfieUrl = URL.createObjectURL(blob);
  stopCamera();
  // enquanto procura, mostra a selfie inteira com os colchetes "caçando" o foco
  Object.assign($("#vf-face").style, {
    backgroundImage: `url(${state.selfieUrl})`, backgroundSize: "cover", backgroundPosition: "center",
  });
  setViewfinder("searching");
  runSearch({ blob });
}

$("#selfie-input").addEventListener("change", (e) => { if (e.target.files[0]) useSelfie(e.target.files[0]); e.target.value = ""; });
$("#debug-input").addEventListener("change", (e) => { if (e.target.files[0]) useSelfie(e.target.files[0]); e.target.value = ""; });

// Câmera: getUserMedia exige HTTPS (ou localhost).
let stream = null;
$("#cam-btn").addEventListener("click", async () => {
  if (stream) { stopCamera(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 960, facingMode: "user" } });
  } catch (err) {
    setMsg(`Não foi possível abrir a câmera. ${err.name === "NotAllowedError" ? "Permita o acesso no navegador." : err.message}`, "err");
    return;
  }
  $("#cam-video").srcObject = stream;
  setViewfinder("cam");
  $("#cam-shot").hidden = false;
  $("#cam-btn span").textContent = "Fechar câmera";
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
  const wasOn = !!stream;
  stream = null;
  $("#cam-shot").hidden = true;
  $("#cam-btn span").textContent = "Usar a câmera";
  if (wasOn && !state.selfieUrl) setViewfinder("empty");
  else if (wasOn && state.result) setViewfinder("face");
}

// Precisão (Galeria) e corte (Calibração): o mesmo threshold, dois controles.
const precisionWord = (t) => (t < 0.32 ? "Ampla" : t <= 0.48 ? "Equilibrada" : "Rigorosa");
function paintRange(input) {
  const { min, max, value } = input;
  input.style.setProperty("--p", `${((value - min) / (max - min)) * 100}%`);
}
const researchSoon = debounce(() => { if (state.queryToken) runSearch(); }, 150);
function setThreshold(v) {
  state.threshold = Number(v);
  for (const id of ["thr", "thr-debug"]) { $(`#${id}`).value = v; paintRange($(`#${id}`)); }
  $("#thr-word").textContent = precisionWord(state.threshold);
  $("#thr-debug-out").textContent = state.threshold.toFixed(2);
  moveCutLine();  // feedback imediato na régua, antes da resposta
  researchSoon();
}
$("#thr").addEventListener("input", (e) => setThreshold(e.target.value));
$("#thr-debug").addEventListener("input", (e) => setThreshold(e.target.value));

function renderGallery() {
  const r = state.result;
  $("#results").hidden = !r;
  if (!r) { galleryItems = []; $("#gallery").replaceChildren(); return; }

  const n = r.matches.length;
  $("#result-count").replaceChildren(
    n ? plural(n, "foto com você", "fotos com você") : "Nenhuma foto encontrada",
    " ", el("span", { class: "of" }, `de ${r.total_photos} no evento`));
  $("#zip-btn").disabled = n === 0;

  if (!n) {
    galleryItems = [];
    $("#gallery").replaceChildren(el("p", { class: "gallery-empty" },
      "Nenhuma foto passou do nível de precisão atual. Mova a precisão para \"mais fotos\" ou tente uma selfie de frente, com boa luz."));
    return;
  }
  // Fotos limpas na grade, como nas galerias do mercado: a foto é o produto
  // do fotógrafo e a pessoa já sabe que aparece nela. A marcação do rosto
  // fica para a tela cheia ("Onde estou?") e para a Calibração.
  layoutGallery(r.matches.map((m) => {
    const card = el("button", { class: "shot", type: "button", onclick: () => openModal(m), "aria-label": `Abrir ${m.filename}` },
      el("div", { class: "frame" },
        el("img", {
          src: thumbUrl(m.photo_id), srcset: `${thumbUrl(m.photo_id)} 400w, /api/photos/${m.photo_id}/medium 1600w`,
          sizes: "(max-width: 600px) 50vw, 25vw", alt: "", loading: "lazy", width: m.width, height: m.height,
        })),
      el("span", { class: "score-tag" }, pct(m.score)));
    return { card, ratio: m.height / m.width };
  }));
}

// Masonry: cada foto vai para a coluna mais baixa até agora. A proporção vem
// da API, então a altura é conhecida ANTES da imagem carregar (nada pula), e
// a ordem por score segue da esquerda para a direita, de cima para baixo.
let galleryItems = [];
function galleryColumns() {
  const w = $("#gallery").clientWidth || window.innerWidth;
  return w < 600 ? 2 : Math.max(2, Math.floor(w / 260));
}
function layoutGallery(items = galleryItems) {
  galleryItems = items;
  const n = galleryColumns();
  const cols = Array.from({ length: n }, () => el("div", { class: "gallery-col" }));
  const heights = new Array(n).fill(0);
  for (const { card, ratio } of items) {
    const i = heights.indexOf(Math.min(...heights));
    cols[i].append(card);
    heights[i] += ratio + 0.02; // 0.02 ≈ a calha, em "larguras de coluna"
  }
  $("#gallery").replaceChildren(...cols);
  $("#gallery").dataset.cols = n;
}
window.addEventListener("resize", debounce(() => {
  if (galleryItems.length && Number($("#gallery").dataset.cols) !== galleryColumns()) layoutGallery();
  if (state.view === "lab") renderDebug();
}, 150));

$("#zip-btn").addEventListener("click", () => {
  window.location.href = `/api/zip?ids=${state.result.matches.map((m) => m.photo_id).join(",")}`;
});

// ------------------------------------------------------- tela cheia ---

let modalMatch = null;
let markerTimer;

/** Mostra os colchetes de foco no rosto. `flash`: some sozinho depois de ~2s. */
function showMarker(flash) {
  const layer = $("#modal-boxes");
  clearTimeout(markerTimer);
  layer.classList.remove("show");
  void layer.offsetWidth;            // reinicia a animação de "trava de foco"
  layer.classList.add("show");
  if (flash) markerTimer = setTimeout(() => layer.classList.remove("show"), 2000);
}

/** Rosto pequeno na foto (multidão): "Onde estou?" também aproxima até ele. */
function faceZoom(m) {
  const [x1, y1, x2, y2] = m.bbox;
  const frac = (x2 - x1) / m.width;            // largura do rosto em fração da foto
  if (frac >= 0.1) return null;                // rosto já é visível sem zoom
  return {
    scale: Math.min(3, 0.22 / frac),           // rosto passa a ocupar ~22% da largura
    cx: (x1 + x2) / 2 / m.width, cy: (y1 + y2) / 2 / m.height,
  };
}

/** Transform que amplia a foto e traz o rosto para o centro da tela. O
 *  deslocamento é limitado para a foto ampliada sempre cobrir a área visível:
 *  um rosto na beirada fica encostado na borda, mas inteiro (ampliar a partir
 *  do próprio rosto, como na 1ª versão, deixava meio rosto fora da tela). */
function zoomTransform(frame, stage, { scale: s, cx, cy }) {
  frame.style.transform = "";
  const f = frame.getBoundingClientRect(), st = stage.getBoundingClientRect();
  const fc = { x: f.left + f.width / 2, y: f.top + f.height / 2 };   // centro da foto (origem do scale)
  const face = { x: f.left + cx * f.width, y: f.top + cy * f.height };
  const axis = (k, size, lo, hi) => {
    // translate que leva o rosto (já ampliado) ao centro da área visível
    let t = (lo + hi) / 2 - (fc[k] + s * (face[k] - fc[k]));
    const scaled = size * s;
    if (scaled >= hi - lo) {   // foto ampliada maior que a tela: não deixar sobrar borda vazia
      t = Math.min(t, lo - (fc[k] - scaled / 2));
      t = Math.max(t, hi - (fc[k] + scaled / 2));
    } else t = (lo + hi) / 2 - fc[k];
    return t;
  };
  const tx = axis("x", f.width, st.left, st.right);
  const ty = axis("y", f.height, st.top, st.bottom);
  return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
}

function setWhere(on) {
  const frame = $(".lb-frame");
  const btn = $("#modal-where");
  const zoom = on && modalMatch ? faceZoom(modalMatch) : null;
  btn.setAttribute("aria-pressed", String(on));
  btn.querySelector("span").textContent = on && zoom ? "Ver foto inteira" : "Onde estou?";
  frame.style.transformOrigin = "50% 50%";
  frame.style.transform = zoom ? zoomTransform(frame, $("#modal-stage"), zoom) : "";
  frame.classList.toggle("zoomed", !!zoom);
  if (on) showMarker(false);
  else { clearTimeout(markerTimer); $("#modal-boxes").classList.remove("show"); }
}
$("#modal-where").addEventListener("click", () => setWhere($("#modal-where").getAttribute("aria-pressed") !== "true"));

function openModal(m) {
  modalMatch = m;
  const img = $("#modal-img");
  img.width = m.width;
  img.height = m.height;
  img.alt = m.filename;
  loadProgressive(img, m.photo_id, "medium");   // exibe 1600px; "Baixar foto" entrega o original
  drawAF($("#modal-boxes"), [{ bbox: m.bbox }], m.width, m.height);
  setWhere(false);
  showMarker(true);                             // ao abrir: marca o rosto por ~2s e some
  $("#modal-score").textContent = `${pct(m.score)} de semelhança`;
  $("#modal-caption").textContent = m.filename;
  $("#modal-caption").title = `${m.filename} (score ${m.score.toFixed(3)})`;
  $("#modal-download").href = `/api/photos/${m.photo_id}/full?download=1`;
  document.body.classList.add("modal-open");
  $("#modal").showModal();
}
const closeModal = () => $("#modal").close();
$("#modal-close").addEventListener("click", closeModal);
$("#modal-x").addEventListener("click", closeModal);
// tocar no espaço vazio em volta da foto fecha
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal-stage") closeModal(); });
$("#modal").addEventListener("close", () => { document.body.classList.remove("modal-open"); setWhere(false); });

// ------------------------------------------------------- calibração ---

// Cores das etapas: rampa de grafite para o trabalho pesado (redes neurais) e
// o verde de foco só na busca do índice, a etapa que o corte controla.
const STAGES = [
  ["decode", "Ler a imagem", "#C9CCD1"],
  ["resize", "Redimensionar", "#A3A8AF"],
  ["detection", "Detecção (SCRFD)", "#62676F"],
  ["embedding", "Embedding (ArcFace)", "#23262B"],
  ["search", "Busca no índice (FAISS)", "#1F5C4A"],
];

// score (0..1) -> posição na régua, com 20px de margem para os rostos das pontas
const rulerX = (score) => `calc(20px + (100% - 40px) * ${Math.max(0, Math.min(1, score))})`;

function moveCutLine() {
  const line = $("#ruler .cut-line");
  if (!line) return;
  const x = rulerX(state.threshold);
  line.style.left = x;
  line.querySelector("span").textContent = `corte ${state.threshold.toFixed(2)}`;
  $("#ruler .accepted").style.left = x;
  $$("#ruler .dot").forEach((d) => d.classList.toggle("above", Number(d.dataset.score) > state.threshold));
  $$("#debug-list li").forEach((li) => li.classList.toggle("above", Number(li.dataset.score) > state.threshold));
}

function renderDebug() {
  // Busca feita com a Calibração desligada vem sem top 30: conta como "sem busca".
  const r = state.result?.debug_top ? state.result : null;
  $("#debug-empty").hidden = !!r;
  $("#debug-body").hidden = !r;
  if (!r || state.view !== "lab") return;

  // Régua: cada rosto num x = score. Na mesma linha, rostos podem se sobrepor
  // até ~40%; além disso vão para a linha de baixo e a régua cresce.
  const ruler = $("#ruler");
  const widthPx = ruler.clientWidth || 800;
  const dot = widthPx < 600 ? 26 : 32;
  const minGap = ((dot * 0.6) / (widthPx - 40)) * 100;
  const rowsLastX = [];
  const dots = [...r.debug_top].sort((a, b) => a.score - b.score).map((m) => {
    const x = Math.max(0, Math.min(1, m.score)) * 100;
    let row = rowsLastX.findIndex((last) => x - last >= minGap);
    if (row === -1) { row = rowsLastX.length; rowsLastX.push(x); } else rowsLastX[row] = x;
    const d = el("button", {
      class: "dot", type: "button", "data-score": m.score,
      title: `${m.score.toFixed(3)}, ${m.filename}`, "aria-label": `score ${m.score.toFixed(3)}, ${m.filename}`,
      style: { left: rulerX(m.score), top: `${38 + row * (dot + 4)}px` },
      onclick: () => openModal(m),
    });
    faceCrop(d, { url: thumbUrl(m.photo_id), ...m });
    return d;
  });
  ruler.style.setProperty("--dot", `${dot}px`);
  ruler.style.height = `${38 + rowsLastX.length * (dot + 4) + 12}px`;
  const ticks = Array.from({ length: 11 }, (_, i) => el("div", { class: "tick", style: { left: rulerX(i / 10) } }));
  ruler.replaceChildren(...ticks, el("div", { class: "accepted" }), el("div", { class: "cut-line" }, el("span")), ...dots);

  // Tempos por etapa
  const t = r.timings_ms;
  const present = STAGES.filter(([k]) => t[k] !== undefined);
  const total = present.reduce((a, [k]) => a + t[k], 0) || 1;
  $("#timing-bar").replaceChildren(...present.map(([k, label, c]) =>
    el("div", { title: `${label}: ${t[k]} ms`, style: { width: `${(t[k] / total) * 100}%`, background: c } })));
  $("#timing-legend").replaceChildren(...[
    ...present.map(([k, label, c]) =>
      el("li", {}, el("span", { class: "sw", style: { background: c } }), label, el("span", { class: "ms" }, `${t[k]} ms`))),
    el("li", { class: "total" }, "Total", el("span", { class: "ms" }, `${Math.round(total)} ms`)),
    r.timings_from_cache
      ? el("li", { class: "note" }, "Na última busca só o índice rodou: o embedding da selfie veio do cache. Os outros tempos são de quando a selfie foi enviada.")
      : null,
  ].filter(Boolean));

  // Os 30 mais parecidos
  $("#debug-list").replaceChildren(...r.debug_top.map((m, i) => {
    const crop = el("div", { class: "face-crop" });
    faceCrop(crop, { url: thumbUrl(m.photo_id), ...m });
    return el("li", { "data-score": m.score, onclick: () => openModal(m), title: m.filename },
      crop,
      el("div", {},
        el("div", { class: "score" }, m.score.toFixed(3)),
        el("div", { class: "rank" }, `${i + 1}º, foto ${m.photo_id}`)));
  }));
  moveCutLine();
}

// ---------------------------------------------------------- backoffice ---

/** Um dos quatro estados da tela: "off" (sem ADMIN_PASSWORD) | "fail" (erro ao carregar) | "login" | "panel". */
function showAdmin(mode) {
  $("#admin-off").hidden = mode !== "off";
  $("#admin-login").hidden = mode !== "login";
  $("#admin-fail").hidden = mode !== "fail";
  $("#admin-panel").hidden = mode !== "panel";
}

/** Mostra o login com uma mensagem e leva o foco (e a seleção) ao campo de senha. */
function loginError(msg) {
  showAdmin("login");
  $("#admin-error").textContent = msg;
  const pw = $("#admin-password");
  pw.focus();
  pw.select();
}

async function renderBackoffice() {
  showAdmin(null);  // esconde tudo enquanto carrega, sem painel velho
  let s;
  try { s = await api("/api/admin/session"); } catch { s = null; }
  if (state.view !== "admin") return;  // saiu da tela enquanto esperava
  if (!s) return showAdmin("fail");
  if (!s.enabled) return showAdmin("off");
  if (!s.logged_in) { showAdmin("login"); $("#admin-password").focus(); return; }
  try {
    renderFlags(await api("/api/admin/features"));
    showAdmin("panel");
  } catch (err) {
    loginError(err.status === 401 ? "" : err.message);
  }
}

function renderFlags(list) {
  $("#flag-list").replaceChildren(...list.map((f) => {
    const id = `flag-${f.key}`;
    const sw = el("input", { type: "checkbox", role: "switch", class: "switch", id, "aria-describedby": `${id}-desc` });
    sw.checked = f.enabled;
    const err = el("p", { class: "msg err", role: "alert" });
    // guarda de ocupado (sem disabled, que faria o Chrome largar o foco do teclado)
    let busy = false;
    sw.addEventListener("change", async () => {
      if (busy) { sw.checked = !sw.checked; return; }
      busy = true;
      sw.setAttribute("aria-busy", "true");
      try { await toggleFlag(f, sw, err); } finally { busy = false; sw.removeAttribute("aria-busy"); }
    });
    return el("li", { class: "flag" },
      el("div", {},
        el("label", { for: id, class: "flag-name" }, f.label),
        el("p", { class: "quiet", id: `${id}-desc` }, f.description),
        err),
      sw);
  }));
}

/** Liga/desliga na hora; se a API recusar, o switch volta. */
async function toggleFlag(f, sw, err) {
  const enabled = sw.checked;
  err.textContent = "";
  try {
    await api(`/api/admin/features/${f.key}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }),
    });
    state.features = { ...state.features, [f.key]: enabled };
    syncNav();
    toast(`${f.label}: ${enabled ? "ligada" : "desligada"}`);
  } catch (e) {
    sw.checked = !enabled;
    if (e.status === 401) {
      loginError("Sessão expirada. Entre de novo.");
    } else err.textContent = e.message;
  }
}

$("#admin-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#admin-submit");
  btn.disabled = true;
  $("#admin-error").textContent = "";
  try {
    await api("/api/admin/login", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: $("#admin-password").value }),
    });
    $("#admin-password").value = "";
    await renderBackoffice();
  } catch (err) {
    // "Senha incorreta." vem da API
    loginError(err.status === 404 ? "Backoffice desativado." : err.message);
  } finally {
    btn.disabled = false;
  }
});

$("#admin-logout").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST" }); } catch { /* segue para o login mesmo assim */ }
  renderBackoffice();
});

// ---------------------------------------------------------------- início ---

(async function init() {
  try { state.eventId = Number(localStorage.getItem("event")) || null; } catch { /* ok */ }
  ["thr", "thr-debug"].forEach((id) => paintRange($(`#${id}`)));
  setViewfinder("empty");
  const [events] = await Promise.all([api("/api/events"), loadFeatures()]);
  state.events = events;
  route();
})();
