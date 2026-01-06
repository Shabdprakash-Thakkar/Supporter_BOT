// v5.0.0
// v4.0.0
/**
 * @file Owner Dashboard Client Script
 * @description
 * Frontend interactions for the Supporter Bot owner dashboard:
 *  - Layout: server search
 *  - Refresh: server table and full dashboard data (XHR-based partial reloads)
 *  - Owner actions: leave, ban, unban servers (table + manual controls)
 *  - UX: notification toasts and row transition animations
 */

// ==================== INITIALIZATION & UI BINDINGS ====================

document.addEventListener("DOMContentLoaded", function () {

  /**
   * Live filter for server cards on the dashboard.
   * Filters elements with `.server-card` by their `data-name` attribute.
   */
  const searchInput = document.getElementById("serverSearch");
  if (searchInput) {
    searchInput.addEventListener("input", function (e) {
      const query = e.target.value.toLowerCase();

      document.querySelectorAll(".server-card").forEach((card) => {
        const name = card.getAttribute("data-name").toLowerCase();
        if (name.includes(query)) {
          card.style.display = "";
        } else {
          card.style.display = "none";
        }
      });
    });
  }
});

// ==================== SERVER LIST REFRESH ====================

/**
 * Refresh server table data for the current page without a full reload.
 * Uses XHR to fetch updated HTML and replaces:
 *  - #serverTableContainer content
 *  - server count in stat card (if present)
 */
function refreshServerData() {
  const refreshBtn = document.getElementById("refreshBtn");
  const refreshIcon = document.getElementById("refreshIcon");
  const serverCount = document.getElementById("serverCount");

  refreshBtn.disabled = true;
  refreshIcon.classList.add("fa-spin");

  fetch(window.location.href, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
    },
  })
    .then((response) => response.text())
    .then((html) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const newTableContainer = doc.getElementById("serverTableContainer");
      const currentTableContainer = document.getElementById(
        "serverTableContainer"
      );

      if (newTableContainer && currentTableContainer) {
        currentTableContainer.innerHTML = newTableContainer.innerHTML;

        const newCount = doc.getElementById("serverCount");
        if (newCount) {
          const statsCard = document.querySelector(
            ".stat-card .text-indigo-400"
          );
          if (statsCard) {
            statsCard.textContent = newCount.textContent.split(" ")[0];
          }
        }

        showNotification("Server list refreshed successfully", "success");
      } else {
        showNotification("Failed to refresh server list", "error");
      }
    })
    .catch((error) => {
      console.error("Refresh error:", error);
      showNotification("Error refreshing server list", "error");
    })
    .finally(() => {
      refreshBtn.disabled = false;
      refreshIcon.classList.remove("fa-spin");
    });
}

// ==================== FULL DASHBOARD REFRESH ====================

/**
 * Refresh all major dashboard sections on the current page via XHR:
 *  - Owner controls panel
 *  - Active server list
 *  - Invite list
 */
function refreshAllData() {
  const refreshBtn = document.getElementById("refreshAllBtn");
  const refreshIcon = document.getElementById("refreshAllIcon");

  refreshBtn.disabled = true;
  refreshIcon.classList.add("fa-spin");

  fetch(window.location.href, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
    },
  })
    .then((response) => response.text())
    .then((html) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const newOwnerPanel = doc.querySelector(".owner-panel");
      const currentOwnerPanel = document.querySelector(".owner-panel");
      if (newOwnerPanel && currentOwnerPanel) {
        currentOwnerPanel.innerHTML = newOwnerPanel.innerHTML;
      }

      const newActiveList = doc.getElementById("activeList");
      const currentActiveList = document.getElementById("activeList");
      if (newActiveList && currentActiveList) {
        currentActiveList.innerHTML = newActiveList.innerHTML;
      }

      const newInviteList = doc.getElementById("inviteList");
      const currentInviteList = document.getElementById("inviteList");
      if (newInviteList && currentInviteList) {
        currentInviteList.innerHTML = newInviteList.innerHTML;
      }

      showNotification("All data refreshed successfully", "success");
    })
    .catch((error) => {
      console.error("Refresh error:", error);
      showNotification("Error refreshing data", "error");
    })
    .finally(() => {
      refreshBtn.disabled = false;
      refreshIcon.classList.remove("fa-spin");
    });
}

