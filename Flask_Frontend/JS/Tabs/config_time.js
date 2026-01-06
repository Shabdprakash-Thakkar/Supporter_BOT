// v5.0.0
// v4.0.0
/**
 * @file Timezone Clocks Configuration Script
 * @description
 * Manages server timezone clocks with a vanilla JS searchable dropdown:
 *  - Loads and filters timezones without external UI libraries
 *  - Loads Discord voice channels for time/date clock mapping
 *  - Creates, edits, and deletes server clocks via API
 *  - Handles modal open/close and keyboard navigation in the dropdown
 */

let isTimeInit = false;
let allTimezones = [];
let filteredTimezones = [];
let highlightedIndex = -1;
let editingClockId = null; // Database ID of the clock currently being edited

// ==================== UTILITIES ====================

// (getGuildIdFromUrl is provided globally by server_config.js)


// ==================== TAB INITIALIZATION ====================

/**
 * Initialize the Time tab once:
 *  - Load timezones
 *  - Load configured clocks
 *  - Load Discord channels
 *  - Wire timezone dropdown UI
 */
async function initTimeTab() {
  if (isTimeInit) return;

  const guildId = getGuildIdFromUrl();
  await Promise.all([
    loadTimezones(),
    loadClocks(guildId),
    loadDiscordChannels(guildId),
  ]);

  wireTimezoneUI();

  const addBtn = document.getElementById("addClockBtn");
  if (addBtn) {
    addBtn.removeEventListener("click", openTimeModal);
    addBtn.addEventListener("click", () => openTimeModal(null));
  }

  isTimeInit = true;
}

// ==================== TIMEZONE DROPDOWN ====================

/**
 * Fetch the full timezone list from the backend and render the initial dropdown.
 */
async function loadTimezones() {
  try {
    const res = await fetch("/api/timezones");
    const data = await res.json();
    allTimezones = Array.isArray(data.timezones) ? data.timezones.slice() : [];
    buildDropdownList(allTimezones);
  } catch (e) {
    console.error("Failed to load timezones", e);
    allTimezones = [];
    buildDropdownList([]);
  }
}

/**
 * Render the timezone dropdown items with a capped initial list for performance.
 *
 * @param {string[]} list - Timezone list to render
 */
function buildDropdownList(list) {
  const dropdown = document.getElementById("timezoneDropdown");
  if (!dropdown) return;
  dropdown.innerHTML = "";

  if (!list || list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timezone-empty";
    empty.textContent = "No timezones available.";
    dropdown.appendChild(empty);
    return;
  }

  const MAX_RENDER = 500;
  const sliceList = list.slice(0, MAX_RENDER);

  sliceList.forEach((tz) => {
    const item = document.createElement("div");
    item.className = "timezone-item";
    item.setAttribute("role", "option");
    item.dataset.value = tz;
    item.textContent = tz;
    item.addEventListener("click", () => {
      selectTimezone(tz);
      closeTimezoneDropdown();
    });
    dropdown.appendChild(item);
  });

  if (list.length > MAX_RENDER) {
    const more = document.createElement("div");
    more.className = "timezone-empty";
    more.textContent = `...and ${list.length - MAX_RENDER
      } more — refine your search`;
    dropdown.appendChild(more);
  }
}

/**
 * Wire UI events for the custom timezone dropdown:
 *  - Focus/input events
 *  - Keyboard navigation
 *  - Click-outside to close
 *  - Wrapper click to open
 */
