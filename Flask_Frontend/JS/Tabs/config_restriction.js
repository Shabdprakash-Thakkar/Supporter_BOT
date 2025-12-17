/**
 * @file Channel Restrictions Configuration Script
 * @description
 * Manages per-channel content restriction rules:
 *  - Initializes restriction tab, Select2 dropdowns, and mutual exclusivity logic
 *  - Loads, renders, and updates channel restriction cards
 *  - Supports legacy (preset-based) and granular (bitwise flags) modes
 *  - Handles create/edit/delete of restrictions via backend API
 *  - Provides advanced settings toggle for power users
 */

let resInit = false;

/**
 * Extract the guild ID from the current URL.
 * Supports `/server/{guildId}` or falls back to the last path segment.
 */
function getGuildIdFromUrl() {
  const match = window.location.href.match(/\/server\/(\d+)/);
  return match ? match[1] : window.location.pathname.split("/").pop();
}

// ==================== INITIALIZATION ====================

/**
 * Initialize the restriction tab.
 * Sets up Select2, mutual exclusivity, button handlers, and loads initial data.
 *
 * @param {boolean} [force=false] - Force re-initialization and data reload
 */
/**
 * Initialize the restriction tab.
 * Sets up Select2, mutual exclusivity, button handlers, and loads initial data.
 *
 * @param {boolean} [force=false] - Force re-initialization and data reload
 */
window.initRestrictionTab = async function (force = false) {
  if (resInit && !force) return;
  const guildId = getGuildIdFromUrl();

  if (!resInit) {
    $("#resImmuneRoles").select2({
      dropdownParent: $("#resModal"),
      width: "100%",
      placeholder: "Select roles...",
      theme: "default",
      templateResult: function (role) {
        if (!role.id) {
          return role.text;
        }
        const $result = $(
          '<span style="color: #e2e8f0;">' + role.text + "</span>"
        );
        return $result;
      },
      templateSelection: function (role) {
        return $('<span style="color: #e2e8f0;">' + role.text + "</span>");
      },
    });

    setupMutualExclusivity();

    const addBtn = document.getElementById("addRestrictionBtn");
    if (addBtn) {
      addBtn.removeEventListener("click", openResModal);
      addBtn.addEventListener("click", openResModal);
    }

    resInit = true;
  }

  await Promise.all([loadRestrictions(guildId), loadResDiscordData(guildId)]);
};

// ==================== DATA FETCHING & RENDERING ====================

/**
 * Load all restrictions for the current guild and render cards.
 *
 * @param {string} guildId - Current guild ID
 */
window.loadRestrictions = async function (guildId) {
  const container = document.getElementById("restrictionsList");
  if (!container) {
    console.warn("restrictionsList container not found - potentially on wrong tab");
    return;
  }
  try {
    const res = await fetch(
      `/api/server/${guildId}/channel-restrictions-v2/data`
    );
    const data = await res.json();

    container.innerHTML = "";
    if (data.restrictions.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-slate-500 border-2 border-dashed border-slate-700 rounded-xl">No active restrictions.</div>`;
      return;
    }

    data.restrictions.forEach((r) => {
      let badgeClass = "badge-block";
      let icon = "fas fa-ban";
      if (r.restriction_type === "media_only") {
        badgeClass = "badge-media";
        icon = "fas fa-image";
      }
      if (r.restriction_type === "text_only") {
        badgeClass = "badge-text";
        icon = "fas fa-comment-alt";
      }

      const div = document.createElement("div");
      div.className = "res-card";
      div.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-lg text-slate-500">
                        <i class="${icon}"></i>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-bold text-lg">#${r.channel_name
        }</h4>
                            <span class="res-badge ${badgeClass}">${r.restriction_type.replace(
          /_/g,
          " "
        )}</span>
                        </div>
                        <div class="text-xs text-slate-500 mt-1">
                            ${r.redirect_channel_name
          ? `Redirects to: <span class="font-bold">#${r.redirect_channel_name}</span>`
          : "No Redirect"
        }
                            <span class="mx-1">•</span>
                            ${r.immune_roles.length} Immune Roles
                        </div>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="editRes('${r.id
        }')" class="px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-indigo-500 hover:text-white transition-colors text-sm font-bold">Edit</button>
                    <button onclick="deleteRes('${r.id
        }')" class="px-3 py-1.5 rounded bg-slate-100 dark:bg-slate-700 hover:bg-red-500 hover:text-white transition-colors text-sm"><i class="fas fa-trash"></i></button>
                </div>
            `;
      div.dataset.json = JSON.stringify(r);
      container.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="text-red-500">Error loading restrictions.</div>`;
  }
};

