/* ==========================================================================
   MON DRESSING — logique de l'application
   Aucune librairie externe : juste du JavaScript qui lit/écrit le HTML.
   Les données sont sauvegardées dans le navigateur (localStorage).
   ========================================================================== */

/* --------------------------------------------------------------------------
   1) CONFIGURATION — modifie ici pour changer les catégories ou les jours
   -------------------------------------------------------------------------- */
const CATEGORIES = [
  { key: "haut", label: "Hauts", emoji: "👕" },
  { key: "bas", label: "Bas", emoji: "👖" },
  { key: "chaussures", label: "Chaussures", emoji: "👟" },
  { key: "accessoire", label: "Accessoires", emoji: "⌚" },
  // Pour ajouter une catégorie, copie une ligne et change key/label/emoji.
  // Exemple : { key: "veste", label: "Vestes", emoji: "🧥" },
];

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/* --------------------------------------------------------------------------
   2) ÉTAT DE L'APPLICATION — tout ce qui change au fil de l'utilisation
   -------------------------------------------------------------------------- */
let state = {
  items: loadFromStorage("wardrobe-items", []),       // tous les vêtements
  weeklyPlan: loadFromStorage("weekly-plan", {}),      // { "Lun": {haut:"id", ...}, ... }
  title: loadFromStorage("dressing-title", "Mon Dressing"),
  currentTab: "dressing",                              // "dressing" | "tenue" | "semaine"
  currentFilter: CATEGORIES[0].key,                    // catégorie affichée dans l'onglet Dressing
  outfit: {},                                           // tenue du jour en cours de composition
  pendingPhoto: null,                                   // photo choisie dans le formulaire, avant validation
};

/* --------------------------------------------------------------------------
   3) STOCKAGE — lecture/écriture dans le localStorage du navigateur
   -------------------------------------------------------------------------- */
function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    showSaveError("");
    return true;
  } catch (e) {
    showSaveError("La sauvegarde locale a échoué (mémoire du navigateur pleine ?).");
    return false;
  }
}

function showSaveError(message) {
  const el = document.getElementById("save-error");
  el.textContent = message;
  el.classList.toggle("hidden", !message);
}

/* --------------------------------------------------------------------------
   4) OUTILS
   -------------------------------------------------------------------------- */
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function categoryByKey(key) {
  return CATEGORIES.find((c) => c.key === key);
}

function cleanItemsInCategory(catKey) {
  return state.items.filter((it) => it.category === catKey && !it.dirty);
}

function itemById(id) {
  return state.items.find((it) => it.id === id);
}

// Redimensionne une photo choisie par l'utilisateur pour qu'elle reste légère
// (sinon la base de vêtements devient vite trop lourde pour le navigateur).
function resizeImage(file, maxDim = 420, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture du fichier impossible"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image illisible"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* --------------------------------------------------------------------------
   5) ACTIONS — tout ce qui modifie l'état, puis sauvegarde et redessine
   -------------------------------------------------------------------------- */
function addItem({ name, category, color, image }) {
  const newItem = { id: uid(), name: name.trim(), category, color: (color || "").trim(), image: image || null, dirty: false };
  state.items = [newItem, ...state.items];
  saveToStorage("wardrobe-items", state.items);
  renderDressingTab();
}

function toggleDirty(id) {
  state.items = state.items.map((it) => (it.id === id ? { ...it, dirty: !it.dirty } : it));
  saveToStorage("wardrobe-items", state.items);
  renderAll(); // le statut propre/sale impacte aussi les menus de Tenue et Semaine
}

function deleteItem(id) {
  state.items = state.items.filter((it) => it.id !== id);
  saveToStorage("wardrobe-items", state.items);
  renderAll();
}

function setOutfitItem(catKey, itemId) {
  state.outfit = { ...state.outfit, [catKey]: itemId || undefined };
  renderTenueTab();
}

