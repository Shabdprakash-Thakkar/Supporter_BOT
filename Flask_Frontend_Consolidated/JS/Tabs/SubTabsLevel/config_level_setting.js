// v4.0.0
/**
 * @file Level Settings Management
 * @description
 * Handles loading, displaying, and saving level-related configuration
 * for a Discord guild, including:
 *  - Level-up notification channel and message styles
 *  - Custom level-up messages (with/without role rewards)
 *  - Role reward stacking and announcement toggles
 *  - Auto-reset XP settings (with optional role removal)
 */

/**
 * Load level settings for the current guild and populate the UI controls.
 */
window.loadLevelSettings = async function () {
  const guildId = window.location.pathname.split("/").pop();
  const notifySelect = document.getElementById("levelNotifyChannel");
  const messageStyleSelect = document.getElementById("levelMessageStyle");
  const customMessageTextarea = document.getElementById("levelCustomMessage");
  const customMessageRoleTextarea = document.getElementById(
    "levelCustomMessageRole"
  );
  const stackRolesCheckbox = document.getElementById("stackRoleRewards");
  const announceRolesCheckbox = document.getElementById("announceRoleRewards");
  const autoResetDaysInput = document.getElementById("autoResetDays");
  const autoResetEnabledCheckbox = document.getElementById("autoResetEnabled");
  const autoResetRemoveRolesDaysInput = document.getElementById(
    "autoResetRemoveRolesDays"
  );
  const autoResetRemoveRolesEnabledCheckbox = document.getElementById(
    "autoResetRemoveRolesEnabled"
  );

  if (!notifySelect) return;

  try {
    // Load Discord channels for notification options
    const resp = await fetch(`/api/server/${guildId}/discord-data`);
    const data = await resp.json();

    const channels = data.channels || [];
    // Populate channel dropdown with category support
    if (typeof window.populateChannelDropdownWithCategories === "function") {
      window.populateChannelDropdownWithCategories(notifySelect, channels, {
        channelTypes: [0, 5],
        placeholder: "Disable notifications",
        includeHash: true,
      });
    } else {
      // Fallback: Simple population
      notifySelect.innerHTML = '<option value="">Disable notifications</option>';
      channels
        .filter((c) => c.type === 0 || c.type === 5)
        .forEach((ch) => {
          const opt = document.createElement("option");
          opt.value = ch.id;
          opt.text = `# ${ch.name}`;
          notifySelect.appendChild(opt);
        });
    }

    $("#levelNotifyChannel").select2({
      width: "100%",
      placeholder: "Disable notifications",
      allowClear: true,
    });

    // Load persisted level settings
    const settingsResp = await fetch(
      `/api/server/${guildId}/level-settings-get`
    );
    if (settingsResp.ok) {
      const settings = await settingsResp.json();

      // Notification channel
      if (settings.notify_channel_id && notifySelect) {
        $(notifySelect).val(settings.notify_channel_id).trigger("change");
      }

      // Message style
      if (settings.message_style && messageStyleSelect) {
        messageStyleSelect.value = settings.message_style;
      }

      // Custom messages
      if (settings.custom_message && customMessageTextarea) {
        customMessageTextarea.value = settings.custom_message;
      }
      if (settings.custom_message_role_reward && customMessageRoleTextarea) {
        customMessageRoleTextarea.value = settings.custom_message_role_reward;
      }

      // Role reward behavior
      if (stackRolesCheckbox) {
        stackRolesCheckbox.checked = settings.stack_role_rewards !== false;
      }
      if (announceRolesCheckbox) {
        announceRolesCheckbox.checked =
          settings.announce_role_rewards !== false;
      }

      // Auto-reset configuration
      if (settings.auto_reset) {
        const statusDiv = document.getElementById("autoResetStatus");
        const modeSpan = document.getElementById("autoResetMode");
        const createdOnSpan = document.getElementById("autoResetCreatedOn");
        const nextResetSpan = document.getElementById("autoResetNextReset");

        if (settings.auto_reset.remove_roles) {
          if (autoResetRemoveRolesDaysInput) {
            autoResetRemoveRolesDaysInput.value = settings.auto_reset.days;
          }
          if (autoResetRemoveRolesEnabledCheckbox) {
            autoResetRemoveRolesEnabledCheckbox.checked = true;
          }
          if (modeSpan) {
            modeSpan.textContent = `Resets every ${settings.auto_reset.days} day(s) and removes role rewards`;
          }
        } else {
          if (autoResetDaysInput) {
            autoResetDaysInput.value = settings.auto_reset.days;
          }
          if (autoResetEnabledCheckbox) {
            autoResetEnabledCheckbox.checked = true;
          }
          if (modeSpan) {
            modeSpan.textContent = `Resets every ${settings.auto_reset.days} day(s) and keeps role rewards`;
          }
        }

        if (statusDiv) {
          statusDiv.classList.remove("hidden");
        }

        if (settings.auto_reset.last_reset && createdOnSpan) {
          const createdDate = new Date(settings.auto_reset.last_reset);
          createdOnSpan.textContent =
            createdDate.toLocaleDateString() +
            " " +
            createdDate.toLocaleTimeString();
        }

        if (settings.auto_reset.last_reset && nextResetSpan) {
          const lastReset = new Date(settings.auto_reset.last_reset);
          const nextReset = new Date(lastReset);
          nextReset.setDate(nextReset.getDate() + settings.auto_reset.days);
          nextResetSpan.textContent =
            nextReset.toLocaleDateString() +
            " " +
            nextReset.toLocaleTimeString();
        }
      }
    }
  } catch (e) {
    console.error("Failed to load level settings", e);
  }
}