/**
 * Load Discord channels and roles for restriction configuration.
 *
 * @param {string} guildId - Current guild ID
 */
window.loadResDiscordData = async function (guildId) {
  const res = await fetch(`/api/server/${guildId}/discord-data`);
  const data = await res.json();

  const chSelect = document.getElementById("resTargetChannel");
  const redSelect = document.getElementById("resRedirectChannel");

  // Use category-grouped dropdown
  // Force usage of the utility as it is required for correct category display
  if (typeof window.populateChannelDropdownWithCategories === "function") {
    window.populateChannelDropdownWithCategories(chSelect, data.channels, {
      channelTypes: [0, 5], // Text and announcement channels
      placeholder: "Select Channel",
      includeHash: true,
    });

    // For redirect channel, we need to add "None" option first
    redSelect.innerHTML = '<option value="" selected>None</option>';
    const tempDiv = document.createElement("div");
    window.populateChannelDropdownWithCategories(tempDiv, data.channels, {
      channelTypes: [0, 5],
      placeholder: "Select Channel",
      includeHash: true,
    });
    // Copy all options except the placeholder
    Array.from(tempDiv.querySelectorAll("option")).forEach((opt, idx) => {
      if (idx > 0) {
        // Skip placeholder
        redSelect.appendChild(opt.cloneNode(true));
      }
    });
  } else {
    console.error("Critical: populateChannelDropdownWithCategories utility not found!");
    // Fallback but log error
    chSelect.innerHTML =
      '<option value="" disabled selected>Select Channel</option>';
    redSelect.innerHTML = '<option value="" selected>None</option>';

    data.channels
      .filter((c) => c.type === 0 || c.type === 5)
      .forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.text = `# ${c.name}`;
        chSelect.appendChild(opt);
        redSelect.appendChild(opt.cloneNode(true));
      });
  }

  $("#resTargetChannel").select2({
    dropdownParent: $("#resModal"),
    width: "100%",
    placeholder: "Select Channel",
  });

  $("#resRedirectChannel").select2({
    dropdownParent: $("#resModal"),
    width: "100%",
    placeholder: "None",
    allowClear: true,
  });

  const roleSelect = document.getElementById("resImmuneRoles");
  roleSelect.innerHTML = "";
  data.roles.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.text = r.name;
    roleSelect.appendChild(opt);
  });
}

// ==================== FLAG DEFINITIONS & MODES ====================

/**
 * Bitmask flags for granular content control.
 */
const FLAGS = {
  TEXT: 1,
  DISCORD: 2,
  MEDIA_LINK: 4,
  ALL_LINKS: 8,
  MEDIA_FILES: 16,
  FILE: 32,
  EMBED: 64,
  SOCIAL_MEDIA: 128,
};

/**
 * Switch between legacy (preset) and granular (bitwise) modes.
 * Updates visibility and initializes defaults for granular mode.
 */
window.switchRestrictionMode = function switchRestrictionMode() {
  const mode = document.getElementById("resModeSelect").value;
  const legacyOptions = document.getElementById("legacyModeOptions");
  const granularOptions = document.getElementById("granularModeOptions");

  if (mode === "legacy") {
    legacyOptions.classList.remove("hidden");
    granularOptions.classList.add("hidden");
    applyResPreset();
  } else {
    legacyOptions.classList.add("hidden");
    granularOptions.classList.remove("hidden");
    const ALL_FLAGS =
      FLAGS.TEXT +
      FLAGS.DISCORD +
      FLAGS.MEDIA_LINK +
      FLAGS.ALL_LINKS +
      FLAGS.MEDIA_FILES +
      FLAGS.FILE +
      FLAGS.EMBED +
      FLAGS.SOCIAL_MEDIA;

    document.querySelectorAll(".allow-flag").forEach((cb) => {
      const bit = parseInt(cb.dataset.bit);
      const shouldAllow = (ALL_FLAGS & bit) === bit;
      cb.checked = shouldAllow;
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);
      if (blockCb) blockCb.checked = !shouldAllow;
    });
  }
};

