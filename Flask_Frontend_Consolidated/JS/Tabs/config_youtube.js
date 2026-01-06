// v5.0.0
// v4.0.0
/**
 * @file YouTube Notifications Configuration Script
 * @description
 * Manages YouTube notification integrations per guild:
 *  - Initialization of the YouTube tab with guild data
 *  - Fetching and rendering configured channels
 *  - Searching channels via backend API and previewing metadata
 *  - Creating, updating, and deleting notification configurations
 *  - Discord channel/role population with Select2 integration
 *  - Optimistic UI updates and toast-based user feedback
 */

let ytInit = false;
let channelsMap = {};
let currentEditingYtId = null;

/**
 * Extract the guild ID from the current URL.
 * Supports routes like `/server/{guildId}` or falls back to the last path segment.
 */
function getGuildIdFromUrl() {
  const match = window.location.href.match(/\/server\/(\d+)/);
  return match ? match[1] : window.location.pathname.split("/").pop();
}

// ==================== INITIALIZATION ====================

/**
 * Initialize the YouTube configuration tab.
 * Avoids re-initialization unless `force` is true.
 *
 * @param {boolean} [force=false] - Force reload of data
 */
window.initYoutubeTab = async function (force = false) {
  if (ytInit && !force) return;
  const guildId = getGuildIdFromUrl();
  await Promise.all([loadYTData(guildId), loadYTDiscordData(guildId)]);
  ytInit = true;
}

// ==================== DATA FETCHING & POPULATION ====================

/**
 * Load existing YouTube configurations for this guild and render them as cards.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadYTData(guildId) {
  const container = document.getElementById("youtubeList");
  try {
    const res = await fetch(`/api/server/${guildId}/youtube`);
    const data = await res.json();

    container.innerHTML = "";
    if (data.configs.length === 0) {
      container.innerHTML = `<div class="p-8 text-center text-slate-500 border-2 border-dashed border-slate-700 rounded-xl">No channels configured.</div>`;
      return;
    }

    data.configs.forEach((cfg) => {
      const div = document.createElement("div");
      div.className = "yt-card";
      div.setAttribute("data-yt-id", cfg.yt_id);
      div.innerHTML = `
                <div class="yt-icon-wrapper"><i class="fab fa-youtube"></i></div>
                <div class="flex-grow">
                    <h4 class="font-bold text-lg">${cfg.name}</h4>
                    <p class="text-xs text-slate-500 font-mono">ID: ${cfg.yt_id}</p>
                </div>
                <div class="flex gap-2">
                    <button onclick="editYT('${cfg.yt_id}')" class="text-slate-400 hover:text-indigo-500 transition-colors p-2" title="Edit"><i class="fas fa-edit"></i></button>
                    <button onclick="deleteYT('${cfg.yt_id}')" class="text-slate-400 hover:text-red-500 transition-colors p-2" title="Delete"><i class="fas fa-trash"></i></button>
                </div>
            `;
      container.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    container.innerHTML = `<div class="text-red-500">Error loading data.</div>`;
  }
}

/**
 * Load Discord metadata (channels and roles) for the YouTube modal,
 * populate selects, and initialize Select2 instances.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadYTDiscordData(guildId) {
  const res = await fetch(`/api/server/${guildId}/discord-data`);
  const data = await res.json();

  channelsMap = {};
  data.channels
    .filter((c) => c.type === 0 || c.type === 5)
    .forEach((c) => {
      channelsMap[c.id] = c.name;
    });

  const chSelect = document.getElementById("ytTargetChannel");

  // Use category-grouped dropdown
  if (typeof window.populateChannelDropdownWithCategories === "function") {
    window.populateChannelDropdownWithCategories(chSelect, data.channels, {
      channelTypes: [0, 5], // Text and announcement channels
      placeholder: "Select Text Channel",
      includeHash: true,
    });
  } else {
    // Fallback to simple population
    chSelect.innerHTML =
      '<option value="" disabled selected>Select Text Channel</option>';
    data.channels
      .filter((c) => c.type === 0 || c.type === 5)
      .forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.text = `# ${c.name}`;
        chSelect.appendChild(opt);
      });
  }

  const roleSelect = document.getElementById("ytMentionRole");
  roleSelect.innerHTML = '<option value="" selected>None</option>';
  data.roles.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.text = `@${r.name}`;
    roleSelect.appendChild(opt);
  });

  $("#ytTargetChannel").select2({
    dropdownParent: $("#ytModal"),
    width: "100%",
    placeholder: "Select Text Channel",
  });

  $("#ytMentionRole").select2({
    dropdownParent: $("#ytModal"),
    width: "100%",
    placeholder: "None",
    allowClear: true,
  });
}

/**
 * Resolve and populate in-card channel names using `channelsMap`.
 * Intended for elements with `.channel-name` and `data-id` attributes.
 */