// ==================== OWNER ACTIONS: LEAVE / BAN / UNBAN ====================

/**
 * Perform owner-level action from the manual Guild ID input panel.
 * Currently supports:
 *  - action === "leave": force bot to leave a guild.
 *
 * @param {"leave"} action - type of owner action to execute
 */
function ownerAction(action) {
  const guildId = document.getElementById("targetGuildId").value;
  const msgEl = document.getElementById("ownerMsg");

  if (!guildId) {
    msgEl.textContent = "Please enter a Guild ID";
    msgEl.className = "mt-2 text-sm font-bold text-red-400";
    return;
  }

  if (action === "leave") {
    if (confirm(`Are you sure you want to force leave guild ${guildId}?`)) {
      msgEl.textContent = "Processing...";
      msgEl.className = "mt-2 text-sm font-bold text-yellow-400";

      fetch("/api/owner/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guild_id: guildId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            msgEl.textContent = data.message || "Successfully left guild";
            msgEl.className = "mt-2 text-sm font-bold text-green-400";
            setTimeout(() => location.reload(), 1500);
          } else {
            msgEl.textContent = data.error || "Failed to leave guild";
            msgEl.className = "mt-2 text-sm font-bold text-red-400";
          }
        })
        .catch((err) => {
          msgEl.textContent = "Error: " + err.message;
          msgEl.className = "mt-2 text-sm font-bold text-red-400";
        });
    }
  }
}

/**
 * Leave a specific server from the management table.
 * Provides optimistic UI feedback by dimming/removing the row and updating
 * the displayed server count.
 *
 * @param {string} guildId - Target guild ID
 * @param {string} serverName - Server name for confirmation UI
 */
function ownerLeaveServer(guildId, serverName) {
  if (
    confirm(
      `⚠️ Are you sure you want to leave "${serverName}"?\n\nGuild ID: ${guildId}\n\nThis will remove all bot data for this server.`
    )
  ) {
    const row = document.querySelector(`tr[data-guild-id="${guildId}"]`);
    if (row) {
      row.style.opacity = "0.5";
      row.style.pointerEvents = "none";
    }

    fetch("/api/owner/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guild_id: guildId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          if (row) {
            row.style.transition = "all 0.3s ease";
            row.style.transform = "translateX(-100%)";
            row.style.opacity = "0";
            setTimeout(() => {
              row.remove();
              const countSpan = document.querySelector(
                ".bg-brand-card\\/50 .text-slate-400"
              );
              if (countSpan) {
                const currentCount = parseInt(countSpan.textContent);
                countSpan.textContent = `${currentCount - 1} servers`;
              }
            }, 300);
          }
          showNotification("Successfully left " + serverName, "success");
        } else {
          if (row) {
            row.style.opacity = "1";
            row.style.pointerEvents = "auto";
          }
          showNotification(data.error || "Failed to leave server", "error");
        }
      })
      .catch((err) => {
        if (row) {
          row.style.opacity = "1";
          row.style.pointerEvents = "auto";
        }
        showNotification("Error: " + err.message, "error");
      });
  }
}

/**
 * Ban a server directly from the server list.
 * This will:
 *  - Remove the bot from the server
 *  - Delete all stored server data
 *  - Prevent the server from re-adding the bot
 *
 * @param {string} guildId - Target guild ID
 * @param {string} guildName - Server name for confirmation UI
 * @param {number} memberCount - Member count (informational in prompt)
 */
function ownerBanServer(guildId, guildName, memberCount) {
  if (
    confirm(
      `⚠️ Are you sure you want to BAN "${guildName}"?\n\nGuild ID: ${guildId}\nMembers: ${memberCount}\n\nThis will:\n- Remove the bot from the server\n- Delete all server data\n- Prevent the server from re-adding the bot`
    )
  ) {
    const row = document.querySelector(`tr[data-guild-id="${guildId}"]`);
    if (row) {
      row.style.opacity = "0.5";
      row.style.pointerEvents = "none";
    }

    fetch("/api/owner/ban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guild_id: guildId,
        guild_name: guildName,
        member_count: memberCount,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          if (row) {
            row.style.transition = "all 0.3s ease";
            row.style.transform = "translateX(-100%)";
            row.style.opacity = "0";
            setTimeout(() => row.remove(), 300);
          }
          showNotification("Server banned successfully", "success");
          setTimeout(() => location.reload(), 1500);
        } else {
          if (row) {
            row.style.opacity = "1";
            row.style.pointerEvents = "auto";
          }
          showNotification(data.error || "Failed to ban server", "error");
        }
      })
      .catch((err) => {
        if (row) {
          row.style.opacity = "1";
          row.style.pointerEvents = "auto";
        }
        showNotification("Error: " + err.message, "error");
      });
  }
}