/**
 * Apply legacy mode preset logic to content flags,
 * matching backend behavior and enforcing mutual exclusivity.
 */
window.applyResPreset = function applyResPreset() {
  const type = document.getElementById("resTypeSelect").value;
  let allowed = 0;
  let blocked = 0;

  const ALL_FLAGS =
    FLAGS.TEXT +
    FLAGS.DISCORD +
    FLAGS.MEDIA_LINK +
    FLAGS.ALL_LINKS +
    FLAGS.MEDIA_FILES +
    FLAGS.FILE +
    FLAGS.EMBED +
    FLAGS.SOCIAL_MEDIA;

  if (type === "block_invites") {
    allowed = ALL_FLAGS - FLAGS.DISCORD;
    blocked = FLAGS.DISCORD;
  } else if (type === "block_all_links") {
    allowed = FLAGS.TEXT + FLAGS.MEDIA_FILES + FLAGS.FILE + FLAGS.EMBED;
    blocked =
      FLAGS.DISCORD + FLAGS.MEDIA_LINK + FLAGS.ALL_LINKS + FLAGS.SOCIAL_MEDIA;
  } else if (type === "media_only") {
    allowed = ALL_FLAGS - FLAGS.TEXT;
    blocked = FLAGS.TEXT;
  } else if (type === "text_only") {
    allowed = FLAGS.TEXT + FLAGS.ALL_LINKS;
    blocked = ALL_FLAGS - (FLAGS.TEXT + FLAGS.ALL_LINKS);
  } else {
    allowed = ALL_FLAGS;
    blocked = 0;
  }

  document.querySelectorAll(".allow-flag").forEach((cb) => {
    const bit = parseInt(cb.dataset.bit);
    const isAllowed = (allowed & bit) === bit;
    const isBlocked = (blocked & bit) === bit;

    if (isAllowed) {
      cb.checked = true;
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);
      if (blockCb) blockCb.checked = false;
    } else if (isBlocked) {
      cb.checked = false;
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);
      if (blockCb) blockCb.checked = true;
    } else {
      cb.checked = true;
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);
      if (blockCb) blockCb.checked = false;
    }
  });

  document.querySelectorAll(".block-flag").forEach((cb) => {
    const bit = parseInt(cb.dataset.bit);
    const allowCb = document.querySelector(`.allow-flag[data-bit="${bit}"]`);
    if (allowCb && allowCb.checked) {
      cb.checked = false;
    } else if (!cb.checked && (!allowCb || !allowCb.checked)) {
      if (allowCb) allowCb.checked = true;
      cb.checked = false;
    }
  });
};

/**
 * Ensure mutual exclusivity between "allow" and "block" checkboxes per flag.
 * Guarantees exactly one checked state per content type.
 */
function setupMutualExclusivity() {
  document.querySelectorAll(".allow-flag").forEach((cb) => {
    cb.addEventListener("change", function () {
      const bit = parseInt(this.dataset.bit);
      const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);

      if (this.checked) {
        if (blockCb) {
          blockCb.checked = false;
        }
      } else {
        if (blockCb && !blockCb.checked) {
          blockCb.checked = true;
        }
      }
    });
  });

  document.querySelectorAll(".block-flag").forEach((cb) => {
    cb.addEventListener("change", function () {
      const bit = parseInt(this.dataset.bit);
      const allowCb = document.querySelector(`.allow-flag[data-bit="${bit}"]`);

      if (this.checked) {
        if (allowCb) {
          allowCb.checked = false;
        }
      } else {
        if (allowCb && !allowCb.checked) {
          allowCb.checked = true;
        }
      }
    });
  });
}

// ==================== SAVE / UPDATE LOGIC ====================

