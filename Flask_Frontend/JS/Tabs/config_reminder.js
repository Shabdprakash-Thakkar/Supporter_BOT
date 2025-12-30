// v4.0.0
/**
 * @file Smart Reminders Tab Script
 * @description
 * Manages the Smart Reminders configuration UI for a guild:
 *  - Initializes Select2 dropdowns (timezone, channel, role)
 *  - Loads and renders existing reminders from the backend
 *  - Creates, updates, pauses/resumes, and deletes reminders
 *  - Supports custom intervals and date-only vs datetime scheduling
 */

let reminderInit = false;
let currentReminders = [];
let currentEditingId = null;
let flatpickrInstance = null;

// ==================== TAB INITIALIZATION ====================

/**
 * Initialize the Reminder tab:
 *  - Configures Select2 widgets
 *  - Loads timezones, Discord metadata, and existing reminders
 */
/**
 * Initialize the Reminder tab:
 *  - Configures Select2 widgets (once)
 *  - Loads timezones, Discord metadata, and existing reminders (always on refresh/init)
 */
async function initReminderTab(force = false) {
  if (!reminderInit) {
    $("#reminderTimezone").select2({
      width: "100%",
      placeholder: "Select Timezone",
    });

    $("#reminderChannel").select2({
      width: "100%",
      placeholder: "Select Channel",
    });

    $("#reminderRole").select2({
      width: "100%",
      placeholder: "Select Role (Optional)",
      allowClear: true,
    });

    reminderInit = true;
  }

  const guildId = getGuildIdFromUrl();
  // Always load data to ensure freshness, especially when forcing refresh
  await Promise.all([
    loadReminderTimezones(),
    loadReminderData(guildId),
    loadReminderDiscordData(guildId),
  ]);
}

// ==================== FORM TOGGLES ====================

/**
 * Initialize Flatpickr on the datetime input.
 */
function initFlatpickr() {
  if (flatpickrInstance) return;

  flatpickrInstance = flatpickr("#reminderDateTime", {
    enableTime: true,
    dateFormat: "Y-m-d\\TH:i",
    altInput: true,
    altFormat: "F j, Y at h:i K",
    time_24hr: false,
    static: true,
    onReady: function (selectedDates, dateStr, instance) {
      // Add "OK" button to the calendar
      const btn = document.createElement("button");
      btn.className = "flatpickr-ok-btn w-full bg-indigo-600 text-white py-2 text-sm font-bold mt-2 hover:bg-indigo-500 transition-colors";
      btn.innerHTML = '<i class="fas fa-check mr-1"></i> DONE';
      btn.type = "button";
      btn.onclick = function () {
        instance.close();
      };
      instance.calendarContainer.appendChild(btn);
    },
  });
}

// ==================== FORM TOGGLES ====================

/**
 * Toggle between `date` and `datetime-local` input types
 * based on the "date only" checkbox.
 */
function toggleDateInputType() {
  const isDateOnly = document.getElementById("reminderDateOnly").checked;

  if (flatpickrInstance) {
    flatpickrInstance.set("enableTime", !isDateOnly);
    flatpickrInstance.set("dateFormat", isDateOnly ? "Y-m-d\\T00:00" : "Y-m-d\\TH:i");
    flatpickrInstance.set("altFormat", isDateOnly ? "F j, Y" : "F j, Y at h:i K");
  }
}

/**
 * Toggle custom interval input visibility when "Custom" is selected.
 */
function toggleCustomIntervalInput() {
  const interval = document.getElementById("reminderInterval").value;
  const customGroup = document.getElementById("customIntervalGroup");
  if (interval === "custom") {
    customGroup.classList.remove("hidden");
  } else {
    customGroup.classList.add("hidden");
  }
}

// ==================== DATA LOADERS ====================

/**
 * Load available timezones from the API and populate the timezone select.
 */
async function loadReminderTimezones() {
  try {
    const res = await fetch("/api/timezones");
    const data = await res.json();
    const sel = document.getElementById("reminderTimezone");

    sel.innerHTML =
      '<option value="" disabled selected>Select timezone...</option>';

    data.timezones.forEach((tz) => {
      const opt = document.createElement("option");
      opt.value = tz;
      opt.text = tz;
      if (tz === "UTC") opt.selected = true;
      sel.appendChild(opt);
    });

    $("#reminderTimezone").trigger("change");
  } catch (e) {
    console.error("Error loading timezones:", e);
  }
}