/**
 * Unban a server from the banned guilds table.
 *
 * @param {string} guildId - Banned guild ID
 * @param {string} serverName - Server name for confirmation UI
 */
function ownerUnbanServer(guildId, serverName) {
  if (
    confirm(
      `Are you sure you want to UNBAN "${serverName}"?\n\nGuild ID: ${guildId}\n\nThe server will be able to re-add the bot.`
    )
  ) {
    const row = document.querySelector(`tr[data-banned-guild-id="${guildId}"]`);
    if (row) {
      row.style.opacity = "0.5";
      row.style.pointerEvents = "none";
    }

    fetch("/api/owner/unban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guild_id: guildId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          if (row) {
            row.style.transition = "all 0.3s ease";
            row.style.transform = "translateX(100%)";
            row.style.opacity = "0";
            setTimeout(() => row.remove(), 300);
          }
          showNotification(data.message, "success");
        } else {
          if (row) {
            row.style.opacity = "1";
            row.style.pointerEvents = "auto";
          }
          showNotification(data.error || "Failed to unban server", "error");
        }
      })
      .catch((err) => {
        if (row) {
          row.style.opacity = "1";
          row.style.pointerEvents = "auto";
        }
        showNotification("Error: " + err.message, "error");
      });
  }
}

/**
 * Unban a server using a manually entered Guild ID from the input panel.
 * Also removes the corresponding row from the banned table if present.
 */
function ownerUnbanById() {
  const input = document.getElementById("unbanGuildId");
  const msgEl = document.getElementById("unbanMsg");
  const guildId = input.value.trim();

  if (!guildId) {
    msgEl.textContent = "Please enter a Guild ID";
    msgEl.className = "mt-2 text-sm font-bold text-red-400";
    return;
  }

  if (confirm(`Are you sure you want to unban Guild ID: ${guildId}?`)) {
    msgEl.textContent = "Processing...";
    msgEl.className = "mt-2 text-sm font-bold text-yellow-400";

    fetch("/api/owner/unban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guild_id: guildId }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          msgEl.textContent = data.message;
          msgEl.className = "mt-2 text-sm font-bold text-green-400";
          input.value = "";
          showNotification(data.message, "success");

          const row = document.querySelector(
            `tr[data-banned-guild-id="${guildId}"]`
          );
          if (row) {
            row.style.transition = "all 0.3s ease";
            row.style.transform = "translateX(100%)";
            row.style.opacity = "0";
            setTimeout(() => row.remove(), 300);
          }
        } else {
          msgEl.textContent = data.error || "Failed to unban server";
          msgEl.className = "mt-2 text-sm font-bold text-red-400";
          showNotification(data.error || "Failed to unban server", "error");
        }
      })
      .catch((err) => {
        msgEl.textContent = "Error: " + err.message;
        msgEl.className = "mt-2 text-sm font-bold text-red-400";
        showNotification("Error: " + err.message, "error");
      });
  }
}

// ==================== NOTIFICATION TOASTS ====================

/**
 * Show a transient toast notification in the bottom-right corner.
 *
 * @param {string} message - Text content to display in the toast
 * @param {"info" | "success" | "error"} [type="info"] - Visual style/intent
 */
function showNotification(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg font-bold text-white shadow-lg z-50 animate-slide-in-right ${type === "success"
      ? "bg-green-500"
      : type === "error"
        ? "bg-red-500"
        : "bg-indigo-500"
    }`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = "all 0.3s ease";
    toast.style.transform = "translateX(400px)";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==================== GLOBAL EXPORTS ====================
window.refreshServerData = refreshServerData;
window.refreshAllData = refreshAllData;
window.ownerAction = ownerAction;
window.ownerLeaveServer = ownerLeaveServer;
window.ownerBanServer = ownerBanServer;
window.ownerUnbanServer = ownerUnbanServer;
window.ownerUnbanById = ownerUnbanById;