/**
 * Persist a restriction rule (create or update) to the backend.
 * Uses legacy presets or granular flags based on current mode.
 */
window.saveRestriction = async function () {
  const btn = document.getElementById("btnSaveRes");
  const id = document.getElementById("editResId").value;
  const channelId = document.getElementById("resTargetChannel").value;
  const channelName = document
    .getElementById("resTargetChannel")
    .options[
    document.getElementById("resTargetChannel").selectedIndex
  ]?.text.replace("# ", "");
  const mode = document.getElementById("resModeSelect").value;
  const resType =
    mode === "legacy"
      ? document.getElementById("resTypeSelect").value
      : "custom";
  const redirectId = document.getElementById("resRedirectChannel").value;
  const redirectName = document
    .getElementById("resRedirectChannel")
    .options[
    document.getElementById("resRedirectChannel").selectedIndex
  ]?.text.replace("# ", "");
  const immuneRoles = $("#resImmuneRoles").val();

  let allowed = 0;
  let blocked = 0;

  if (mode === "granular") {
    document
      .querySelectorAll(".allow-flag:checked")
      .forEach((cb) => (allowed += parseInt(cb.dataset.bit)));
    document
      .querySelectorAll(".block-flag:checked")
      .forEach((cb) => (blocked += parseInt(cb.dataset.bit)));
  } else {
    const type = document.getElementById("resTypeSelect").value;
    const ALL_FLAGS =
      FLAGS.TEXT +
      FLAGS.DISCORD +
      FLAGS.MEDIA_LINK +
      FLAGS.ALL_LINKS +
      FLAGS.MEDIA_FILES +
      FLAGS.FILE +
      FLAGS.EMBED +
      FLAGS.SOCIAL_MEDIA;

    if (type === "block_invites") {
      allowed = ALL_FLAGS - FLAGS.DISCORD;
      blocked = FLAGS.DISCORD;
    } else if (type === "block_all_links") {
      allowed = FLAGS.TEXT + FLAGS.MEDIA_FILES + FLAGS.FILE + FLAGS.EMBED;
      blocked =
        FLAGS.DISCORD + FLAGS.MEDIA_LINK + FLAGS.ALL_LINKS + FLAGS.SOCIAL_MEDIA;
    } else if (type === "media_only") {
      allowed = ALL_FLAGS - FLAGS.TEXT;
      blocked = FLAGS.TEXT;
    } else if (type === "text_only") {
      allowed = FLAGS.TEXT + FLAGS.ALL_LINKS;
      blocked = ALL_FLAGS - (FLAGS.TEXT + FLAGS.ALL_LINKS);
    }
  }

  if (!channelId) {
    alert("Please select a target channel.");
    return;
  }

  btn.innerText = "Saving...";
  btn.disabled = true;

  const guildId = getGuildIdFromUrl();
  const method = id ? "PUT" : "POST";

  try {
    const res = await fetch(`/api/server/${guildId}/channel-restrictions-v2`, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: id,
        channel_id: channelId,
        channel_name: channelName,
        restriction_type: mode === "legacy" ? resType : "custom",
        restriction_mode: mode,
        allowed_content_types: allowed,
        blocked_content_types: blocked,
        redirect_channel_id: redirectId,
        redirect_channel_name: redirectId ? redirectName : null,
        immune_roles: immuneRoles,
      }),
    });

    const data = await res.json();
    if (res.ok) {
      closeResModal();
      loadRestrictions(guildId);
    } else {
      alert(data.error || "Failed to save.");
    }
  } catch (e) {
    console.error(e);
    alert("Error saving.");
  } finally {
    btn.innerText = "Save Rule";
    btn.disabled = false;
  }
};

// ==================== MODAL ACTIONS ====================

/**
 * Open the restriction modal in add mode, initializing defaults if needed.
 */
window.openResModal = async function () {
  if (!resInit) {
    await initRestrictionTab();
  }

  document.getElementById("resModal").classList.remove("hidden");
  const editId = document.getElementById("editResId").value;

  if (!editId) {
    document.getElementById("editResId").value = "";
    document.getElementById("resModalTitle").innerText = "Add Restriction";
    document.getElementById("resTargetChannel").disabled = false;

    document.getElementById("resModeSelect").value = "legacy";
    switchRestrictionMode();
    $("#resTargetChannel").val("").trigger("change");
    $("#resRedirectChannel").val("").trigger("change");
  }

  $("#resImmuneRoles").val(null).trigger("change");
};