function resolveChannelNames() {
  document.querySelectorAll(".channel-name").forEach((span) => {
    const channelId = span.getAttribute("data-id");
    if (channelsMap[channelId]) {
      span.innerText = channelsMap[channelId];
    } else {
      span.innerText = "Unknown Channel";
    }
  });
}

// ==================== SEARCH & PREVIEW ====================

/**
 * Search for a YouTube channel via backend API and update the preview pane.
 */
async function searchChannel() {
  const query = document.getElementById("ytSearchInput").value;
  const err = document.getElementById("ytSearchError");
  const step2 = document.getElementById("yt-step-2");

  if (!query) return;

  err.classList.add("hidden");
  step2.classList.add("hidden");

  try {
    const res = await fetch("/api/youtube/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query }),
    });
    const data = await res.json();

    if (res.ok) {
      document.getElementById("ytPreviewImg").src = data.thumbnail;
      document.getElementById("ytPreviewName").innerText = data.name;
      document.getElementById("ytPreviewSubs").innerText = parseInt(
        data.subscribers
      ).toLocaleString();
      document.getElementById("ytPreviewVids").innerText = parseInt(
        data.video_count
      ).toLocaleString();
      document.getElementById("ytPreviewID").innerText = data.id;

      step2.classList.remove("hidden");
    } else {
      err.innerText = data.error || "Channel not found";
      err.classList.remove("hidden");
    }
  } catch (e) {
    err.innerText = "API Error";
    err.classList.remove("hidden");
  }
}

// ==================== SAVE / UPDATE CONFIGURATION ====================

/**
 * Persist the YouTube configuration for this guild (create or update).
 * Uses optimistic UI updates when editing an existing configuration.
 */
async function saveYTConfig() {
  const btn = document.getElementById("btnSaveYT");
  const btnText = document.getElementById("btnSaveYTText");
  const ytId = document.getElementById("ytPreviewID").innerText;
  const ytName = document.getElementById("ytPreviewName").innerText;
  const targetCh = document.getElementById("ytTargetChannel").value;
  const roleId = document.getElementById("ytMentionRole").value;
  const msg = document.getElementById("ytCustomMsg").value;

  if (!ytId || !targetCh) {
    showToast("Please select a target channel", "error");
    return;
  }

  btn.disabled = true;
  btnText.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

  const guildId = getGuildIdFromUrl();

  if (currentEditingYtId) {
    updateCardOptimistically(currentEditingYtId, ytName, targetCh);
  }

  try {
    const res = await fetch(`/api/server/${guildId}/youtube`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        yt_id: ytId,
        yt_name: ytName,
        target_channel: targetCh,
        role_id: roleId,
        message: msg,
      }),
    });

    const result = await res.json();

    if (res.ok) {
      const seededCount = result.seeded_count || 0;
      const action = currentEditingYtId ? "updated" : "added";
      showToast(
        `✅ Channel ${action}! Seeded ${seededCount} video${seededCount !== 1 ? "s" : ""
        }.`,
        "success"
      );
      closeYTModal();
      loadYTData(guildId);
    } else {
      showToast(result.error || "Failed to save", "error");
      if (currentEditingYtId) {
        loadYTData(guildId);
      }
    }
  } catch (e) {
    console.error(e);
    showToast("Error saving configuration", "error");
    if (currentEditingYtId) {
      loadYTData(guildId);
    }
  } finally {
    btn.disabled = false;
    btnText.innerHTML = "Save Changes";
  }
}

/**
 * Apply an optimistic visual update to an existing YouTube card
 * while the save operation is in progress.
 *
 * @param {string} ytId - YouTube channel ID
 * @param {string} ytName - Updated channel name
 * @param {string} targetChannelId - Target Discord channel ID
 */
function updateCardOptimistically(ytId, ytName, targetChannelId) {
  const card = document.querySelector(`[data-yt-id="${ytId}"]`);
  if (card) {
    const nameEl = card.querySelector("h4");
    const channelEl = card.querySelector(".channel-name");
    if (nameEl) nameEl.innerText = ytName;
    if (channelEl && channelsMap[targetChannelId]) {
      channelEl.innerText = `# ${channelsMap[targetChannelId]}`;
    }
  }
}

// ==================== EDIT MODE ====================

