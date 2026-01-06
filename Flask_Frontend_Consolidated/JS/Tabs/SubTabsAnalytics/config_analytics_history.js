// v5.0.0
// v4.0.0
/**
 * @file Analytics History JavaScript
 * @description
 * Handles:
 *  - Fetching historical analytics snapshots for a guild
 *  - Rendering a timeline-style list of weekly reports
 *  - Navigating to detailed snapshot reports
 *  - Basic empty/error state handling
 */




(function () {
  if (document.body.id !== 'page-analytics-history') return;

  // ===================== INITIALIZATION =====================

  document.addEventListener("DOMContentLoaded", () => {
    loadAnalyticsHistory();
  });

  // ===================== DATA LOADING =====================

  /**
   * Load analytics history for the current guild and render the timeline.
   * Relies on a global `guildId` variable provided by the template.
   */
  async function loadAnalyticsHistory() {
    try {
      const response = await fetch(`/api/analytics/${guildId}/history`);

      if (!response.ok) {
        throw new Error("Failed to fetch analytics history");
      }

      const data = await response.json();

      if (!data.snapshots || data.snapshots.length === 0) {
        showEmptyState();
        return;
      }

      renderTimeline(data.snapshots);
    } catch (error) {
      console.error("Error loading analytics history:", error);
      showError();
    }
  }

  // ===================== RENDERING =====================

  /**
   * Render the list of snapshot cards into the timeline container.
   *
   * @param {Array<Object>} snapshots - Array of snapshot metadata objects.
   */
  function renderTimeline(snapshots) {
    const timeline = document.getElementById("timeline");

    timeline.innerHTML = snapshots
      .map((snapshot) => {
        const healthClass = getHealthClass(snapshot.health_score);
        const trendEmoji = getTrendEmoji(snapshot.message_trend);
        const memberTrendEmoji = getTrendEmoji(snapshot.member_trend);

        return `
            <div class="snapshot-card">
                <div class="snapshot-header">
                    <div>
                        <div class="snapshot-title">Week ${snapshot.week_number
          }, ${snapshot.year}</div>
                        <div class="snapshot-date">${formatDate(
            snapshot.snapshot_date
          )}</div>
                    </div>
                    <div class="health-badge ${healthClass}">
                        ${snapshot.health_score}/100
                    </div>
                </div>
                
                <div class="snapshot-summary">
                    <div class="stat-item">
                        <div class="stat-icon">💬</div>
                        <div class="stat-value">${formatNumber(
            snapshot.messages_count
          )}</div>
                        <div class="stat-label">Messages</div>
                        <div class="trend-indicator ${snapshot.message_trend}">
                            ${trendEmoji} ${snapshot.message_trend}
                        </div>
                    </div>
                    
                    <div class="stat-item">
                        <div class="stat-icon">👥</div>
                        <div class="stat-value">+${snapshot.new_members_count
          }</div>
                        <div class="stat-label">New Members</div>
                        <div class="trend-indicator ${snapshot.member_trend}">
                            ${memberTrendEmoji} ${snapshot.member_trend}
                        </div>
                    </div>
                    
                    <div class="stat-item">
                        <div class="stat-icon">📈</div>
                        <div class="stat-value">${formatNumber(
            snapshot.active_members
          )}</div>
                        <div class="stat-label">Active Members</div>
                        <div class="stat-label">${formatNumber(
            snapshot.total_members
          )} total</div>
                    </div>
                </div>
                
                <button class="view-details-btn" onclick="viewSnapshot(${snapshot.id
          })">
                    <i class="fas fa-chart-bar"></i> View Full Report
                </button>
            </div>
        `;
      })
      .join("");
  }

  /**
   * Navigate to the full analytics report for a single snapshot.
   *
   * @param {number|string} snapshotId - Snapshot identifier.
   */
  function viewSnapshot(snapshotId) {
    window.location.href = `/analytics/snapshot/${guildId}/${snapshotId}`;
  }

  /**
   * Show the "empty history" state when there are no snapshots.
   */
  function showEmptyState() {
    document.getElementById("timeline").style.display = "none";
    document.getElementById("emptyState").style.display = "block";
  }

  /**
   * Show an error message and retry UI inside the timeline container.
   */
  function showError() {
    const timeline = document.getElementById("timeline");
    timeline.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-exclamation-triangle"></i>
            <h3>Failed to Load History</h3>
            <p>There was an error loading your analytics history.</p>
            <button class="btn-primary" onclick="loadAnalyticsHistory()">
                <i class="fas fa-redo"></i> Try Again
            </button>
        </div>
    `;
  }

  /**
   * Navigate back to the main dashboard for the current guild.
   */
  function goToDashboard() {
    window.location.href = `/dashboard/server/${guildId}`;
  }

  // ===================== UTILITY HELPERS =====================

  /**
   * Get semantic class for health badge based on score.
   *
   * @param {number} score - Health score from 0–100.
   * @returns {string} CSS class name.
   */
  function getHealthClass(score) {
    if (score >= 70) return "excellent";
    if (score >= 40) return "good";
    return "fair";
  }

  /**
 * Get an emoji representing the trend direction.
 *
 * @param {string} trend - "up" | "down" | "stable" | "insufficient_data" | other.
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
      case "insufficient_data":
        return "❓";
      default:
        return "➡️";
    }
  }

  /**
   * Format a date string into a human-readable label.
   *
   * @param {string} dateString - ISO date string from API.
   * @returns {string} Localized date label (e.g. "January 1, 2025").
   */
  function formatDate(dateString) {
    const date = new Date(dateString);
    const options = {
      year: "numeric",
      month: "long",
      day: "numeric",
    };
    return date.toLocaleDateString("en-US", options);
  }

  /**
   * Format large numbers with K/M suffixes.
   *
   * @param {number} num - Number to format.
   * @returns {string} Human-readable numeric string.
   */
  function formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + "M";
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + "K";
    }
    return num.toString();
  }

  // Export global functions
  window.loadAnalyticsHistory = loadAnalyticsHistory;
  window.viewSnapshot = viewSnapshot;
  window.goToDashboard = goToDashboard;

})();


