// v5.0.0
// v4.0.0
/**
 * @file Level Rewards Management
 * @description
 * Handles the level → role reward configuration UI, including:
 *  - Lazy-loading guild roles into the reward modal
 *  - Creating new level rewards via the backend API
 *  - Rendering reward cards in sorted order
 *  - Deleting existing rewards and managing the empty state
 */

/** Tracks whether guild roles have already been loaded into the role selector. */
let rolesLoaded = false;

/** Cached reference to the level reward modal element. */
const modal = document.getElementById("rewardModal");

// ==================== MODAL OPEN / CLOSE ====================

/**
 * Open the level reward modal and lazily fetch roles from the backend.
 * Initializes Select2 for the role dropdown on first load.
 *
 * @returns {Promise<void>}
 */
async function openRewardModal() {
  modal.classList.remove("hidden");

  if (!rolesLoaded) {
    const roleSelect = document.getElementById("newRewardRole");
    const guildId = window.location.pathname.split("/").pop();

    try {
      const response = await fetch(`/api/server/${guildId}/discord-data`);
      const data = await response.json();

      if (data.roles && data.roles.length > 0) {
        roleSelect.innerHTML =
          '<option value="" disabled selected>Select a Role</option>';

        // Sort roles by position (highest first)
        data.roles.sort((a, b) => b.position - a.position);

        data.roles.forEach((role) => {
          const opt = document.createElement("option");
          opt.value = role.id;
          opt.text = role.name;
          opt.dataset.color = role.color.toString(16);
          roleSelect.appendChild(opt);
        });
        rolesLoaded = true;

        $("#newRewardRole").select2({
          dropdownParent: $("#rewardModal"),
          width: "100%",
          placeholder: "Select a Role",
          allowClear: true,
        });
      } else {
        roleSelect.innerHTML = "<option disabled>Failed to load roles</option>";
      }
    } catch (e) {
      console.error("Failed to fetch roles", e);
      roleSelect.innerHTML = "<option disabled>Error loading roles</option>";
    }
  }
}

/**
 * Close the level reward modal.
 */
function closeRewardModal() {
  modal.classList.add("hidden");
}

// ==================== CREATE / UPDATE REWARD ====================

/**
 * Persist a new level reward via the API and update the UI optimistically.
 *
 * @returns {Promise<void>}
 */
async function saveLevelReward() {
  const levelInput = document.getElementById("newRewardLevel");
  const roleSelect = document.getElementById("newRewardRole");
  const btn = document.getElementById("btnSaveReward");

  const level = levelInput.value;
  const roleId = roleSelect.value;
  const roleName = roleSelect.options[roleSelect.selectedIndex]?.text;

  if (!level || !roleId) {
    alert("Please select a level and a role.");
    return;
  }

  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';

  const guildId = window.location.pathname.split("/").pop();

  try {
    const response = await fetch(`/api/server/${guildId}/level-reward`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: level,
        role_id: roleId,
        role_name: roleName,
      }),
    });

    if (response.ok) {
      closeRewardModal();

      const rewardList = document.getElementById("rewardList");

      const placeholder = rewardList.querySelector(".text-center.py-12");
      if (placeholder) {
        placeholder.remove();
      }

      const newCard = document.createElement("div");
      newCard.className = "config-card animate-popIn";
      newCard.id = `reward-card-${level}`;
      newCard.innerHTML = `
        <div class="config-icon-wrapper bg-gradient-to-br from-amber-400 to-orange-600">
          <i class="fas fa-trophy text-white"></i>
        </div>
        <div class="config-info">
          <div class="config-title">
            Level ${level}
            <span class="config-badge bg-indigo-500/10 text-indigo-400 ml-2">Progress Reward</span>
          </div>
          <div class="config-subtitle">
            <i class="fas fa-user-shield"></i>
            Role: ${roleName}
          </div>
        </div>
        <div class="config-actions">
          <button class="action-btn delete reward-delete-btn" onclick="deleteLevelReward(${level})" title="Delete reward">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `;

      const existingCards = Array.from(
        rewardList.querySelectorAll(".reward-card")
      );
      let inserted = false;

      for (let i = 0; i < existingCards.length; i++) {
        const cardLevel = parseInt(
          existingCards[i].querySelector(".reward-level .text-2xl").textContent
        );
        if (parseInt(level) < cardLevel) {
          rewardList.insertBefore(newCard, existingCards[i]);
          inserted = true;
          break;
        }
      }

      if (!inserted) {
        rewardList.appendChild(newCard);
      }

      levelInput.value = "";
      roleSelect.selectedIndex = 0;
    } else {
      alert("Failed to save reward.");
    }
  } catch (e) {
    console.error(e);
    alert("Error saving reward.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// ==================== DELETE REWARD ====================

/**
 * Delete a level reward by level and update the reward list UI.
 *
 * @param {number|string} level - The level whose reward should be removed.
 * @returns {Promise<void>}
 */
async function deleteLevelReward(level) {
  if (!confirm(`Are you sure you want to remove the Level ${level} reward?`))
    return;

  const guildId = window.location.pathname.split("/").pop();
  const card = document.getElementById(`reward-card-${level}`);

  try {
    const response = await fetch(
      `/api/server/${guildId}/level-reward?level=${level}`,
      {
        method: "DELETE",
      }
    );

    if (response.ok) {
      card.remove();

      const rewardList = document.getElementById("rewardList");
      const remainingCards = rewardList.querySelectorAll(".reward-card");

      if (remainingCards.length === 0) {
        const placeholder = document.createElement("div");
        placeholder.className = "text-center py-12 text-slate-500";
        placeholder.innerHTML = `
          <i class="fas fa-gift text-4xl mb-3 opacity-30"></i>
          <p>No role rewards configured yet.</p>
          <p class="text-sm">Click "Add Reward" to create your first level reward!</p>
        `;
        rewardList.appendChild(placeholder);
      }
    } else {
      alert("Failed to delete reward.");
    }
  } catch (e) {
    console.error(e);
    alert("Error deleting reward.");
  }
}
