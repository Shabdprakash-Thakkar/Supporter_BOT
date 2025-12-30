// v4.0.0
/**
 * @file Analytics Dashboard JavaScript
 * @description
 * Client-side logic for the server analytics dashboard:
 *  - Initializes the dashboard for a given guild
 *  - Fetches and displays current analytics metrics
 *  - Calculates and renders a composite "health score"
 *  - Renders engagement tiers and top contributors
 *  - Provides snapshot guidance and periodic auto-refresh
 */


(function () {
  if (!document.getElementById('view-config-analytics')) return;

  let currentGuildId = null;

  // ==================== INITIALIZATION ====================

  /**
   * Initialize the analytics dashboard for a specific guild.
   *
   * @param {string} guildId - The current Discord guild ID.
   */
  function initAnalytics(guildId) {
    currentGuildId = guildId;
    loadCurrentAnalytics();
  }

  // ==================== DATA LOADING ====================

  /**
   * Fetch current analytics data for the active guild and update the dashboard.
   */
  async function loadCurrentAnalytics() {
    try {
      const response = await fetch(`/api/analytics/${currentGuildId}/current`);

      if (!response.ok) {
        throw new Error("Failed to fetch analytics");
      }

      const data = await response.json();
      updateDashboard(data);
    } catch (error) {
      console.error("Error loading analytics:", error);
      showError("Failed to load analytics data");
    }
  }

  // ==================== DASHBOARD RENDERING ====================

  /**
   * Populate all dashboard sections with analytics data.
   *
   * @param {Object} data - Analytics payload from the backend.
   */
  function updateDashboard(data) {
    const healthScore = calculateHealthScore(data);
    updateHealthScore(healthScore);

    document.getElementById("messagesThisWeek").textContent = formatNumber(
      data.messages_this_week
    );
    document.getElementById("analyticsNewMembers").textContent = formatNumber(
      data.new_members_this_week
    );
    document.getElementById("activeMembers").textContent = formatNumber(
      data.active_members
    );
    document.getElementById("analyticsTotalMembers").textContent = formatNumber(
      data.total_members
    );
    document.getElementById("totalWeeklyXP").textContent = formatNumber(
      data.total_xp_weekly
    );
    document.getElementById("totalLifetimeXP").textContent = formatNumber(
      data.lifetime_xp
    );
    document.getElementById("avgLevel").textContent = data.avg_level.toFixed(1);

    updateEngagementTiers(data);
    updateTopContributors(data.top_contributors);
  }

  /**
   * Compute a composite health score from multiple engagement metrics.
   *
   * @param {Object} data - Analytics payload.
   * @returns {number} Calculated health score (0–100).
   */
  function calculateHealthScore(data) {
    const totalMembers = data.total_members || 1;
    const activeMembers = data.active_members || 0;
    const messages = data.messages_this_week || 0;

    const messagesPerMember = messages / totalMembers;
    const activityScore = Math.min(40, (messagesPerMember / 10) * 40);

    const engagementRate = (activeMembers / totalMembers) * 100;
    const engagementScore = Math.min(30, (engagementRate / 100) * 30);

    const growthScore = Math.min(
      20,
      (data.new_members_this_week / totalMembers) * 400
    );

    const featureCount = data.feature_count || 0;
    const featureScore = Math.min(10, (featureCount / 4) * 10);

    return Math.round(
      activityScore + engagementScore + growthScore + featureScore
    );
  }

  /**
   * Update health score visual elements (value, status text, and circle styling).
   *
   * @param {number} score - Calculated health score.
   */
  function updateHealthScore(score) {
    const scoreElement = document.getElementById("healthScoreValue");
    const statusElement = document.getElementById("healthStatus");
    const circleElement = document.getElementById("healthScoreCircle");

    animateValue(scoreElement, 0, score, 1000);
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
   * Update engagement tier counts and visual bars based on activity.
   *
   * @param {Object} data - Analytics payload.
   */
  function updateEngagementTiers(data) {
    const totalMembers = data.total_members || 1;
    const activeMembers = data.active_members || 0;

    const eliteCount = Math.round(activeMembers * 0.05);
    const activeCount = Math.round(activeMembers * 0.2);
    const casualCount = Math.round(activeMembers * 0.5);
    const inactiveCount = totalMembers - activeMembers;

    document.getElementById("eliteCount").textContent = formatNumber(eliteCount);
    document.getElementById("activeCount").textContent =
      formatNumber(activeCount);
    document.getElementById("casualCount").textContent =
      formatNumber(casualCount);
    document.getElementById("inactiveCount").textContent =
      formatNumber(inactiveCount);

    const elitePercent = (eliteCount / totalMembers) * 100;
    const activePercent = (activeCount / totalMembers) * 100;
    const casualPercent = (casualCount / totalMembers) * 100;
    const inactivePercent = (inactiveCount / totalMembers) * 100;

    setTimeout(() => {
      document.getElementById("eliteBar").style.width = `${elitePercent}%`;
      document.getElementById("activeBar").style.width = `${activePercent}%`;
      document.getElementById("casualBar").style.width = `${casualPercent}%`;
      document.getElementById("inactiveBar").style.width = `${inactivePercent}%`;
    }, 100);
  }

  /**
   * Render the list of top contributors with rank badges and XP values.
   *
   * @param {Array<Object>} contributors - Array of contributor objects.
   */
  function updateTopContributors(contributors) {
    const listElement = document.getElementById("contributorsList");

    if (!contributors || contributors.length === 0) {
      listElement.innerHTML =
        '<p class="insight-placeholder">No contributors data available</p>';
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
   * Entry helper for templates: initializes the analytics dashboard
   * based on the current URL guild ID.
   */
  function loadAnalyticsDashboard() {
    const guildId = window.location.pathname.split("/").pop();
    initAnalytics(guildId);
  }

  // ==================== USER ACTIONS ====================

  /**
   * Open the analytics guide for the current guild in a new window.
   */
  function openAnalyticsGuide() {
    if (currentGuildId) {
      window.open(
        `/analytics/guide/${currentGuildId}`,
        "_blank",
        "width=1000,height=900"
      );
    }
  }

  /**
   * Display snapshot instructions and temporarily show a loading state
   * on the snapshot generation button.
   */
  async function generateSnapshot() {
    try {
      const button = event.target.closest("button");
      button.disabled = true;
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';

      showSuccess(
        "To generate a snapshot, use the /a3-generate-snapshot command in your Discord server. The report will be sent to your DMs!"
      );

      setTimeout(() => {
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-camera"></i> Generate Snapshot';
      }, 3000);
    } catch (error) {
      console.error("Error generating snapshot:", error);
      showError("Failed to generate snapshot");
    }
  }

  // ==================== UTILITIES ====================

  /**
   * Format large numbers into compact notation (e.g., 1.2K, 3.4M).
   *
   * @param {number} num - Raw number.
   * @returns {string} Formatted number string.
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
   * Animate a numeric value from `start` to `end` inside an element.
   *
   * @param {HTMLElement} element - Target element.
   * @param {number} start - Starting value.
   * @param {number} end - Ending value.
   * @param {number} duration - Animation duration in milliseconds.
   */
  function animateValue(element, start, end, duration) {
    const startTime = performance.now();

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const current = Math.floor(start + (end - start) * easeOutQuad(progress));
      element.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    }

    requestAnimationFrame(update);
  }

  /**
   * Easing function (ease-out quadratic) for smoother animations.
   *
   * @param {number} t - Progress value between 0 and 1.
   * @returns {number} Eased progress value.
   */
  function easeOutQuad(t) {
    return t * (2 - t);
  }

  /**
   * Escape HTML entities in a string to handle unsafe user content.
   *
   * @param {string} text - Raw text to escape.
   * @returns {string} Escaped HTML text.
   */
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Show a success notification using the global notification system
   * when available, otherwise fall back to `alert`.
   *
   * @param {string} message - Success message text.
   */
  function showSuccess(message) {
    if (typeof showNotification === "function") {
      showNotification(message, "success");
    } else {
      alert(message);
    }
  }

  /**
   * Show an error notification using the global notification system
   * when available, otherwise fall back to `alert`.
   *
   * @param {string} message - Error message text.
   */
  function showError(message) {
    if (typeof showNotification === "function") {
      showNotification(message, "error");
    } else {
      alert(message);
    }
  }

  // ==================== AUTO REFRESH ====================

  /**
   * Periodically refresh analytics data every 5 minutes
   * while a guild is active in the dashboard.
   */
  setInterval(() => {
    if (currentGuildId) {
      loadCurrentAnalytics();
    }
  }, 5 * 60 * 1000);

  // Export global functions used in HTML
  window.initAnalytics = initAnalytics;
  window.loadAnalyticsDashboard = loadAnalyticsDashboard;
  window.openAnalyticsGuide = openAnalyticsGuide;
  window.generateSnapshot = generateSnapshot;

})();