function wireTimezoneUI() {
  const search = document.getElementById("timezoneSearch");
  const dropdown = document.getElementById("timezoneDropdown");
  const hidden = document.getElementById("timezoneValue");

  if (!search || !dropdown || !hidden) return;

  search.addEventListener("focus", () => {
    openTimezoneDropdown();
    filterTimezoneList(search.value || "");
  });

  search.addEventListener("input", (e) => {
    filterTimezoneList(e.target.value || "");
  });

  search.addEventListener("keydown", (e) => {
    const items = dropdown.querySelectorAll(".timezone-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length === 0) return;
      highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
      updateHighlight(items);
      scrollIntoViewIfNeeded(items[highlightedIndex]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      highlightedIndex = Math.max(highlightedIndex - 1, 0);
      updateHighlight(items);
      scrollIntoViewIfNeeded(items[highlightedIndex]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && items[highlightedIndex]) {
        const tz = items[highlightedIndex].dataset.value;
        selectTimezone(tz);
        closeTimezoneDropdown();
      } else if (items.length === 1) {
        const tz = items[0].dataset.value;
        selectTimezone(tz);
        closeTimezoneDropdown();
      }
    } else if (e.key === "Escape") {
      closeTimezoneDropdown();
      search.blur();
    }
  });

  document.addEventListener("click", (ev) => {
    const within =
      ev.target.closest &&
      (ev.target.closest(".timezone-select-wrapper") ||
        ev.target.closest("#timezoneDropdown"));
    if (!within) {
      closeTimezoneDropdown();
    }
  });

  const wrapper = document.querySelector(".timezone-select-wrapper");
  if (wrapper) {
    wrapper.addEventListener("click", (e) => {
      if (e.target === wrapper || e.target === search) {
        openTimezoneDropdown();
        search.focus();
      }
    });
  }

  if (hidden.value) {
    search.value = hidden.value;
  }
}

/**
 * Open the timezone dropdown and reset highlight state.
 */
function openTimezoneDropdown() {
  const dropdown = document.getElementById("timezoneDropdown");
  if (!dropdown) return;
  dropdown.classList.remove("hidden");
  highlightedIndex = -1;
}

/**
 * Close the timezone dropdown and clear highlights.
 */
function closeTimezoneDropdown() {
  const dropdown = document.getElementById("timezoneDropdown");
  if (!dropdown) return;
  dropdown.classList.add("hidden");
  highlightedIndex = -1;
  const items = dropdown.querySelectorAll(".timezone-item");
  items.forEach((it) => it.classList.remove("highlighted"));
}

/**
 * Filter the timezone list based on a search term and rebuild the dropdown.
 *
 * @param {string} term - Search term
 */
function filterTimezoneList(term) {
  const dropdown = document.getElementById("timezoneDropdown");
  const search = document.getElementById("timezoneSearch");
  if (!dropdown || !search) return;

  const q = (term || "").toLowerCase().trim();

  if (!q) {
    filteredTimezones = allTimezones.slice();
  } else {
    filteredTimezones = allTimezones.filter(
      (tz) => tz.toLowerCase().indexOf(q) !== -1
    );
  }

  dropdown.innerHTML = "";

  if (!filteredTimezones || filteredTimezones.length === 0) {
    const empty = document.createElement("div");
    empty.className = "timezone-empty";
    empty.textContent = "No matching timezones — try a different query.";
    dropdown.appendChild(empty);
    highlightedIndex = -1;
    return;
  }

  const MAX = 500;
  const toDisplay = filteredTimezones.slice(0, MAX);

  toDisplay.forEach((tz, i) => {
    const item = document.createElement("div");
    item.className = "timezone-item";
    item.dataset.value = tz;
    item.textContent = tz;
    item.addEventListener("click", () => {
      selectTimezone(tz);
      closeTimezoneDropdown();
    });
    dropdown.appendChild(item);
  });

  if (filteredTimezones.length > MAX) {
    const more = document.createElement("div");
    more.className = "timezone-empty";
    more.textContent = `Showing ${MAX} of ${filteredTimezones.length} matches — refine search to narrow further.`;
    dropdown.appendChild(more);
  }

  highlightedIndex = -1;
}

/**
 * Apply the highlighted class to the currently selected item.
 *
 * @param {NodeListOf<HTMLElement>} items - Dropdown items
 */
function updateHighlight(items) {
  items.forEach((it, idx) => {
    it.classList.toggle("highlighted", idx === highlightedIndex);
  });
}

/**
 * Ensure the highlighted item is visible inside the scrollable dropdown.
 *
 * @param {HTMLElement} el - Highlighted item element
 */
function scrollIntoViewIfNeeded(el) {
  if (!el) return;
  const parent = el.parentElement;
  const parentRect = parent.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  if (elRect.top < parentRect.top) {
    parent.scrollTop -= parentRect.top - elRect.top + 8;
  } else if (elRect.bottom > parentRect.bottom) {
    parent.scrollTop += elRect.bottom - parentRect.bottom + 8;
  }
}

/**
 * Set the selected timezone into the hidden form field and visible input.
 *
 * @param {string} tz - Selected timezone string
 */
function selectTimezone(tz) {
  const hidden = document.getElementById("timezoneValue");
  const search = document.getElementById("timezoneSearch");
  if (hidden) hidden.value = tz;
  if (search) search.value = tz;
}

// ==================== DISCORD CHANNELS & CLOCK LIST ====================

/**
 * Load Discord voice channels and populate the time/date channel selects.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadDiscordChannels(guildId) {
  try {
    const res = await fetch(`/api/server/${guildId}/discord-data`);
    const data = await res.json();
    const timeSelect = document.getElementById("timeChannelSelect");
    const dateSelect = document.getElementById("dateChannelSelect");
    if (!timeSelect || !dateSelect) return;

    // Use category-grouped dropdown for voice channels
    if (typeof window.populateChannelDropdownWithCategories === "function") {
      window.populateChannelDropdownWithCategories(timeSelect, data.channels, {
        channelTypes: [2], // Voice channels only
        placeholder: "-- Select Time Channel --",
        includeHash: false,
        categoryPrefix: "📁 ",
        channelIndent: "  🔊 ",
      });

      window.populateChannelDropdownWithCategories(dateSelect, data.channels, {
        channelTypes: [2], // Voice channels only
        placeholder: "-- None --",
        includeHash: false,
        categoryPrefix: "📁 ",
        channelIndent: "  🔊 ",
      });
    } else {
      // Fallback to simple population
      timeSelect.innerHTML =
        "<option value=''>-- Select Time Channel --</option>";
      dateSelect.innerHTML = "<option value=''>-- None --</option>";

      const voiceChannels = (data.channels || []).filter((c) => c.type === 2);

      voiceChannels.forEach((c) => {
        const optT = document.createElement("option");
        optT.value = c.id;
        optT.text = `🔊 ${c.name}`;
        timeSelect.appendChild(optT);

        const optD = document.createElement("option");
        optD.value = c.id;
        optD.text = `🔊 ${c.name}`;
        dateSelect.appendChild(optD);
      });
    }

    $("#timeChannelSelect").select2({
      dropdownParent: $("#timeModal"),
      width: "100%",
      placeholder: "Select Time Channel",
    });

    $("#dateChannelSelect").select2({
      dropdownParent: $("#timeModal"),
      width: "100%",
      placeholder: "None",
      allowClear: true,
    });
  } catch (e) {
    console.error("Failed to load discord channels:", e);
  }
}

/**
 * Load all configured clocks for the guild and render them as cards.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadClocks(guildId) {
  const safeContainer =
    document.getElementById("clockList") ||
    document.getElementById("clock-list");
  if (!safeContainer) return;

  try {
    const res = await fetch(`/api/server/${guildId}/clocks`);
    const data = await res.json();

    safeContainer.innerHTML = "";
    if (!data.clocks || data.clocks.length === 0) {
      safeContainer.innerHTML = `<div class="col-span-full text-center text-slate-500 py-8 border-2 border-dashed border-slate-700 rounded-xl">No clocks configured.</div>`;
      return;
    }

    data.clocks.forEach((clock) => {
      const div = document.createElement("div");
      div.className = "config-card";

      let dateInfo = "";
      if (clock.date_channel_id) {
        dateInfo = `
          <div class="config-badge bg-blue-500/10 text-blue-400 mt-1 w-fit">
            <i class="fas fa-calendar-day mr-1"></i>Date Active
          </div>`;
      }

      div.innerHTML = `
                <div class="config-icon-wrapper bg-gradient-to-br from-blue-500 to-indigo-600">
                    <i class="fas fa-globe-americas text-white"></i>
                </div>
                <div class="config-info">
                    <div class="config-title">${clock.timezone}</div>
                    <div class="config-subtitle">
                        <i class="fas fa-hashtag"></i>
                        ${clock.channel_id || clock.time_channel_id}
                    </div>
                    ${dateInfo}
                </div>
                <div class="config-actions">
                    <button class="action-btn edit edit-clock-btn" title="Edit Clock">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn delete delete-clock-btn" title="Delete Clock">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;

      const editBtn = div.querySelector(".edit-clock-btn");
      const deleteBtn = div.querySelector(".delete-clock-btn");

      if (editBtn) {
        editBtn.addEventListener("click", () => {
          editClock(
            clock.id,
            clock.channel_id || clock.time_channel_id,
            clock.timezone,
            clock.date_channel_id || ""
          );
        });
      }

      if (deleteBtn) {
        deleteBtn.addEventListener("click", () => {
          deleteClock(clock.channel_id || clock.time_channel_id);
        });
      }

      safeContainer.appendChild(div);
    });
  } catch (e) {
    console.error(e);
    safeContainer.innerHTML = `<div class="text-red-500">Error loading clocks.</div>`;
  }
}

// ==================== MODAL OPEN/CLOSE & SAVE ====================

/**
 * Open the clock modal in either "add" or "edit" mode.
 *
 * @param {?number} dbId - Clock database ID (null for add mode)
 * @param {?string} channelId - Time channel ID
 * @param {?string} timezone - Timezone string
 * @param {?string} dateChannelId - Date channel ID
 */
window.openTimeModal = function (
  dbId = null,
  channelId = null,
  timezone = null,
  dateChannelId = null
) {
  const modal = document.getElementById("timeModal");
  if (!modal) return;

  const modalTitle = modal.querySelector("h3");
  if (modalTitle) {
    if (dbId !== null) {
      modalTitle.innerHTML =
        '<i class="fas fa-edit mr-2 text-blue-400"></i> Edit Clock';
      editingClockId = dbId;
    } else {
      modalTitle.innerHTML =
        '<i class="fas fa-clock mr-2 text-blue-400"></i> Add New Clock';
      editingClockId = null;
    }
  }

  const search = document.getElementById("timezoneSearch");
  const hidden = document.getElementById("timezoneValue");
  const timeChannelSelect = document.getElementById("timeChannelSelect");
  const dateChannelSelect = document.getElementById("dateChannelSelect");

  if (dbId !== null && timezone) {
    if (search) search.value = timezone;
    if (hidden) hidden.value = timezone;
    if (timeChannelSelect)
      $(timeChannelSelect).val(channelId).trigger("change");
    if (dateChannelSelect)
      $(dateChannelSelect)
        .val(dateChannelId || "")
        .trigger("change");
  } else {
    if (search) search.value = "";
    if (hidden) hidden.value = "";
    if (timeChannelSelect) $(timeChannelSelect).val("").trigger("change");
    if (dateChannelSelect) $(dateChannelSelect).val("").trigger("change");
  }

  modal.classList.remove("hidden");
  setTimeout(() => {
    const s = document.getElementById("timezoneSearch");
    if (s) s.focus();
  }, 120);
};

/**
 * Close the clock modal and reset edit mode.
 */
window.closeTimeModal = function () {
  const modal = document.getElementById("timeModal");
  if (modal) modal.classList.add("hidden");
  editingClockId = null;
};

/**
 * Save (create or update) a clock configuration via API.
 * Uses PUT when editing and POST for new clocks.
 */
window.saveClock = async function () {
  const channelId = document.getElementById("timeChannelSelect").value;
  const dateChannelId = document.getElementById("dateChannelSelect").value;
  const timezone =
    document.getElementById("timezoneValue").value ||
    document.getElementById("timezoneSearch").value;
  const btn = document.getElementById("btnSaveClock");

  if (!channelId || !timezone) {
    alert("Please select a Time Channel and Timezone");
    return;
  }

  btn.innerText = "Saving...";
  btn.disabled = true;

  const guildId = getGuildIdFromUrl();
  const isEditing = editingClockId !== null;

  try {
    const url = isEditing
      ? `/api/server/${guildId}/clocks/${editingClockId}`
      : `/api/server/${guildId}/clocks`;

    const method = isEditing ? "PUT" : "POST";

    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel_id: channelId,
        date_channel_id: dateChannelId,
        timezone: timezone,
      }),
    });

    if (res.ok) {
      closeTimeModal();
      loadClocks(guildId);
    } else {
      const d = await res.json();
      alert("Failed to save clock: " + (d.error || "Unknown"));
    }
  } catch (e) {
    console.error(e);
    alert("Error saving");
  } finally {
    btn.innerText = "Save Clock";
    btn.disabled = false;
  }
};

/**
 * Wrapper to open the modal pre-filled for editing an existing clock.
 */
window.editClock = function (dbId, channelId, timezone, dateChannelId) {
  openTimeModal(dbId, channelId, timezone, dateChannelId);
};

/**
 * Delete a clock configuration for the given channel ID.
 *
 * @param {string} channelId - Time channel ID to delete clock for
 */
async function deleteClock(channelId) {
  if (!confirm("Stop updating this clock?")) return;
  const guildId = getGuildIdFromUrl();

  await fetch(`/api/server/${guildId}/clocks?channel_id=${channelId}`, {
    method: "DELETE",
  });
  loadClocks(guildId);
}

// ==================== AUTO-INIT HOOKS ====================

const timeTab = document.getElementById("tab-time");
if (timeTab) {
  timeTab.addEventListener("click", initTimeTab);
}
// Only init if we are on a page with the time tab
if (document.getElementById("tab-time")) {
  initTimeTab();
}
