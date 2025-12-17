/**
 * @file Full Leaderboard Page Logic
 * @description
 * Handles:
 *  - Loading the full server leaderboard (all members with XP)
 *  - Debounced search over leaderboard entries
 *  - Manual refresh of leaderboard data
 *  - Safe HTML rendering of usernames
 */

/** Debounce handle for search input. */
let searchTimeout;


(function () {
  if (document.body.id !== 'page-leaderboard-full') return;

  // ==================== INITIALIZATION ====================

  document.addEventListener("DOMContentLoaded", () => {
    // Initial load with no search query
    loadFullLeaderboard();

    // Attach search listener with debounce
    const searchInput = document.getElementById("leaderboardSearch");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value;

        // Debounce search requests to avoid spamming the API
        searchTimeout = setTimeout(() => {
          loadFullLeaderboard(query);
        }, 500);
      });
    }

    // Attach refresh button listener
    const refreshBtn = document.getElementById("refreshFullLeaderboardBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        const query = searchInput ? searchInput.value : "";
        loadFullLeaderboard(query);
      });
    }
  });

  // ==================== DATA LOADING & RENDERING ====================

  /**
   * Load the full leaderboard from the backend and render the table.
   *
   * @param {string} [searchQuery=""] - Optional search query to filter members.
   * @returns {Promise<void>}
   */
  async function loadFullLeaderboard(searchQuery = "") {
    // URL structure: /dashboard/server/{GUILD_ID}/view-leaderboard
    const guildId = window.location.pathname.split("/")[3];
    const tbody = document.getElementById("fullLeaderboardBody");

    const loadingRow = `
        <tr>
            <td colspan="4" class="text-center py-12">
                <div class="inline-flex flex-col items-center justify-center text-slate-500">
                    <i class="fas fa-spinner fa-spin text-3xl mb-3 text-indigo-500"></i>
                    <p>Loading leaderboard data...</p>
                </div>
            </td>
        </tr>`;

    tbody.innerHTML = loadingRow;

    try {
      let url = `/api/server/${guildId}/leaderboard?limit=all&t=${Date.now()}`;
      if (searchQuery) {
        url += `&search=${encodeURIComponent(searchQuery)}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (!data.leaderboard || data.leaderboard.length === 0) {
        tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="text-center py-12 text-slate-500">
                        <i class="fas fa-search text-2xl mb-2 opacity-50"></i>
                        <p>No members found${searchQuery ? ` matching "${searchQuery}"` : ""
          }.</p>
                    </td>
                </tr>`;
        return;
      }

      tbody.innerHTML = data.leaderboard
        .map((user, index) => {
          const rank = index + 1;
          let rankClass = "rank-normal";
          let rankContent = rank;

          if (rank === 1) {
            rankClass = "rank-gold";
          } else if (rank === 2) {
            rankClass = "rank-silver";
          } else if (rank === 3) {
            rankClass = "rank-bronze";
          }

          const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.user_id}/${user.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${rank % 5}.png`;

          return `
                <tr class="transition-colors hover:bg-slate-800/30">
                    <td class="text-center">
                        <span class="rank-badge-full ${rankClass}">${rankContent}</span>
                    </td>
                    <td>
                        <div class="user-cell">
                            <img src="${avatarUrl}" class="user-avatar-lg" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                            <span class="user-name-lg ${rank <= 3 ? "text-white" : "text-slate-300"
            }">${escapeHtml(
              user.username || "Unknown User"
            )}</span>
                        </div>
                    </td>
                    <td>
                        <span class="level-badge">Lvl ${user.level || 0}</span>
                    </td>
                    <td>
                        <span class="xp-text">${(
              user.xp || 0
            ).toLocaleString()} XP</span>
                    </td>
                </tr>
            `;
        })
        .join("");
    } catch (e) {
      console.error("Leaderboard load failed:", e);
      tbody.innerHTML = `
            <tr>
                <td colspan="4" class="text-center py-12 text-red-400">
                    <i class="fas fa-exclamation-triangle mb-2"></i>
                    <p>Failed to load leaderboard data.</p>
                </td>
            </tr>`;
    }
  }

  // ==================== UTILITIES ====================

  /**
   * Escape potentially unsafe HTML in usernames and other user-provided fields.
   *
   * @param {string} text - Raw text to escape.
   * @returns {string} Safe HTML-escaped string.
   */
  function escapeHtml(text) {
    if (!text) return text;
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

})();