/**
 * Load Discord channels and roles for the given guild.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadReminderDiscordData(guildId) {
  try {
    const res = await fetch(`/api/server/${guildId}/discord-data`);
    const data = await res.json();

    const channelSel = document.getElementById("reminderChannel");

    // Use category-grouped dropdown
    if (typeof window.populateChannelDropdownWithCategories === "function") {
      window.populateChannelDropdownWithCategories(channelSel, data.channels, {
        channelTypes: [0, 5], // Text and announcement channels
        placeholder: "Select channel...",
        includeHash: true,
      });
    } else {
      console.error("Critical: populateChannelDropdownWithCategories utility not found!");
      // Fallback to simple population
      channelSel.innerHTML =
        '<option value="" disabled selected>Select channel...</option>';

      data.channels
        .filter((ch) => ch.type === 0 || ch.type === 5)
        .forEach((ch) => {
          const opt = document.createElement("option");
          opt.value = ch.id;
          opt.text = `# ${ch.name}`;
          channelSel.appendChild(opt);
        });
    }

    const roleSel = document.getElementById("reminderRole");
    roleSel.innerHTML = '<option value="">No role mention</option>';

    data.roles.forEach((role) => {
      const opt = document.createElement("option");
      opt.value = role.id;
      opt.text = `@ ${role.name}`;
      roleSel.appendChild(opt);
    });

    $("#reminderChannel").trigger("change");
    $("#reminderRole").trigger("change");
  } catch (e) {
    console.error("Error loading Discord data:", e);
  }
}

/**
 * Load all reminders for the guild and render them into the list.
 *
 * @param {string} guildId - Current guild ID
 */
async function loadReminderData(guildId) {
  const container = document.getElementById("reminderList");
  try {
    const res = await fetch(`/api/server/${guildId}/reminders`);
    const data = await res.json();

    currentReminders = data.reminders || [];
    container.innerHTML = "";

    if (currentReminders.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-slate-500">
          <i class="fas fa-bell-slash text-4xl mb-3 opacity-30"></i>
          <p>No reminders configured yet.</p>
          <p class="text-sm">Click "New Reminder" to create your first reminder!</p>
        </div>
      `;
      return;
    }

    currentReminders.forEach((reminder, index) => {
      const div = document.createElement("div");
      div.className = "rem-card";

      const nextRun = new Date(reminder.next_run);
      const timeString = nextRun.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });

      const statusClass = reminder.status === "active" ? "active" : "paused";
      const statusText =
        reminder.status.charAt(0).toUpperCase() + reminder.status.slice(1);

      const intervalMap = {
        once: "One-time",
        "1d": "Daily",
        "7d": "Weekly",
        "30d": "Monthly",
        "1h": "Hourly",
        "6h": "Every 6h",
        "12h": "Every 12h",
      };

      let intervalDisplay = intervalMap[reminder.interval];
      if (!intervalDisplay) {
        if (reminder.interval.match(/^\d+[yMwdhm]$/)) {
          intervalDisplay = `Every ${reminder.interval}`;
        } else {
          intervalDisplay = reminder.interval;
        }
      }

      div.innerHTML = `
        <div class="flex items-center gap-4">
          <div class="rem-icon">
            <i class="fas fa-bell"></i>
          </div>
          <div class="flex-grow min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <h4 class="font-bold truncate" title="${escapeHtml(
        reminder.message
      )}">${escapeHtml(reminder.message.substring(0, 50))}${reminder.message.length > 50 ? "..." : ""
        }</h4>
              <span class="rem-status ${statusClass}">${statusText}</span>
            </div>
            <p class="text-xs text-slate-500 truncate">Next: ${timeString}</p>
          </div>
          <div class="text-right">
            <div class="text-xs text-slate-400">${reminder.timezone}</div>
            <span class="rem-interval">${intervalDisplay}</span>
          </div>
          <div class="flex gap-2 ml-2">
            <button class="text-slate-500 hover:text-blue-400 transition-colors" 
                    title="Edit"
                    onclick="editReminder(${index})">
              <i class="fas fa-edit"></i>
            </button>
            <button class="text-slate-500 hover:text-yellow-400 transition-colors" 
                    title="${reminder.status === "active" ? "Pause" : "Resume"}"
                    onclick="toggleReminderStatus('${reminder.reminder_id}')">
              <i class="fas fa-${reminder.status === "active" ? "pause" : "play"
        }"></i>
            </button>
            <button class="text-slate-500 hover:text-red-400 transition-colors" 
                    title="Delete"
                    onclick="deleteReminder('${reminder.reminder_id}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
      container.appendChild(div);
    });
  } catch (e) {
    console.error("Error loading reminders:", e);
    container.innerHTML = `
      <div class="text-center py-8 text-red-400">
        <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
        <p>Error loading reminders. Please try again.</p>
      </div>
    `;
  }
}