// Passe à l'article précédent/suivant (propre) dans une catégorie.
// direction : 1 pour la flèche droite, -1 pour la flèche gauche.
function cycleOutfitItem(catKey, direction) {
  const pool = cleanItemsInCategory(catKey);
  if (pool.length === 0) return;
  const currentId = state.outfit[catKey];
  let idx = pool.findIndex((it) => it.id === currentId);
  if (idx === -1) {
    idx = 0; // rien de sélectionné : on part du premier
  } else {
    idx = (idx + direction + pool.length) % pool.length;
  }
  state.outfit = { ...state.outfit, [catKey]: pool[idx].id };
  renderTenueTab();
}

function pickRandomOutfit() {
  const next = {};
  CATEGORIES.forEach((c) => {
    const pool = cleanItemsInCategory(c.key);
    if (pool.length) next[c.key] = pool[Math.floor(Math.random() * pool.length)].id;
  });
  state.outfit = next;
  renderTenueTab();
}

function assignOutfitToDay(day) {
  state.weeklyPlan = { ...state.weeklyPlan, [day]: { ...state.outfit } };
  saveToStorage("weekly-plan", state.weeklyPlan);
}

function setDayItem(day, catKey, itemId) {
  state.weeklyPlan = {
    ...state.weeklyPlan,
    [day]: { ...(state.weeklyPlan[day] || {}), [catKey]: itemId || undefined },
  };
  saveToStorage("weekly-plan", state.weeklyPlan);
}

/* --------------------------------------------------------------------------
   6) AFFICHAGE — chaque fonction "render..." régénère un bout de HTML
   -------------------------------------------------------------------------- */
function renderHeader() {
  document.getElementById("title-display").textContent = state.title;
  document.getElementById("title-input").value = state.title;
  const clean = state.items.filter((it) => !it.dirty).length;
  const dirty = state.items.filter((it) => it.dirty).length;
  document.getElementById("counter").textContent = `${clean} propres · ${dirty} sales`;
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === state.currentTab);
  });
  document.getElementById("tab-dressing").classList.toggle("hidden", state.currentTab !== "dressing");
  document.getElementById("tab-tenue").classList.toggle("hidden", state.currentTab !== "tenue");
  document.getElementById("tab-semaine").classList.toggle("hidden", state.currentTab !== "semaine");
}

/* ---- Onglet Dressing ---- */
function renderDressingTab() {
  // Chips de catégories
  const chipsHtml = CATEGORIES.map(
    (c) => `<button class="chip ${c.key === state.currentFilter ? "active" : ""}" data-action="set-filter" data-cat="${c.key}">${c.emoji} ${c.label}</button>`
  ).join("");
  document.getElementById("category-chips").innerHTML = chipsHtml;

  // Options du formulaire (menu catégorie)
  document.getElementById("category-select").innerHTML = CATEGORIES.map(
    (c) => `<option value="${c.key}">${c.label}</option>`
  ).join("");

  // Grille des vêtements de la catégorie sélectionnée
  const itemsInCat = state.items.filter((it) => it.category === state.currentFilter);
  const grid = document.getElementById("items-grid");
  if (itemsInCat.length === 0) {
    grid.innerHTML = `<div class="empty-msg">Rien ici pour l'instant. Scanne un premier vêtement pour remplir cette catégorie.</div>`;
  } else {
    grid.innerHTML = itemsInCat.map((it) => tagCardHtml(it)).join("");
  }
}

