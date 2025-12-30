// v4.0.0
/**
 * @file Leaderboard Tab Logic
 * @description
 * Handles loading, refreshing, and rendering of the server leaderboard.
 *
 * NOTE:
 * - There are two `loadLeaderboard` functions defined.
 * - The second definition overrides the first in JavaScript's function hoisting,
 *   but the first is kept for backwards compatibility with any legacy usage.
 */

// ==================== LEGACY LEADERBOARD LOADER (BACKWARDS COMPAT) ====================

/**
 * Legacy leaderboard loader using `#leaderboardTable tbody`.
 * Kept for compatibility with older markup; overridden by the newer implementation below.
 *
 * @returns {Promise<void>}
 */
async function loadLeaderboard() {
  const guildId = window.location.pathname.split("/").pop();
  const tableBody = document.querySelector("#leaderboardTable tbody");

  if (!tableBody) return;

  try {
    const res = await fetch(`/api/server/${guildId}/leaderboard`);
    if (!res.ok) throw new Error("Leaderboard API error");
    const data = await res.json();

    tableBody.innerHTML = "";

    if (!data.leaderboard || data.leaderboard.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-slate-500 p-6">No data available.</td></tr>`;
      return;
    }

    data.leaderboard.forEach((entry, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td class="truncate">${entry.username || entry.user_id}</td>
        <td>${entry.level ?? 0}</td>
        <td>${entry.xp ?? 0}</td>
      `;
      tableBody.appendChild(tr);
    });
  } catch (e) {
    console.error("Failed loading leaderboard", e);
    tableBody.innerHTML = `<tr><td colspan="4" class="text-center text-red-500 p-6">Failed to load leaderboard.</td></tr>`;
  }
}

// ==================== EVENT WIRING (REFRESH & AUTO-LOAD) ====================

/**
 * Binds the refresh button and auto-loads the leaderboard when the DOM is ready.
 */
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("refreshLeaderboardBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      // Show loading state in the leaderboard body before refreshing data
      document.querySelector("#leaderboardBody").innerHTML =
        '<tr><td colspan="4" class="text-center py-8 text-slate-500"><i class="fas fa-spinner fa-spin mr-2"></i>Loading...</td></tr>';
      loadLeaderboard();
    });
  }

  // Initial load of leaderboard data
  loadLeaderboard();
});

// ==================== PRIMARY LEADERBOARD LOADER (CURRENT IMPLEMENTATION) ====================

/**
 * Primary leaderboard loader using `#leaderboardBody`.
 * This implementation:
 *  - Adds a cache-busting query parameter to the request
 *  - Renders rank badges and user avatars
 *  - Provides a friendly empty-state message
 *
 * @returns {Promise<void>}
 */
window.loadLeaderboard = async function () {
  const guildId = window.location.pathname.split("/").pop();
  const tbody = document.getElementById("leaderboardBody");

  try {
    const response = await fetch(
      `/api/server/${guildId}/leaderboard?t=${Date.now()}`
    );
    const data = await response.json();

    if (!data.leaderboard || data.leaderboard.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-center py-8 text-slate-500">No leaderboard data yet. Start chatting to earn XP!</td></tr>';
      return;
    }

    tbody.innerHTML = data.leaderboard
      .map((user, index) => {
        const rank = index + 1;
        let rankBadge;

        if (rank === 1) {
          rankBadge = `<span class="rank-badge gold">${rank}</span>`;
        } else if (rank === 2) {
          rankBadge = `<span class="rank-badge silver">${rank}</span>`;
        } else if (rank === 3) {
          rankBadge = `<span class="rank-badge bronze">${rank}</span>`;
        } else {
          rankBadge = `<span class="text-slate-500 font-bold">${rank}</span>`;
        }

        const avatarUrl = user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.user_id}/${user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${rank % 5}.png`;

        return `
      <tr>
        <td class="text-center">${rankBadge}</td>
        <td>
          <div class="flex items-center gap-3">
            <img src="${avatarUrl}" class="w-8 h-8 rounded-full" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" />
            <span class="font-bold ${rank <= 3 ? "" : "text-slate-300"}">${user.username || "Unknown User"
          }</span>
          </div>
        </td>
        <td class="text-center font-bold text-indigo-400">${user.level || 0
          }</td>
        <td class="text-center text-slate-400">${(
            user.xp || 0
          ).toLocaleString()} XP</td>
      </tr>
    `;
      })
      .join("");
  } catch (error) {
    console.error("Failed to load leaderboard:", error);
    tbody.innerHTML =
      '<tr><td colspan="4" class="text-center py-8 text-red-400">Failed to load leaderboard</td></tr>';
  }
}
