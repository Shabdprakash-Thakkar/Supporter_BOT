/**
 * @file Server Configuration Manager
 * @description
 * Handles all server configuration features for the Supporter Bot dashboard.
 * Centralizes:
 *  - Tab navigation and data loading
 *  - Guild-level settings (XP, cooldowns)
 *  - Level rewards & Discord metadata
 *  - Leaderboard rendering
 *  - YouTube notification configurations
 *  - Channel restrictions (delete hooks)
 *  - Reminder management (list/toggle/delete)
 *  - Timezone clocks
 *  - Global refresh of server analytics & settings
 */

document.addEventListener("DOMContentLoaded", function () {
  const mobileMenuBtn = document.getElementById("mobileNavToggle");
  const mobileMenu = document.getElementById("sidebarNav");

  /**
   * Mobile navigation toggle
   */
  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener("click", function () {
      mobileMenu.classList.toggle("hidden");
    });
  }

  /**
   * Extract guild/server ID from the current URL.
   * Supports routes like `/server/{guildId}` or fallback to last path segment.
   * @returns {string | undefined} guildId
   */
  function getGuildIdFromUrl() {
    const match = window.location.href.match(/\/server\/(\d+)/);
    return match ? match[1] : window.location.pathname.split("/").pop();
  }

  // Resolved guild ID for all subsequent API calls
  const guildId = getGuildIdFromUrl();

  // ==================== TAB NAVIGATION ====================

  const tabs = document.querySelectorAll("[data-tab]");
  const tabContents = document.querySelectorAll("[data-tab-content]");

  /**
   * Primary tab click handling (desktop/top-level navigation).
   */
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;

      // Update active tab styles
      tabs.forEach((t) =>
        t.classList.remove("active", "border-indigo-500", "text-indigo-400")
      );
      tab.classList.add("active", "border-indigo-500", "text-indigo-400");

      // Show corresponding content
      tabContents.forEach((content) => {
        if (content.dataset.tabContent === tabName) {
          content.classList.remove("hidden");
        } else {
          content.classList.add("hidden");
        }
      });

      // Load data for the tab
      loadTabData(tabName);
    });
  });

  /**
   * Global switchTab function for sidebar / mobile navigation.
   * Used by inline onclick handlers in templates.
   *
   * @param {string} tabName - Logical tab key (e.g., "general", "leveling")
   * @param {HTMLElement} [buttonElement] - The clicked nav button, if any
   */
  window.switchTab = function (tabName, buttonElement) {
    // Hide all tab contents by prefix id="tab-"
    const allTabs = document.querySelectorAll('[id^="tab-"]');
    allTabs.forEach((tab) => tab.classList.add("hidden"));

    // Show the selected tab section
    const selectedTab = document.getElementById(`tab-${tabName}`);
    if (selectedTab) {
      selectedTab.classList.remove("hidden");
    }

    // Update button states using "active" class
    const allButtons = document.querySelectorAll(".nav-item");
    allButtons.forEach((btn) => btn.classList.remove("active"));

    if (buttonElement) {
      buttonElement.classList.add("active");
    }

    // Mobile: close sidebar after selecting a tab
    const mobileMenu = document.getElementById("sidebarNav");
    if (mobileMenu && window.innerWidth < 768) {
      mobileMenu.classList.add("hidden");
    }

    // Load data for the selected tab
    loadTabData(tabName);
  };

  // ==================== UTILITY HELPERS ====================

  /**
   * Render a floating notification toast.
   *
   * @param {string} message - Notification message
   * @param {"success" | "error"} [type="success"] - Visual style/intent
   */
  function showNotification(message, type = "success") {
    const notification = document.createElement("div");
    notification.className = `fixed top-4 right-4 px-6 py-4 rounded-lg shadow-lg z-50 ${
      type === "success"
        ? "bg-green-500/20 text-green-400 border border-green-500/30"
        : "bg-red-500/20 text-red-400 border border-red-500/30"
    }`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  /**
   * Wrapper around fetch for JSON APIs with unified error handling.
   *
   * @param {string} endpoint - URL to call
   * @param {RequestInit} [options={}] - fetch options (method, headers, body)
   * @returns {Promise<any>} parsed JSON data
   * @throws Error when response is not ok or network fails
   */
  async function fetchAPI(endpoint, options = {}) {
    try {
      const response = await fetch(endpoint, options);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }

      return data;
    } catch (error) {
      console.error("API Error:", error);
      showNotification(error.message || "An error occurred", "error");
      throw error;
    }
  }

  // ==================== TAB DATA ROUTER ====================

  /**
   * Load data for a given top-level tab.
   *
   * @param {string} tabName - Tab identifier (e.g., "general", "leaderboard")
   * @param {boolean} [force=false] - Optional force reload flag for some tabs
   */
  function loadTabData(tabName, force = false) {
    const guildId = getGuildIdFromUrl();

    switch (tabName) {
      case "general":
      case "settings":
        loadSettings();
        break;

      case "leveling":
      case "rewards": {
        // Determine active sub-tab or default to "rewards"
        const activeSubTab = document.querySelector(".sub-tab-btn.active");
        if (activeSubTab) {
          const subTabName = activeSubTab
            .getAttribute("onclick")
            .match(/switchLevelSubTab\('([^']*)'/)[1];

          if (subTabName === "rewards") {
            loadLevelRewards();
            loadDiscordData();
          } else if (subTabName === "leaderboard") {
            loadLeaderboard();
          } else if (subTabName === "settings") {
            // Sub-tab specific settings can be handled here when needed
          }
        } else {
          // Default for leveling tab when no sub-tab is active
          loadLevelRewards();
          loadDiscordData();
        }
        break;
      }

      case "leaderboard":
        loadLeaderboard();
        break;

      case "youtube":
        if (typeof initYoutubeTab === "function") {
          initYoutubeTab(force);
        }
        break;

      case "restrictions":
        if (typeof initRestrictionTab === "function") {
          initRestrictionTab(force);
        }
        break;

      case "reminders":
        loadReminders();
        break;

      case "time":
      case "clocks":
        loadClocks();
        loadTimezones();
        break;

      case "analytics":
        if (typeof loadAnalyticsDashboard === "function") {
          loadAnalyticsDashboard();
        }
        break;
    }
  }

  // ==================== GENERAL SETTINGS ====================

  /**
   * Load XP and voice activity settings for the current guild.
   */
  async function loadSettings() {
    try {
      const data = await fetchAPI(`/api/server/${guildId}/settings`);

      document.getElementById("xpPerMessage").value = data.xp_per_message || 5;
      document.getElementById("xpPerImage").value = data.xp_per_image || 10;
      document.getElementById("xpPerVoice").value =
        data.xp_per_minute_in_voice || 15;
      document.getElementById("voiceXpLimit").value =
        data.voice_xp_limit || 1500;

      const cooldownSelect = document.getElementById("xpCooldown");
      if (cooldownSelect) {
        cooldownSelect.value = data.xp_cooldown || 60;
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }

  /**
   * Handle settings form submission (XP / voice XP configuration).
   */
  const settingsForm = document.getElementById("settings-form");
  if (settingsForm) {
    settingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const formData = {
        xp_per_message: parseInt(document.getElementById("xpPerMessage").value),
        xp_per_image: parseInt(document.getElementById("xpPerImage").value),
        xp_per_minute_in_voice: parseInt(
          document.getElementById("xpPerVoice").value
        ),
        voice_xp_limit: parseInt(document.getElementById("voiceXpLimit").value),
      };

      try {
        await fetchAPI(`/api/server/${guildId}/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        showNotification("Settings saved successfully!");
      } catch (error) {
        console.error("Failed to save settings:", error);
      }
    });
  }

  // ==================== LEVEL REWARDS & DISCORD DATA ====================

  /**
   * Placeholder loader for level rewards UI.
   * Actual rendering may be handled by a dedicated module or server-rendered HTML.
   */
  async function loadLevelRewards() {
    try {
      const response = await fetch(`/api/server/${guildId}/discord-data`);
      const data = await response.json();

      const rewardsList = document.getElementById("rewards-list");
      if (!rewardsList) return;

      // Intentionally not overriding innerHTML:
      // rewards content is expected to be managed by another script/template.
      void data;
    } catch (error) {
      console.error("Failed to load level rewards:", error);
    }
  }

  /**
   * Load Discord metadata (roles & channels) for dropdowns used by rewards,
   * reminders, clocks, etc.
   */
  async function loadDiscordData() {
    try {
      const data = await fetchAPI(`/api/server/${guildId}/discord-data`);

      // Populate role dropdowns
      const roleSelect = document.getElementById("reward-role");
      if (roleSelect && data.roles) {
        roleSelect.innerHTML = '<option value="">Select a role...</option>';
        data.roles.forEach((role) => {
          const option = document.createElement("option");
          option.value = role.id;
          option.textContent = role.name;
          roleSelect.appendChild(option);
        });
      }

      // Populate text channel dropdowns (type === 0)
      const channelSelects = document.querySelectorAll(".channel-select");
      if (data.channels) {
        channelSelects.forEach((select) => {
          select.innerHTML = '<option value="">Select a channel...</option>';
          data.channels
            .filter((ch) => ch.type === 0)
            .forEach((channel) => {
              const option = document.createElement("option");
              option.value = channel.id;
              option.textContent = `# ${channel.name}`;
              select.appendChild(option);
            });
        });
      }
    } catch (error) {
      console.error("Failed to load Discord data:", error);
    }
  }

  /**
   * Handle "Add Level Reward" form submission.
   * Sends role reward configuration for a specific level.
   */
  const rewardForm = document.getElementById("reward-form");
  if (rewardForm) {
    rewardForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const level = parseInt(document.getElementById("reward-level").value);
      const roleId = document.getElementById("reward-role").value;
      const roleName =
        document.getElementById("reward-role").selectedOptions[0].text;

      try {
        await fetchAPI(`/api/server/${guildId}/level-reward`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ level, role_id: roleId, role_name: roleName }),
        });

        showNotification(`Reward added for Level ${level}!`);
        rewardForm.reset();
        loadLevelRewards();
      } catch (error) {
        console.error("Failed to add reward:", error);
      }
    });
  }

  // ==================== LEADERBOARD ====================

  /**
   * Load and render the server XP leaderboard.
   */
  async function loadLeaderboard() {
    try {
      const data = await fetchAPI(`/api/server/${guildId}/leaderboard`);

      const leaderboardList = document.getElementById("leaderboard-list");
      if (!leaderboardList) return;

      if (!data.leaderboard || data.leaderboard.length === 0) {
        leaderboardList.innerHTML =
          '<p class="text-slate-400 text-center py-8">No users have earned XP yet!</p>';
        return;
      }

      leaderboardList.innerHTML = data.leaderboard
        .map(
          (user, index) => `
        <div class="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 hover:border-indigo-500/30 transition-all">
          <div class="flex items-center gap-4">
            <span class="text-2xl font-bold ${
              index < 3 ? "text-yellow-400" : "text-slate-500"
            }">#${index + 1}</span>
            <div>
              <p class="font-bold text-white">${
                user.username || "Unknown User"
              }</p>
              <p class="text-sm text-slate-400">Level ${user.level}</p>
            </div>
          </div>
          <div class="text-right">
            <p class="font-bold text-indigo-400">${user.xp.toLocaleString()} XP</p>
          </div>
        </div>
      `
        )
        .join("");
    } catch (error) {
      console.error("Failed to load leaderboard:", error);
    }
  }

  // ==================== YOUTUBE NOTIFICATIONS ====================

  /**
   * Load configured YouTube notification channels for this guild.
   */
  async function loadYouTubeConfigs() {
    try {
      const data = await fetchAPI(`/api/server/${guildId}/youtube`);

      const configsList = document.getElementById("youtube-configs-list");
      if (!configsList) return;

      if (!data.configs || data.configs.length === 0) {
        configsList.innerHTML =
          '<p class="text-slate-400 text-center py-8">No YouTube notifications configured</p>';
        return;
      }

      configsList.innerHTML = data.configs
        .map(
          (config) => `
        <div class="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-bold text-white">${
                config.name || "Unknown Channel"
              }</p>
              <p class="text-sm text-slate-400">ID: ${config.yt_id}</p>
            </div>
            <button onclick="deleteYouTubeConfig('${
              config.yt_id
            }')" class="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-all">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `
        )
        .join("");
    } catch (error) {
      console.error("Failed to load YouTube configs:", error);
    }
  }

  /**
   * Delete a single YouTube notification configuration.
   * Exposed globally for inline onclick handlers.
   *
   * @param {string} ytId - YouTube channel or feed ID
   */
  window.deleteYouTubeConfig = async function (ytId) {
    if (!confirm("Are you sure you want to remove this YouTube notification?"))
      return;

    try {
      await fetchAPI(`/api/server/${guildId}/youtube?yt_id=${ytId}`, {
        method: "DELETE",
      });

      showNotification("YouTube notification removed!");
      loadYouTubeConfigs();
    } catch (error) {
      console.error("Failed to delete YouTube config:", error);
    }
  };

  // ==================== CHANNEL RESTRICTIONS ====================

  /**
   * Placeholder for channel restriction loader.
   * Actual logic is delegated to initRestrictionTab / loadRestrictions.
   */
  async function loadChannelRestrictions() {}

  /**
   * Placeholder edit handler for channel restrictions.
   * In future, can be wired to an edit modal or inline editor.
   *
   * @param {string | number} id - Restriction identifier
   */
  window.editRestriction = function (id) {
    showNotification("Edit functionality coming soon!", "error");
    console.log("Edit restriction:", id);
  };

  /**
   * Delete a channel restriction rule.
   *
   * @param {string | number} id - Restriction identifier
   */
  window.deleteRestriction = async function (id) {
    if (!confirm("Are you sure you want to remove this restriction?")) return;

    try {
      await fetchAPI(
        `/api/server/${guildId}/channel-restrictions-v2?id=${id}`,
        {
          method: "DELETE",
        }
      );

      showNotification("Restriction removed!");
      if (typeof loadRestrictions === "function")
        loadRestrictions(getGuildIdFromUrl());
    } catch (error) {
      console.error("Failed to delete restriction:", error);
    }
  };

  // ==================== REMINDERS ====================

  /**
   * Load recurring reminders configured for this guild.
   */
  async function loadReminders() {
    try {
      const data = await fetchAPI(`/api/server/${guildId}/reminders`);

      const remindersList = document.getElementById("reminders-list");
      if (!remindersList) return;

      if (!data.reminders || data.reminders.length === 0) {
        remindersList.innerHTML =
          '<p class="text-slate-400 text-center py-8">No reminders configured</p>';
        return;
      }

      remindersList.innerHTML = data.reminders
        .map((reminder) => {
          const nextRun = new Date(reminder.next_run);
          const status =
            reminder.status === "active" ? "✅ Active" : "⏸️ Paused";

          return `
          <div class="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
            <div class="flex items-center justify-between mb-2">
              <p class="font-bold text-white">${reminder.message.substring(
                0,
                50
              )}...</p>
              <span class="text-sm ${
                reminder.status === "active"
                  ? "text-green-400"
                  : "text-yellow-400"
              }">${status}</span>
            </div>
            <p class="text-sm text-slate-400 mb-2">Next run: ${nextRun.toLocaleString()}</p>
            <p class="text-sm text-slate-400 mb-3">Interval: ${
              reminder.interval
            }</p>
            <div class="flex gap-2">
              <button onclick="toggleReminder('${
                reminder.reminder_id
              }')" class="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded hover:bg-yellow-500/30 transition-all text-sm">
                ${reminder.status === "active" ? "Pause" : "Resume"}
              </button>
              <button onclick="deleteReminder('${
                reminder.reminder_id
              }')" class="px-3 py-1 bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-all text-sm">
                Delete
              </button>
            </div>
          </div>
        `;
        })
        .join("");
    } catch (error) {
      console.error("Failed to load reminders:", error);
    }
  }

  /**
   * Toggle a reminder's active/paused status.
   *
   * @param {string} reminderId
   */
  window.toggleReminder = async function (reminderId) {
    try {
      const data = await fetchAPI(
        `/api/server/${guildId}/reminders/${reminderId}/toggle`,
        {
          method: "POST",
        }
      );

      showNotification(`Reminder ${data.new_status}!`);
      loadReminders();
    } catch (error) {
      console.error("Failed to toggle reminder:", error);
    }
  };

  /**
   * Delete a reminder.
   *
   * @param {string} reminderId
   */
  window.deleteReminder = async function (reminderId) {
    if (!confirm("Are you sure you want to delete this reminder?")) return;

    try {
      await fetchAPI(`/api/server/${guildId}/reminders/${reminderId}`, {
        method: "DELETE",
      });

      showNotification("Reminder deleted!");
      loadReminders();
    } catch (error) {
      console.error("Failed to delete reminder:", error);
    }
  };

  // ==================== TIMEZONE CLOCKS ====================

  /**
   * Load list of available timezones for clock configuration.
   */
  async function loadTimezones() {
    try {
      const data = await fetchAPI("/api/timezones");

      const timezoneSelect = document.getElementById("clock-timezone");
      if (timezoneSelect && data.timezones) {
        timezoneSelect.innerHTML =
          '<option value="">Select timezone...</option>';
        data.timezones.forEach((tz) => {
          const option = document.createElement("option");
          option.value = tz;
          option.textContent = tz;
          timezoneSelect.appendChild(option);
        });
      }
    } catch (error) {
      console.error("Failed to load timezones:", error);
    }
  }

  /**
   * Load configured timezone clocks for this guild.
   */
  async function loadClocks() {
    try {
      const data = await fetchAPI(`/api/server/${guildId}/clocks`);

      const clocksList = document.getElementById("clocks-list");
      if (!clocksList) return;

      if (!data.clocks || data.clocks.length === 0) {
        clocksList.innerHTML =
          '<p class="text-slate-400 text-center py-8">No clocks configured</p>';
        return;
      }

      clocksList.innerHTML = data.clocks
        .map(
          (clock) => `
        <div class="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-bold text-white">${clock.timezone}</p>
              <p class="text-sm text-slate-400">Channel ID: ${clock.channel_id}</p>
            </div>
            <button onclick="deleteClock('${clock.channel_id}')" class="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-all">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `
        )
        .join("");
    } catch (error) {
      console.error("Failed to load clocks:", error);
    }
  }

  /**
   * Delete a configured timezone clock.
   *
   * @param {string} channelId - Discord channel ID tied to the clock
   */
  window.deleteClock = async function (channelId) {
    if (!confirm("Are you sure you want to remove this clock?")) return;

    try {
      await fetchAPI(`/api/server/${guildId}/clocks?channel_id=${channelId}`, {
        method: "DELETE",
      });

      showNotification("Clock removed!");
      loadClocks();
    } catch (error) {
      console.error("Failed to delete clock:", error);
    }
  };

  // ==================== GLOBAL REFRESH ====================

  /**
   * Refresh server analytics and settings from Discord / backend.
   * Also reloads the currently active tab data.
   */
  window.refreshAllData = async function () {
    const refreshBtn = document.getElementById("refreshBtn");
    const refreshIcon = refreshBtn.querySelector("i");

    // Add spinning animation
    refreshIcon.classList.add("fa-spin");
    refreshBtn.disabled = true;

    try {
      const data = await fetchAPI(`/api/server/${guildId}/refresh`);

      // Update stat cards
      document.getElementById("totalMembers").textContent =
        data.total_members.toLocaleString();
      document.getElementById("newMembers").textContent =
        data.guild_stats.new_members_this_week;
      document.getElementById("messagesCount").textContent =
        data.guild_stats.messages_this_week;

      // Update settings if settings fields are present
      const xpPerMessage = document.getElementById("xpPerMessage");
      if (xpPerMessage) {
        xpPerMessage.value = data.settings.xp_per_message;
        document.getElementById("xpPerImage").value =
          data.settings.xp_per_image;
        document.getElementById("xpPerVoice").value =
          data.settings.xp_per_minute_in_voice;
        document.getElementById("voiceXpLimit").value =
          data.settings.voice_xp_limit;
        document.getElementById("xpCooldown").value = data.settings.xp_cooldown;
      }

      showNotification("✅ Data refreshed successfully!", "success");

      // Reload current active nav tab, if identifiable
      const activeNavItem = document.querySelector(
        ".nav-item.bg-indigo-600\\/20"
      );
      if (activeNavItem) {
        const tabName = activeNavItem.getAttribute("data-tab");
        if (tabName) {
          loadTabData(tabName, true);
        }
      }
    } catch (error) {
      console.error("Failed to refresh data:", error);
      showNotification("Failed to refresh data", "error");
    } finally {
      // Remove spinning animation
      refreshIcon.classList.remove("fa-spin");
      refreshBtn.disabled = false;
    }
  };

  // ==================== INITIALIZATION ====================

  /**
   * Initialize first active tab on page load.
   */
  const activeTab = document.querySelector("[data-tab].active");
  if (activeTab) {
    loadTabData(activeTab.dataset.tab);
  }
});