function tagCardHtml(item) {
  const photo = item.image
    ? `<img src="${item.image}" alt="${escapeHtml(item.name)}" class="${item.dirty ? "dirty" : ""}" />`
    : `👕`;
  const colorLine = item.color ? `<div class="tag-color">${escapeHtml(item.color)}</div>` : "";
  return `
    <div class="tag-card">
      <div class="tag-photo">${photo}</div>
      <div class="tag-name">${escapeHtml(item.name)}</div>
      ${colorLine}
      <div class="tag-actions">
        <button class="dirty-toggle ${item.dirty ? "is-dirty" : ""}" data-action="toggle-dirty" data-id="${item.id}">
          ${item.dirty ? "Sale" : "Propre"}
        </button>
        <button class="delete-btn" data-action="delete-item" data-id="${item.id}">🗑</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---- Onglet Tenue du jour : bobines verticales style "machine à sous" ---- */
function renderTenueTab() {
  // Si une catégorie n'a encore rien de sélectionné mais a des vêtements
  // propres disponibles, on démarre sur le premier automatiquement.
  CATEGORIES.forEach((c) => {
    if (!state.outfit[c.key]) {
      const pool = cleanItemsInCategory(c.key);
      if (pool.length > 0) state.outfit[c.key] = pool[0].id;
    }
  });

  const rowsHtml = CATEGORIES.map((c) => {
    const pool = cleanItemsInCategory(c.key);

    if (pool.length === 0) {
      return `
        <div class="reel-row">
          <div class="reel-card">
            <div class="reel-label">${c.emoji} ${c.label}</div>
            <div class="reel-empty">Rien de propre ici</div>
          </div>
        </div>
      `;
    }

    const it = itemById(state.outfit[c.key]) || pool[0];
    const idx = pool.findIndex((p) => p.id === it.id);
    const photo = it.image ? `<img src="${it.image}" alt="${escapeHtml(it.name)}" />` : c.emoji;
    const singleItem = pool.length <= 1;

    return `
      <div class="reel-row">
        <button class="reel-arrow" data-action="cycle-outfit" data-cat="${c.key}" data-dir="-1" ${singleItem ? "disabled" : ""} aria-label="${c.label} précédent">‹</button>
        <div class="reel-card">
          <div class="reel-label">${c.emoji} ${c.label}</div>
          <div class="reel-photo">${photo}</div>
          <div class="reel-name">${escapeHtml(it.name)}</div>
          <div class="reel-count">${idx + 1} / ${pool.length}</div>
        </div>
        <button class="reel-arrow" data-action="cycle-outfit" data-cat="${c.key}" data-dir="1" ${singleItem ? "disabled" : ""} aria-label="${c.label} suivant">›</button>
      </div>
    `;
  }).join("");

  document.getElementById("outfit-reels").innerHTML = rowsHtml;

  document.getElementById("assign-days").innerHTML = DAYS.map(
    (d) => `<button class="chip" data-action="assign-day" data-day="${d}">${d}</button>`
  ).join("");
}

/* ---- Onglet Semaine ---- */
function renderSemaineTab() {
  const html = DAYS.map((day) => {
    const selectsHtml = CATEGORIES.map((c) => {
      const pool = cleanItemsInCategory(c.key);
      const current = (state.weeklyPlan[day] && state.weeklyPlan[day][c.key]) || "";
      const optionsHtml = pool.map((it) => `<option value="${it.id}" ${current === it.id ? "selected" : ""}>${escapeHtml(it.name)}</option>`).join("");
      return `
        <select class="input" data-action="set-day-item" data-day="${day}" data-cat="${c.key}">
          <option value="">${c.label} — aucun</option>
          ${optionsHtml}
        </select>
      `;
    }).join("");
    return `
      <div class="week-day">
        <div class="week-day-title">🗓 ${day}</div>
        <div class="week-day-selects">${selectsHtml}</div>
      </div>
    `;
  }).join("");
  document.getElementById("week-grid").innerHTML = html;
}

function renderAll() {
  renderHeader();
  renderTabs();
  renderDressingTab();
  renderTenueTab();
  renderSemaineTab();
  refreshFormState();
}

/* --------------------------------------------------------------------------
   7) FORMULAIRE D'AJOUT
   -------------------------------------------------------------------------- */
function refreshFormState() {
  const nameInput = document.getElementById("name-input");
  document.getElementById("add-item-btn").disabled = nameInput.value.trim() === "";
}

/* --------------------------------------------------------------------------
   8) BRANCHEMENT DES ÉVÉNEMENTS — tout se passe ici, une seule fois au chargement
   -------------------------------------------------------------------------- */
function setupEventListeners() {
  // --- Titre modifiable ---
  const titleDisplay = document.getElementById("title-display");
  const titleInput = document.getElementById("title-input");
  const editBtn = document.getElementById("title-edit-btn");
  const saveBtn = document.getElementById("title-save-btn");

  function enterTitleEdit() {
    titleDisplay.classList.add("hidden");
    editBtn.classList.add("hidden");
    titleInput.classList.remove("hidden");
    saveBtn.classList.remove("hidden");
    titleInput.focus();
  }
  function confirmTitleEdit() {
    state.title = titleInput.value.trim() || "Mon Dressing";
    saveToStorage("dressing-title", state.title);
    titleDisplay.classList.remove("hidden");
    editBtn.classList.remove("hidden");
    titleInput.classList.add("hidden");
    saveBtn.classList.add("hidden");
    renderHeader();
  }
  editBtn.addEventListener("click", enterTitleEdit);
  saveBtn.addEventListener("click", confirmTitleEdit);
  titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmTitleEdit(); });

  // --- Onglets ---
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.currentTab = btn.dataset.tab;
      renderTabs();
    });
  });

  // --- Formulaire d'ajout : afficher / masquer ---
  const addForm = document.getElementById("add-form");
  document.getElementById("toggle-form-btn").addEventListener("click", () => {
    addForm.classList.toggle("hidden");
  });

  // --- Photo : lecture + redimensionnement ---
  document.getElementById("photo-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      state.pendingPhoto = await resizeImage(file);
      const preview = document.getElementById("photo-preview");
      preview.src = state.pendingPhoto;
      preview.classList.remove("hidden");
    } catch (err) {
      showSaveError("Impossible de lire cette photo.");
    }
  });

  // --- Nom du vêtement : active/désactive le bouton "Ajouter" ---
  document.getElementById("name-input").addEventListener("input", refreshFormState);

  // --- Validation du formulaire ---
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("name-input").value;
    if (!name.trim()) return;
    const category = document.getElementById("category-select").value;
    const color = document.getElementById("color-input").value;
    addItem({ name, category, color, image: state.pendingPhoto });

    // reset du formulaire
    document.getElementById("name-input").value = "";
    document.getElementById("color-input").value = "";
    document.getElementById("photo-input").value = "";
    document.getElementById("photo-preview").classList.add("hidden");
    state.pendingPhoto = null;
    refreshFormState();
    addForm.classList.add("hidden");
  });

  // --- Bouton "Tenue aléatoire" / "Réinitialiser" ---
  document.getElementById("random-outfit-btn").addEventListener("click", pickRandomOutfit);
  document.getElementById("reset-outfit-btn").addEventListener("click", () => {
    state.outfit = {};
    renderTenueTab();
  });

  // --- Clics délégués : tout ce qui a un data-action est géré ici ---
  document.body.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "set-filter") {
      state.currentFilter = el.dataset.cat;
      renderDressingTab();
    }
    if (action === "toggle-dirty") {
      toggleDirty(el.dataset.id);
    }
    if (action === "delete-item") {
      deleteItem(el.dataset.id);
    }
    if (action === "assign-day") {
      assignOutfitToDay(el.dataset.day);
    }
    if (action === "cycle-outfit") {
      cycleOutfitItem(el.dataset.cat, parseInt(el.dataset.dir, 10));
    }
  });

  // --- Changements délégués (menus déroulants restants : planning de semaine) ---
  document.body.addEventListener("change", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "set-day-item") {
      setDayItem(el.dataset.day, el.dataset.cat, el.value);
    }
  });
}

/* --------------------------------------------------------------------------
   9) DÉMARRAGE
   -------------------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  renderAll();
});