/**
 * Close the restriction modal.
 */
window.closeResModal = function () {
  document.getElementById("resModal").classList.add("hidden");
};

/**
 * Load an existing restriction into the modal for editing.
 *
 * @param {string|number} id - Restriction ID to edit
 */
window.editRes = async function (id) {
  const card = Array.from(document.querySelectorAll(".res-card")).find(
    (d) => JSON.parse(d.dataset.json).id == id
  );
  if (!card) return;
  const data = JSON.parse(card.dataset.json);

  await openResModal();
  document.getElementById("editResId").value = data.id;
  document.getElementById("resModalTitle").innerText = "Edit Restriction";

  $("#resTargetChannel").val(data.channel_id).trigger("change");
  document.getElementById("resTargetChannel").disabled = true;
  $("#resRedirectChannel")
    .val(data.redirect_channel_id || "")
    .trigger("change");

  const legacyTypes = [
    "block_invites",
    "block_all_links",
    "media_only",
    "text_only",
  ];
  const isLegacy = legacyTypes.includes(data.restriction_type);

  document.getElementById("resModeSelect").value = isLegacy
    ? "legacy"
    : "granular";
  switchRestrictionMode();

  if (isLegacy) {
    document.getElementById("resTypeSelect").value = data.restriction_type;
    applyResPreset();
  }

  $("#resImmuneRoles").val(data.immune_roles).trigger("change");

  const allowed = data.allowed_content_types || 0;
  const blocked = data.blocked_content_types || 0;

  document.querySelectorAll(".allow-flag").forEach((cb) => {
    const bit = parseInt(cb.dataset.bit);
    const isAllowed = (allowed & bit) === bit;
    const isBlocked = (blocked & bit) === bit;
    const blockCb = document.querySelector(`.block-flag[data-bit="${bit}"]`);

    if (isAllowed) {
      cb.checked = true;
      if (blockCb) blockCb.checked = false;
    } else if (isBlocked) {
      cb.checked = false;
      if (blockCb) blockCb.checked = true;
    } else {
      cb.checked = true;
      if (blockCb) blockCb.checked = false;
    }
  });

  document.querySelectorAll(".block-flag").forEach((cb) => {
    const bit = parseInt(cb.dataset.bit);
    const allowCb = document.querySelector(`.allow-flag[data-bit="${bit}"]`);
    if (allowCb && allowCb.checked) {
      cb.checked = false;
    } else if (!cb.checked && (!allowCb || !allowCb.checked)) {
      if (allowCb) allowCb.checked = true;
      cb.checked = false;
    }
  });
};

/**
 * Delete a restriction rule by ID.
 *
 * @param {string|number} id - Restriction ID to delete
 */
window.deleteRes = async function (id) {
  if (!confirm("Delete this restriction?")) return;
  const guildId = getGuildIdFromUrl();
  await fetch(`/api/server/${guildId}/channel-restrictions-v2?id=${id}`, {
    method: "DELETE",
  });
  loadRestrictions(guildId);
};

/**
 * Toggle display of advanced restriction configuration section.
 */
window.toggleAdvancedRes = function () {
  document.getElementById("advResContent").classList.toggle("hidden");
  document.getElementById("advResChevron").classList.toggle("rotate-180");
};

// ==================== EVENT BINDINGS ====================

/**
 * Attach Add Restriction button listener on DOM ready.
 */
function attachButtonListener() {
  const addBtn = document.getElementById("addRestrictionBtn");
  if (addBtn) {
    addBtn.removeEventListener("click", openResModal);
    addBtn.addEventListener("click", openResModal);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attachButtonListener);
} else {
  attachButtonListener();
}

const restrictionTab = document.getElementById("tab-restriction");
if (restrictionTab) {
  restrictionTab.addEventListener("click", initRestrictionTab);
}