/**
 * Persist current level settings to the backend for the active guild.
 * Handles multi-button save state and reloads settings on success.
 */
async function saveLevelSettings() {
  console.log("[SAVE] Function called");

  const guildId = window.location.pathname.split("/").pop();
  const notifySelect = document.getElementById("levelNotifyChannel");
  const messageStyleSelect = document.getElementById("levelMessageStyle");
  const customMessageTextarea = document.getElementById("levelCustomMessage");
  const customMessageRoleTextarea = document.getElementById(
    "levelCustomMessageRole"
  );
  const stackRolesCheckbox = document.getElementById("stackRoleRewards");
  const announceRolesCheckbox = document.getElementById("announceRoleRewards");
  const autoResetDaysInput = document.getElementById("autoResetDays");
  const autoResetEnabledCheckbox = document.getElementById("autoResetEnabled");
  const autoResetRemoveRolesDaysInput = document.getElementById(
    "autoResetRemoveRolesDays"
  );
  const autoResetRemoveRolesEnabledCheckbox = document.getElementById(
    "autoResetRemoveRolesEnabled"
  );

  const buttons = document.querySelectorAll(".save-level-btn");
  if (buttons.length === 0) {
    console.error("[SAVE] No save buttons found!");
    return;
  }

  /**
   * Internal helper to synchronize UI state across all save buttons.
   *
   * @param {"loading"|"success"|"error"|"reset"} state - Desired visual state.
   * @param {string|null} [customHtml=null] - Optional custom innerHTML (unused).
   */
  const updateButtons = (state, customHtml = null) => {
    buttons.forEach((btn) => {
      if (state === "loading") {
        btn.disabled = true;
        btn.dataset.originalHtml = btn.innerHTML;
        btn.classList.add("saving");
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
      } else if (state === "success") {
        btn.classList.remove("saving");
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Saved!';
      } else if (state === "error") {
        btn.classList.remove("saving");
        btn.innerHTML = '<i class="fas fa-times mr-2"></i>Error';
      } else if (state === "reset") {
        btn.disabled = false;
        if (btn.dataset.originalHtml) {
          btn.innerHTML = btn.dataset.originalHtml;
        }
      }
    });
  };

  updateButtons("loading");

  try {
    const settings = {
      notify_channel_id: notifySelect?.value || null,
      message_style: messageStyleSelect?.value || "embed",
      custom_message: customMessageTextarea?.value || "",
      custom_message_role_reward: customMessageRoleTextarea?.value || "",
      stack_roles: stackRolesCheckbox?.checked || false,
      announce_roles: announceRolesCheckbox?.checked || false,
      auto_reset_days: parseInt(autoResetDaysInput?.value || "0"),
      auto_reset_enabled: autoResetEnabledCheckbox?.checked || false,
      auto_reset_remove_roles_days: parseInt(
        autoResetRemoveRolesDaysInput?.value || "0"
      ),
      auto_reset_remove_roles_enabled:
        autoResetRemoveRolesEnabledCheckbox?.checked || false,
    };

    console.log("[SAVE] Payload:", settings);
    console.log("[SAVE] URL:", `/api/server/${guildId}/level-settings`);

    const res = await fetch(`/api/server/${guildId}/level-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    console.log("[SAVE] Response status:", res.status);

    if (res.ok) {
      console.log("[SAVE] Save successful!");
      updateButtons("success");

      setTimeout(() => {
        loadLevelSettings();
      }, 500);

      setTimeout(() => {
        updateButtons("reset");
      }, 2000);
    } else {
      const errorText = await res.text();
      console.error("[SAVE] Error response:", errorText);
      throw new Error(`Server error: ${res.status} - ${errorText}`);
    }
  } catch (e) {
    console.error("[SAVE] Exception:", e);
    updateButtons("error");
    alert(`Failed to save: ${e.message}\nCheck browser console for details.`);
    setTimeout(() => {
      updateButtons("reset");
    }, 2000);
  }
}

/**
 * DOMContentLoaded hook:
 *  - Loads initial level settings
 *  - Binds save buttons
 *  - Binds XP reset buttons (with/without role removal)
 */
document.addEventListener("DOMContentLoaded", () => {
  // Only run on pages with the level settings UI
  if (!document.getElementById("levelNotifyChannel")) return;

  loadLevelSettings();

  const saveButtons = document.querySelectorAll(".save-level-btn");
  saveButtons.forEach((btn) => {
    btn.addEventListener("click", saveLevelSettings);
  });

  const btnResetAll = document.getElementById("btnResetAll");
  const btnResetXpOnly = document.getElementById("btnResetXpOnly");

  if (btnResetAll) {
    btnResetAll.addEventListener("click", () => confirmReset(false));
  }
  if (btnResetXpOnly) {
    btnResetXpOnly.addEventListener("click", () => confirmReset(true));
  }
});

/**
 * Confirm and execute XP reset for the guild.
 *
 * @param {boolean} keepRoles - When true, only XP is reset (roles kept);
 *                              when false, XP and role rewards are removed.
 */
async function confirmReset(keepRoles) {
  const action = keepRoles
    ? "Reset XP Only (Keep Roles)"
    : "Reset Everything (Remove Roles)";
  if (
    !confirm(
      `Are you sure you want to ${action}? This action cannot be undone.`
    )
  ) {
    return;
  }

  const guildId = window.location.pathname.split("/").pop();
  const btn = keepRoles
    ? document.getElementById("btnResetXpOnly")
    : document.getElementById("btnResetAll");

  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Resetting...`;

  try {
    const res = await fetch(`/api/server/${guildId}/reset-xp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keep_roles: keepRoles }),
    });

    const data = await res.json();

    if (res.ok) {
      btn.innerHTML = `<i class="fas fa-check mr-2"></i>Done!`;
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
      }, 2000);
      alert("Reset successful!\n" + (data.roles_removed + " Roles Removed."));
    } else {
      throw new Error(data.error || "Unknown Error");
    }
  } catch (e) {
    console.error("Reset failed:", e);
    btn.innerHTML = `<i class="fas fa-times mr-2"></i>Failed`;
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
    }, 3000);
    alert(`Reset Failed: ${e.message}`);
  }
}
