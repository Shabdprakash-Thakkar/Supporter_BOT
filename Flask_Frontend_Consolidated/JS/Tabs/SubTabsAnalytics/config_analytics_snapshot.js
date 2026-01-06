// v5.0.0
// v4.0.0
/**
 * @file Analytics Snapshot Detail JavaScript
 * @description
 * Handles:
 *  - Fetching a stored analytics snapshot for a guild
 *  - Rendering snapshot metrics, trends, and insights
 *  - Showing basic error and loading states
 */




(function () {
  if (document.body.id !== 'page-analytics-snapshot') return;

  // ===================== INITIALIZATION =====================

  document.addEventListener("DOMContentLoaded", () => {
    loadSnapshot();
  });

  // ===================== DATA LOADING =====================

  /**
   * Fetch the analytics snapshot from the backend and render it.
   * Relies on global variables:
   *  - guildId:   current Discord server ID
   *  - snapshotId: target snapshot identifier
   */
  async function loadSnapshot() {
    try {
      const response = await fetch(
        `/api/analytics/${guildId}/snapshot/${snapshotId}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch snapshot");
      }

      const snapshot = await response.json();
      renderSnapshot(snapshot);
    } catch (error) {
      console.error("Error loading snapshot:", error);
      showError();
    }
  }

  // ===================== RENDERING =====================

  /**
   * Render all snapshot sections into the page.
   *
   * @param {Object} snapshot - Full snapshot payload from the API.
   */
  function renderSnapshot(snapshot) {
    // Hide loading, show content
    document.getElementById("loadingState").style.display = "none";
    document.getElementById("reportContent").style.display = "block";

    // Report title
    document.getElementById(
      "reportTitle"
    ).textContent = `Week ${snapshot.week_number}, ${snapshot.year} Analytics Report`;

    // Health score
    updateHealthScore(snapshot.health_score);

    // Key Metrics
    document.getElementById("messagesCount").textContent = formatNumber(
      snapshot.messages_count
    );
    document.getElementById("newMembersCount").textContent = formatNumber(
      snapshot.new_members_count
    );
    document.getElementById("activeMembers").textContent = formatNumber(
      snapshot.active_members
    );
    document.getElementById("totalMembers").textContent = `of ${formatNumber(
      snapshot.total_members
    )} total`;
    document.getElementById("totalXP").textContent = formatNumber(
      snapshot.leveling.total_xp_earned
    );
    document.getElementById(
      "avgLevel"
    ).textContent = `Avg: ${snapshot.leveling.avg_level.toFixed(1)}`;

    // Trends
    updateTrend("messageTrend", snapshot.message_trend);
    updateTrend("memberTrend", snapshot.member_trend);

    // Engagement tiers
    document.getElementById("eliteCount").textContent = formatNumber(
      snapshot.engagement_tiers.elite.count
    );
    document.getElementById("activeCount").textContent = formatNumber(
      snapshot.engagement_tiers.active.count
    );
    document.getElementById("casualCount").textContent = formatNumber(
      snapshot.engagement_tiers.casual.count
    );
    document.getElementById("inactiveCount").textContent = formatNumber(
      snapshot.engagement_tiers.inactive.count
    );

    // Leveling insights
    document.getElementById("levelingTotalXP").textContent = formatNumber(
      snapshot.leveling.total_xp_earned
    );
    document.getElementById("levelingAvgLevel").textContent =
      snapshot.leveling.avg_level.toFixed(1);
    document.getElementById("levelingMaxLevel").textContent =
      snapshot.leveling.max_level;

    // Top contributors & insights
    renderContributors(snapshot.top_contributors);
    renderInsights(snapshot.insights);
  }

  /**
   * Update the health score visual:
   *  - numeric value
   *  - circular indicator
   *  - status label + color
   *
   * @param {number} score - Health score from 0–100.
   */
  function updateHealthScore(score) {
    const valueElement = document.getElementById("healthValue");
    const statusElement = document.getElementById("healthStatus");
    const circleElement = document.getElementById("healthCircle");

    valueElement.textContent = score;
    circleElement.style.setProperty("--health-score", score);

    let status, color;
    if (score >= 80) {
      status = "🟢 Excellent Health";
      color = "var(--success-color)";
    } else if (score >= 60) {
      status = "🟡 Good Health";
      color = "var(--warning-color)";
    } else if (score >= 40) {
      status = "🟠 Needs Attention";
      color = "var(--warning-color)";
    } else {
      status = "🔴 Low Health";
      color = "var(--error-color)";
    }

    statusElement.textContent = status;
    statusElement.style.color = color;
  }

  /**
   * Update a single metric trend indicator.
   *
   * @param {string} elementId - Target element ID.
   * @param {string} trend - Trend value ("up" | "down" | "stable" | other).
   */
  function updateTrend(elementId, trend) {
    const element = document.getElementById(elementId);
    const emoji = getTrendEmoji(trend);

    element.textContent = `${emoji} ${trend}`;
    element.className = `metric-trend ${trend}`;
  }

  /**
   * Render the "Top Contributors" list.
   *
   * @param {Array<Object>} contributors - Array of contributor objects.
   */
  function renderContributors(contributors) {
    const listElement = document.getElementById("contributorsList");

    if (!contributors || contributors.length === 0) {
      listElement.innerHTML =
        '<p class="loading-text">No contributors data available</p>';
      return;
    }

    listElement.innerHTML = contributors
      .map((contributor, index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `top-${rank}` : "";

        return `
            <div class="contributor-item">
                <div class="contributor-rank ${rankClass}">#${rank}</div>
                <div class="contributor-info">
                    <div class="contributor-name">${escapeHtml(
          contributor.username
        )}</div>
                    <div class="contributor-stats">Level ${contributor.level
          }</div>
                </div>
                <div class="contributor-xp">${formatNumber(
            contributor.xp
          )} XP</div>
            </div>
        `;
      })
      .join("");
  }

  /**
   * Render the list of textual insights.
   *
   * @param {string[]} insights - Array of insight strings.
   */
  function renderInsights(insights) {
    const listElement = document.getElementById("insightsList");

    if (!insights || insights.length === 0) {
      listElement.innerHTML = '<p class="loading-text">No insights available</p>';
      return;
    }

    listElement.innerHTML = insights
      .map((insight) => `<div class="insight-item">${escapeHtml(insight)}</div>`)
      .join("");
  }

  /**
   * Show a generic error state in the loading container.
   */
  function showError() {
    document.getElementById("loadingState").innerHTML = `
        <i class="fas fa-exclamation-triangle"></i>
        <p>Failed to load analytics report</p>
        <button class="btn-primary" onclick="loadSnapshot()">
            <i class="fas fa-redo"></i> Try Again
        </button>
    `;
  }

  // ===================== UTILITY HELPERS =====================

  /**
   * Get an emoji representing the trend direction.
   *
   * @param {string} trend - "up" | "down" | "stable" | other.
   * @returns {string} Emoji representing trend.
   */
  function getTrendEmoji(trend) {
    switch (trend) {
      case "up":
        return "📈";
      case "down":
        return "📉";
      case "stable":
        return "➡️";
      default:
        return "➡️";
    }
  }

  /**
   * Format large numbers with K/M suffixes.
   *
   * @param {number} num - Number to format.
   * @returns {string} Human-readable formatted number.
   */
  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  }

  /**
   * Escape HTML in a string to prevent injection.
   *
   * @param {string} text - Raw text to escape.
   * @returns {string} Escaped HTML string.
   */
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  window.loadSnapshot = loadSnapshot;

})();
