/**
 * @file Analytics Settings JavaScript
 * @description
 * Handles:
 *  - Initialization of analytics settings for a guild
 *  - Loading existing analytics settings from the backend
 *  - Saving updated analytics settings to the backend
 *  - Wiring basic UI events for timezone-related controls
 */

let currentGuildIdForAnalytics = null;

// ===================== INITIALIZATION =====================

/**
 * Initialize analytics settings for a specific guild.
 *
 * @param {string} guildId - Discord guild (server) ID.
 */
function initAnalyticsSettings(guildId) {
  currentGuildIdForAnalytics = guildId;
  loadAnalyticsSettings();
}

// ===================== LOAD SETTINGS =====================

/**
 * Load analytics settings from the API and populate the form.
 *
 * Uses the guild_id parsed from the current URL.
 */
async function loadAnalyticsSettings() {
  try {
    const guildId = window.location.pathname.split("/").pop();

    if (!guildId || guildId === "null") {
      console.error("Invalid guild_id for loading settings:", guildId);
      return;
    }

    const response = await fetch(`/api/analytics/${guildId}/settings`);

    if (!response.ok) {
      throw new Error("Failed to load analytics settings");
    }

    const settings = await response.json();

    document.getElementById("weeklyReportEnabled").checked =
      settings.weekly_report_enabled;
    document.getElementById("analyticsTimezone").value =
      settings.analytics_timezone;
    document.getElementById("resetTimezone").value =
      settings.weekly_reset_timezone;
  } catch (error) {
    console.error("Error loading analytics settings:", error);
  }
}

// ===================== SAVE SETTINGS =====================

/**
 * Save analytics settings to the API.
 *
 * Reads form values and posts them to the backend for the
 * current guild, with basic success/error notification.
 */
async function saveAnalyticsSettings() {
  try {
    const guildId = window.location.pathname.split("/").pop();

    if (!guildId || guildId === "null") {
      console.error("Invalid guild_id:", guildId);
      showNotification("Invalid server ID", "error");
      return;
    }

    const settings = {
      weekly_report_enabled: document.getElementById("weeklyReportEnabled")
        .checked,
      analytics_timezone: document.getElementById("analyticsTimezone").value,
      weekly_reset_timezone: document.getElementById("resetTimezone").value,
      weekly_report_day: 0, // Monday
      weekly_report_hour: 9, // 9 AM
    };

    const response = await fetch(`/api/analytics/${guildId}/settings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      throw new Error("Failed to save analytics settings");
    }

    const result = await response.json();

    if (result.success) {
      showNotification("Analytics settings saved successfully!", "success");
      updateNextResetTime(settings.weekly_reset_timezone);
    } else {
      throw new Error("Save failed");
    }
  } catch (error) {
    console.error("Error saving analytics settings:", error);
    showNotification("Failed to save analytics settings", "error");
  }
}

// ===================== EVENT BINDINGS =====================

document.addEventListener("DOMContentLoaded", () => {
  const resetTimezoneSelect = document.getElementById("resetTimezone");
  if (resetTimezoneSelect) {
    resetTimezoneSelect.addEventListener("change", (e) => {
      // Hook for future next-reset-time updates when timezone changes.
      // updateNextResetTime(e.target.value);
    });
  }
});
