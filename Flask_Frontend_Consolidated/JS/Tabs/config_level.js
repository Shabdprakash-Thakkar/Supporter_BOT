// v5.0.0
// v4.0.0
/**
 * @file Leveling Sub-Tab Switcher
 * @description
 * Handles switching between leveling sub-tabs (Rewards, Leaderboard, Settings)
 * in the server configuration UI by:
 *  - Hiding all sub-tab content containers
 *  - Showing the selected sub-tab content
 *  - Updating active state on sub-tab buttons
 */

/**
 * Switch between leveling sub-tabs (Rewards, Leaderboard, Settings).
 *
 * @param {string} tabName - Sub-tab identifier suffix (e.g. "rewards", "leaderboard", "settings").
 * @param {HTMLElement} btn - The button element that triggered the switch.
 */
(function () {
  if (!document.getElementById('view-config-level')) return;

  function switchLevelSubTab(tabName, btn) {
    // Hide all sub-tab content containers
    const contents = document.querySelectorAll(".level-sub-content");
    contents.forEach((content) => {
      content.classList.add("hidden");
    });

    // Remove active state from all sub-tab buttons
    const buttons = document.querySelectorAll(".sub-tab-btn");
    buttons.forEach((b) => {
      b.classList.remove("active");
    });

    // Show the selected sub-tab content
    document.getElementById(`level-sub-${tabName}`).classList.remove("hidden");

    btn.classList.add("active");
  }

  window.switchLevelSubTab = switchLevelSubTab;

})();
