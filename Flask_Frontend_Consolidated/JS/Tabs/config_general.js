// v4.0.0
/**
 * @file Server Settings & Analytics Script
 * @description
 * Handles:
 *  - Saving general leveling settings (XP values, cooldowns) per guild
 *  - Saving and loading analytics settings (weekly report + timezones)
 *  - UI feedback for save operations (loading, success, error states)
 */

/**
 * Save general leveling settings for the current guild.
 * Reads values from the General Settings form and syncs them via API.
 */

(function () {
  if (!document.getElementById('view-config-general')) return;

  async function saveGeneralSettings() {
    const btn = document.getElementById("saveGeneralBtn");
    const originalContent = btn.innerHTML;

    // Collect form field references
    const xpMsg = document.getElementById("xpPerMessage");
    const xpImg = document.getElementById("xpPerImage");
    const xpVoice = document.getElementById("xpPerVoice");
    const xpLimit = document.getElementById("voiceXpLimit");
    const xpCooldown = document.getElementById("xpCooldown");

    // Basic numeric validation for required XP-related fields
    let isValid = true;
    [xpMsg, xpImg, xpVoice, xpLimit].forEach((input) => {
      if (input.value < 0 || input.value === "") {
        input.classList.add("input-error");
        isValid = false;
        setTimeout(() => input.classList.remove("input-error"), 500);
      }
    });

    if (!isValid) return;

    // Enter loading state
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';

    const guildId = window.location.pathname.split("/").pop();

    try {
      const response = await fetch(`/api/server/${guildId}/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          xp_per_message: parseInt(xpMsg.value),
          xp_per_image: parseInt(xpImg.value),
          xp_per_minute_in_voice: parseInt(xpVoice.value),
          voice_xp_limit: parseInt(xpLimit.value),
          xp_cooldown: parseInt(xpCooldown.value),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success state styling and reset
        btn.innerHTML = '<i class="fas fa-check mr-2"></i> Saved!';
        btn.style.background = "linear-gradient(135deg, #10b981, #059669)";

        setTimeout(() => {
          btn.innerHTML = originalContent;
          btn.style.background = "";
          btn.disabled = false;
        }, 2000);
      } else {
        throw new Error(data.error || "Failed to save");
      }
    } catch (error) {
      console.error("Save Error:", error);
      btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i> Error';
      btn.style.background = "linear-gradient(135deg, #ef4444, #dc2626)";

      setTimeout(() => {
        btn.innerHTML = originalContent;
        btn.style.background = "";
        btn.disabled = false;
      }, 2000);
    }
  }

  /**
   * Save analytics configuration (weekly report and timezones) for the current guild.
   * Uses the analytics settings form and posts to the analytics API endpoint.
   */
  async function saveAnalyticsSettings() {
    const btn = document.querySelector(
      'button[onclick="saveAnalyticsSettings()"]'
    );
    const originalHtml = btn.innerHTML;

    // Read analytics settings values
    const weeklyReportEnabled = document.getElementById(
      "weeklyReportEnabled"
    ).checked;
    const analyticsTimezone = document.getElementById("analyticsTimezone").value;
    const resetTimezone = document.getElementById("resetTimezone").value;

    // Enter loading state
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';

    const guildId = window.location.pathname.split("/").pop();

    try {
      const response = await fetch(`/api/analytics/${guildId}/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          weekly_report_enabled: weeklyReportEnabled,
          analytics_timezone: analyticsTimezone,
          weekly_reset_timezone: resetTimezone,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success state styling and reset
        btn.innerHTML = '<i class="fas fa-check mr-2"></i> Saved!';
        btn.classList.remove("btn-primary");
        btn.classList.add("bg-green-600", "hover:bg-green-500", "text-white");

        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove(
            "bg-green-600",
            "hover:bg-green-500",
            "text-white"
          );
          btn.classList.add("btn-primary");
          btn.disabled = false;
        }, 2000);
      } else {
        throw new Error(data.error || "Failed to save settings");
      }
    } catch (error) {
      console.error("Save Error:", error);
      btn.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i> Error';
      btn.classList.add("bg-red-600", "text-white");

      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.classList.remove("bg-red-600", "text-white");
        btn.disabled = false;
      }, 2000);
    }
  }

  /**
   * Load analytics settings for the current guild and populate the UI form.
   * Called once when the page is ready.
   */
  async function loadAnalyticsSettings() {
    const guildId = window.location.pathname.split("/").pop();

    try {
      const response = await fetch(`/api/analytics/${guildId}/settings`);
      const data = await response.json();

      if (response.ok) {
        const analyticsTimezoneSelect =
          document.getElementById("analyticsTimezone");
        const resetTimezoneSelect = document.getElementById("resetTimezone");
        const weeklyReportCheckbox = document.getElementById(
          "weeklyReportEnabled"
        );

        if (analyticsTimezoneSelect && data.analytics_timezone) {
          analyticsTimezoneSelect.value = data.analytics_timezone;
        }

        if (resetTimezoneSelect && data.weekly_reset_timezone) {
          resetTimezoneSelect.value = data.weekly_reset_timezone;
        }

        if (weeklyReportCheckbox && data.weekly_report_enabled !== undefined) {
          weeklyReportCheckbox.checked = data.weekly_report_enabled;
        }

        console.log("✅ Analytics settings loaded successfully");
      }
    } catch (error) {
      console.error("Error loading analytics settings:", error);
    }
  }

  /**
   * Auto-load analytics settings when the document is ready.
   */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadAnalyticsSettings);
  } else {
    loadAnalyticsSettings();
  }

  // Export global functions
  window.saveGeneralSettings = saveGeneralSettings;
  window.saveAnalyticsSettings = saveAnalyticsSettings;

})();