/**
 * Open edit mode for a reminder by index.
 *
 * @param {number} index - Index in `currentReminders`
 */
function editReminder(index) {
  openReminderModal(index);
}

// ==================== CREATE / UPDATE REMINDERS ====================

/**
 * Create or update a reminder using the current form values.
 * Automatically handles custom interval parsing and date-only logic.
 */
async function saveReminder() {
  const message = document.getElementById("reminderMessage").value.trim();
  const channelId = document.getElementById("reminderChannel").value;
  const roleId = document.getElementById("reminderRole").value || null;
  const timezone = $("#reminderTimezone").val();
  let startTime = document.getElementById("reminderDateTime").value; // Flatpickr updates this hidden input
  let interval = document.getElementById("reminderInterval").value;

  const isDateOnly = document.getElementById("reminderDateOnly").checked;
  // With Flatpickr's dateFormat, this explicit check might be redundant if dateFormat is set correctly,
  // but keeping it for robustness if the date-only format doesn't include time.
  if (isDateOnly && startTime && !startTime.includes("T")) {
    startTime += "T00:00";
  }

  if (interval === "custom") {
    const customVal = document
      .getElementById("reminderCustomInterval")
      .value.trim();
    if (!customVal) {
      alert("Please enter a custom interval (e.g. 45m, 3d)");
      return;
    }
    const validPattern = /^(\s*\d+[yMwdhm]\s*)+$/;
    if (!validPattern.test(customVal)) {
      alert(
        "Invalid custom interval format. Use numbers followed by unit (y, M, w, d, h, m). Example: '1w 2d' or '30m'. Note: M=Month, m=Minute."
      );
      return;
    }
    interval = customVal;
  }

  if (!message || !channelId || !timezone || !startTime) {
    alert(
      "Please fill in all required fields (Message, Channel, Timezone, Date/Time)"
    );
    return;
  }

  const payload = {
    reminder_id: currentEditingId,
    message: message,
    channel_id: channelId,
    role_id: roleId,
    timezone: timezone,
    start_time: startTime,
    interval: interval,
  };

  const guildId = getGuildIdFromUrl();

  try {
    const saveBtn = document.getElementById("btnSaveReminder");
    const originalText = saveBtn.innerHTML;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
    saveBtn.disabled = true;

    const res = await fetch(`/api/server/${guildId}/reminders/manage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      closeReminderModal();
      await loadReminderData(guildId);
      showNotification(
        data.action === "updated" ? "Reminder updated!" : "Reminder created!",
        "success"
      );
    } else {
      const error = await res.json();
      alert(`Failed to save reminder: ${error.error || "Unknown error"}`);
    }

    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
  } catch (e) {
    console.error("Error saving reminder:", e);
    alert("Failed to save reminder. Please try again.");
    document.getElementById("btnSaveReminder").innerHTML =
      '<i class="fas fa-save mr-2"></i>Save Reminder';
    document.getElementById("btnSaveReminder").disabled = false;
  }
}

// ==================== STATUS & DELETE ACTIONS ====================

/**
 * Toggle the active/paused status of a reminder.
 *
 * @param {string} reminderId - Reminder identifier
 */
async function toggleReminderStatus(reminderId) {
  const guildId = getGuildIdFromUrl();

  try {
    const res = await fetch(
      `/api/server/${guildId}/reminders/${reminderId}/toggle`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (res.ok) {
      await loadReminderData(guildId);
      showNotification("Reminder status updated", "success");
    } else {
      alert("Failed to update reminder status");
    }
  } catch (e) {
    console.error("Error toggling reminder:", e);
    alert("Failed to update reminder status");
  }
}

/**
 * Delete a reminder after user confirmation.
 *
 * @param {string} reminderId - Reminder identifier
 */
async function deleteReminder(reminderId) {
  if (!confirm("Are you sure you want to delete this reminder?")) {
    return;
  }

  const guildId = getGuildIdFromUrl();

  try {
    const res = await fetch(`/api/server/${guildId}/reminders/${reminderId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      await loadReminderData(guildId);
      showNotification("Reminder deleted successfully", "success");
    } else {
      alert("Failed to delete reminder");
    }
  } catch (e) {
    console.error("Error deleting reminder:", e);
    alert("Failed to delete reminder");
  }
}

// ==================== MODAL HANDLING ====================

/**
 * Open the reminder modal in either create or edit mode.
 *
 * @param {?number} reminderIdx - Index in `currentReminders` (null for new)
 */
function openReminderModal(reminderIdx = null) {
  if (!flatpickrInstance) initFlatpickr();

  const isEdit = reminderIdx !== null && typeof reminderIdx === "number";

  const modal = document.getElementById("reminderModal");
  const titleEl = document.getElementById("reminderModalTitle");
  const saveBtn = document.getElementById("btnSaveReminder");

  currentEditingId = null;
  document.getElementById("reminderMessage").value = "";
  $("#reminderChannel").val("").trigger("change");
  $("#reminderRole").val("").trigger("change");

  // Default to +1 hour
  const now = new Date();
  now.setHours(now.getHours() + 1);
  now.setMinutes(0);
  flatpickrInstance.setDate(now);

  document.getElementById("reminderDateOnly").checked = false;
  toggleDateInputType();

  document.getElementById("reminderInterval").value = "once";
  toggleCustomIntervalInput();
  document.getElementById("reminderCustomInterval").value = "";


  if (isEdit) {
    if (titleEl) titleEl.innerText = "Edit Reminder";
    if (saveBtn)
      saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Update Reminder';

    const r = currentReminders[reminderIdx];
    currentEditingId = r.reminder_id;

    document.getElementById("reminderMessage").value = r.message;
    $("#reminderTimezone").val(r.timezone).trigger("change");
    $("#reminderChannel").val(r.channel_id).trigger("change");
    if (r.role_id) $("#reminderRole").val(r.role_id).trigger("change");

    if (r.next_run) {
      flatpickrInstance.setDate(r.next_run);
    }

    const stdIntervals = ["once", "1d", "7d", "30d", "1h", "6h", "12h"];
    if (stdIntervals.includes(r.interval)) {
      $("#reminderInterval").val(r.interval).trigger("change");
    } else {
      $("#reminderInterval").val("custom").trigger("change");
      document.getElementById("reminderCustomInterval").value = r.interval;
      toggleCustomIntervalInput();
    }
  } else {
    if (titleEl) titleEl.innerText = "New Reminder";
    if (saveBtn)
      saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Reminder';

    $("#reminderTimezone").val("UTC").trigger("change");
  }

  modal.classList.remove("hidden");

  if (!reminderInit) initReminderTab();
}

/**
 * Close the reminder modal.
 */
function closeReminderModal() {
  document.getElementById("reminderModal").classList.add("hidden");
}

// ==================== UTILITIES ====================

/**
 * Escape HTML entities in a string to prevent injection in titles and content.
 *
 * @param {string} text - Raw text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Show a notification using the global toast system if available,
 * otherwise log to the console as a fallback.
 *
 * @param {string} message - Notification message
 * @param {string} [type="info"] - Notification type (e.g., "success", "error")
 */
function showNotification(message, type = "info") {
  if (typeof window.showToast === "function") {
    window.showToast(message, type);
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

// ==================== EVENT BINDINGS ====================

/**
 * Wire tab and button listeners when the DOM is ready.
 */
document.addEventListener("DOMContentLoaded", function () {
  const reminderTabBtn = document.getElementById("btn-tab-reminder");
  if (reminderTabBtn) {
    reminderTabBtn.addEventListener("click", initReminderTab);
  }

  const addReminderBtn = document.getElementById("addReminderBtn");
  if (addReminderBtn) {
    addReminderBtn.addEventListener("click", openReminderModal);
  }
});