/**
 * Open the modal in edit mode for a specific YouTube configuration.
 *
 * @param {string} ytId - YouTube channel ID to edit
 */
async function editYT(ytId) {
  const guildId = getGuildIdFromUrl();

  try {
    const res = await fetch(`/api/server/${guildId}/youtube`);
    const data = await res.json();
    const config = data.configs.find((c) => c.yt_id === ytId);

    if (!config) {
      showToast("Configuration not found", "error");
      return;
    }

    currentEditingYtId = ytId;

    document.getElementById("ytModalTitle").innerText = "Edit YouTube Channel";

    document.getElementById("ytSearchInput").value = config.yt_id;
    document.getElementById("ytPreviewImg").src = config.thumbnail || "";
    document.getElementById("ytPreviewName").innerText = config.name;
    document.getElementById("ytPreviewSubs").innerText = "N/A";
    document.getElementById("ytPreviewVids").innerText = "N/A";
    document.getElementById("ytPreviewID").innerText = config.yt_id;
    document.getElementById("ytPreviewID").innerText = config.yt_id;
    $("#ytTargetChannel").val(config.target_channel).trigger("change");
    $("#ytMentionRole")
      .val(config.role_id || "")
      .trigger("change");
    document.getElementById("ytCustomMsg").value =
      config.message ||
      "🔔 {@role} **{channel_name}** has uploaded a new video!\n              \n              {video_url}";

    document.getElementById("yt-step-2").classList.remove("hidden");
    document.getElementById("ytModal").classList.remove("hidden");
  } catch (e) {
    console.error(e);
    showToast("Error loading configuration", "error");
  }
}

// ==================== MODAL CONTROLS ====================

/**
 * Open the YouTube configuration modal in "Add" mode.
 */
function openYTModal() {
  const guildId = getGuildIdFromUrl();

  currentEditingYtId = null;
  document.getElementById("ytModalTitle").innerText = "Add YouTube Channel";

  document.getElementById("ytSearchInput").value = "";
  document.getElementById("yt-step-2").classList.add("hidden");
  $("#ytTargetChannel").val("").trigger("change");
  $("#ytMentionRole").val("").trigger("change");
  document.getElementById("ytCustomMsg").value =
    "🔔 {@role} **{channel_name}** has uploaded a new video!\n              \n              {video_url}";

  document.getElementById("ytModal").classList.remove("hidden");

  if (!ytInit) {
    loadYTDiscordData(guildId);
    ytInit = true;
  }
}

/**
 * Close the YouTube modal and clear editing state.
 */
function closeYTModal() {
  document.getElementById("ytModal").classList.add("hidden");
  document.getElementById("yt-step-2").classList.add("hidden");
  document.getElementById("ytSearchInput").value = "";
  currentEditingYtId = null;
}

/**
 * Insert a template variable tag into the custom notification message.
 *
 * @param {string} tag - Placeholder tag to insert (e.g., "{video_url}")
 */
function insertYTVar(tag) {
  const input = document.getElementById("ytCustomMsg");
  input.value += tag;
}

// ==================== DELETE CONFIGURATION ====================

/**
 * Delete a YouTube notification configuration by channel ID.
 *
 * @param {string} id - YouTube channel ID
 */
async function deleteYT(id) {
  if (!confirm("Remove this YouTube notification?")) return;

  const guildId = getGuildIdFromUrl();
  const card = document.querySelector(`[data-yt-id="${id}"]`);

  if (card) {
    card.style.opacity = "0.5";
    card.style.pointerEvents = "none";
  }

  try {
    await fetch(`/api/server/${guildId}/youtube?yt_id=${id}`, {
      method: "DELETE",
    });
    showToast("Channel removed successfully", "success");
    loadYTData(guildId);
  } catch (e) {
    console.error(e);
    showToast("Error removing channel", "error");
    if (card) {
      card.style.opacity = "1";
      card.style.pointerEvents = "auto";
    }
  }
}

// ==================== TOAST NOTIFICATIONS ====================

/**
 * Display a toast notification.
 *
 * @param {string} message - Message to display
 * @param {"success"|"error"} [type="success"] - Toast style variant
 */
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"
    } mr-2"></i>
    ${message}
  `;

  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add("show"), 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ==================== EVENT BINDINGS ====================

document
  .getElementById("tab-youtube")
  ?.addEventListener("click", initYoutubeTab);

const addBtn = document.getElementById("addYoutubeBtn");
if (addBtn) {
  addBtn.addEventListener("click", openYTModal);
} else {
  // Fallback: handled by other initialization paths if needed
}
