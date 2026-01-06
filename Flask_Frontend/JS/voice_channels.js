// v5.0.0
// v4.0.0
/**
 * Voice Channels Dashboard JavaScript
 * Handles data fetching, filtering, and display for the Join-to-Create voice channel system
 */

let currentPage = 1;
const itemsPerPage = 20;
let allChannels = [];
let filteredChannels = [];

/**
 * Load all voice channel data (stats, config, and history)
 */
async function loadVoiceChannelData() {
    try {
        // Load stats and config in parallel
        await Promise.all([
            loadStats(),
            loadConfig(),
            loadChannelHistory()
        ]);
    } catch (error) {
        console.error('Error loading voice channel data:', error);
        showError('Failed to load voice channel data');
    }
}

/**
 * Load summary statistics
 */
async function loadStats() {
    try {
        const response = await fetch(`/api/voice-stats/${GUILD_ID}`);
        if (!response.ok) throw new Error('Failed to fetch stats');

        const data = await response.json();

        // Update summary cards
        document.getElementById('total-channels').textContent = data.total_channels || 0;
        document.getElementById('active-channels').textContent = data.active_channels || 0;
        document.getElementById('total-voice-time').textContent = formatDuration(data.total_voice_time || 0);
        document.getElementById('avg-lifetime').textContent = formatDuration(data.avg_lifetime || 0);
    } catch (error) {
        console.error('Error loading stats:', error);
        document.getElementById('total-channels').textContent = 'Error';
        document.getElementById('active-channels').textContent = 'Error';
        document.getElementById('total-voice-time').textContent = 'Error';
        document.getElementById('avg-lifetime').textContent = 'Error';
    }
}

/**
 * Load configuration info and populate settings form
 */
async function loadConfig() {
    const statusEl = document.getElementById('jtc-config-status');
    const statusMsg = document.getElementById('jtc-status-message');

    try {
        const response = await fetch(`/api/voice-config/${GUILD_ID}`);

        if (!response.ok) {
            if (response.status === 404) {
                if (statusEl) {
                    statusEl.classList.remove('hidden');
                    statusEl.classList.add('bg-yellow-500/10', 'border-yellow-500/20');
                    statusMsg.innerHTML = '<strong class="text-yellow-400">Not Configured:</strong> The Join-to-Create system hasn\'t been set up yet. Please configure the trigger channel and category below.';
                }
            }
            return;
        }

        const config = await response.json();

        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusEl.classList.remove('bg-yellow-500/10', 'border-yellow-500/20');
            statusEl.classList.add('bg-green-500/10', 'border-green-500/20');
            statusMsg.innerHTML = `<strong class="text-green-400">Active:</strong> System is running with trigger <code class="bg-slate-900 px-1 rounded">#${config.trigger_channel_name || config.trigger_channel_id}</code>`;
        }

        // Populate settings form fields
        if (document.getElementById('edit-trigger-channel')) {
            // We store the values to select them AFTER the dropdowns are populated from Discord API
            window.latestJTCConfig = config;

            document.getElementById('edit-trigger-channel').value = config.trigger_channel_id || '';
            document.getElementById('edit-category').value = config.category_id || '';
            document.getElementById('edit-private-role').value = config.private_vc_role_id || '';

            document.getElementById('edit-cooldown').value = config.user_cooldown_seconds || 10;
            document.getElementById('edit-delete-delay').value = config.delete_delay_seconds || 5;
            document.getElementById('edit-min-session').value = config.min_session_minutes || 0;

            if (document.getElementById('edit-force-private')) {
                document.getElementById('edit-force-private').checked = !!config.force_private;
            }
        }

    } catch (error) {
        console.error('Error loading config:', error);
        if (statusEl) {
            statusEl.classList.remove('hidden');
            statusMsg.textContent = '⚠️ Failed to connect to configuration API.';
        }
    }
}

/**
 * Load Discord roles and channels to populate dropdowns
 */
async function loadJTCDiscordData(guildId) {
    const triggerSel = document.getElementById('edit-trigger-channel');
    const categorySel = document.getElementById('edit-category');
    const roleSel = document.getElementById('edit-private-role');

    if (!triggerSel) return;

    try {
        const res = await fetch(`/api/server/${guildId}/discord-data`);
        const data = await res.json();

        // 1. Populate Trigger Channel (Voice Only)
        if (typeof window.populateChannelDropdownWithCategories === "function") {
            window.populateChannelDropdownWithCategories(triggerSel, data.channels, {
                channelTypes: [2], // Voice channels only
                placeholder: "Select trigger channel...",
                includeHash: false
            });
        }

        // 2. Populate Categories
        categorySel.innerHTML = '<option value="">Select a category...</option>';
        const categories = data.channels.filter(c => c.type === 4);
        categories.sort((a, b) => a.position - b.position);
        categories.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat.id;
            opt.text = cat.name;
            categorySel.appendChild(opt);
        });

        // 3. Populate Roles
        roleSel.innerHTML = '<option value="">No Private VC Role (Public Only)</option>';
        data.roles.sort((a, b) => b.position - a.position);
        data.roles.forEach(role => {
            const opt = document.createElement("option");
            opt.value = role.id;
            opt.text = `@ ${role.name}`;
            roleSel.appendChild(opt);
        });

        // 4. Re-apply saved values if we have them
        if (window.latestJTCConfig) {
            const config = window.latestJTCConfig;
            if (config.trigger_channel_id) triggerSel.value = config.trigger_channel_id;
            if (config.category_id) categorySel.value = config.category_id;
            if (config.private_vc_role_id) roleSel.value = config.private_vc_role_id;
            if (config.hasOwnProperty('force_private') && document.getElementById('edit-force-private')) {
                document.getElementById('edit-force-private').checked = !!config.force_private;
            }
        }

    } catch (e) {
        console.error("Error loading Discord data for JTC:", e);
    }
}

/**
 * Save full JTC configuration
 */
async function saveVoiceConfig() {
    const btn = document.getElementById('save-config-btn');
    const status = document.getElementById('save-status');

    const triggerId = document.getElementById('edit-trigger-channel').value;
    const categoryId = document.getElementById('edit-category').value;
    const privateRole = document.getElementById('edit-private-role').value;
    const cooldown = document.getElementById('edit-cooldown').value;
    const deleteDelay = document.getElementById('edit-delete-delay').value;
    const minSession = document.getElementById('edit-min-session').value;
    const forcePrivate = document.getElementById('edit-force-private') ? document.getElementById('edit-force-private').checked : false;

    if (!triggerId || !categoryId) {
        alert("Please select both a Trigger Channel and a Target Category.");
        return;
    }

    try {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';
        status.textContent = 'Saving changes...';

        const response = await fetch(`/api/voice-config/${GUILD_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trigger_channel_id: triggerId,
                category_id: categoryId,
                private_vc_role_id: privateRole || null,
                force_private: forcePrivate,
                user_cooldown_seconds: parseInt(cooldown) || 10,
                delete_delay_seconds: parseInt(deleteDelay) || 5,
                min_session_minutes: parseInt(minSession) || 0
            })
        });

        const res = await response.json();

        if (res.success) {
            status.innerHTML = '<span class="text-green-400"><i class="fas fa-check-circle"></i> Saved successfully!</span>';
            setTimeout(() => { status.textContent = ''; }, 3000);
            loadConfig(); // Reload status indicator
        } else {
            alert("Error saving: " + (res.error || "Unknown error"));
            status.textContent = 'Failed to save.';
        }
    } catch (e) {
        alert("Network error saving configuration");
        console.error(e);
        status.textContent = 'Network error.';
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save mr-2"></i> Save Changes';
    }
}

/**
 * Reset form to last loaded values
 */
function resetVoiceConfigForm() {
    if (confirm("Reset form to saved settings?")) {
        loadConfig();
    }
}

/**
 * Load channel history
 */
async function loadChannelHistory() {
    try {
        const response = await fetch(`/api/voice-channels/${GUILD_ID}`);
        if (!response.ok) throw new Error('Failed to fetch channel history');

        const data = await response.json();
        allChannels = data.channels || [];
        filteredChannels = [...allChannels];

        renderChannelTable();
    } catch (error) {
        console.error('Error loading channel history:', error);
        const tbody = document.getElementById('channels-tbody');
        tbody.innerHTML = '<tr><td colspan="6" class="vc-no-data">❌ Failed to load channel history</td></tr>';
    }
}

/**
 * Render the channel table with current filters and pagination
 */
function renderChannelTable() {
    const tbody = document.getElementById('channels-tbody');

    if (filteredChannels.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="vc-no-data">No channels found matching your filters.</td></tr>';
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(filteredChannels.length / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageChannels = filteredChannels.slice(startIndex, endIndex);

    // Render table rows
    tbody.innerHTML = pageChannels.map(channel => `
        <tr>
            <td><code>${channel.channel_id}</code></td>
            <td>
                <div>${channel.creator_username || 'Unknown'}</div>
                <small style="color: var(--text-secondary, #72767d);">${channel.creator_user_id}</small>
            </td>
            <td>${formatDateTime(channel.created_at)}</td>
            <td>${channel.deleted_at ? formatDateTime(channel.deleted_at) : '<span class="vc-status-active">Active</span>'}</td>
            <td>${formatDuration(channel.total_lifetime_seconds || 0)}</td>
            <td>${channel.max_concurrent_users || 0}</td>
        </tr>
    `).join('');

    // Render pagination
    renderPagination(totalPages);
}

/**
 * Render pagination controls
 */
function renderPagination(totalPages) {
    const paginationDiv = document.getElementById('pagination');

    if (totalPages <= 1) {
        paginationDiv.innerHTML = '';
        return;
    }

    let paginationHTML = `
        <button class="vc-page-btn" onclick="goToPage(1)" ${currentPage === 1 ? 'disabled' : ''}>
            ⏮️ First
        </button>
        <button class="vc-page-btn" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
            ◀️ Prev
        </button>
        <span class="vc-page-info">Page ${currentPage} of ${totalPages}</span>
        <button class="vc-page-btn" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
            Next ▶️
        </button>
        <button class="vc-page-btn" onclick="goToPage(${totalPages})" ${currentPage === totalPages ? 'disabled' : ''}>
            Last ⏭️
        </button>
    `;

    paginationDiv.innerHTML = paginationHTML;
}

/**
 * Navigate to a specific page
 */
function goToPage(page) {
    currentPage = page;
    renderChannelTable();
}

/**
 * Apply filters to channel list
 */
function applyFilters() {
    const creatorFilter = document.getElementById('filter-creator').value.trim().toLowerCase();
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;

    filteredChannels = allChannels.filter(channel => {
        // Filter by creator
        if (creatorFilter && !channel.creator_user_id.toLowerCase().includes(creatorFilter) &&
            !(channel.creator_username || '').toLowerCase().includes(creatorFilter)) {
            return false;
        }

        // Filter by start date
        if (startDate) {
            const channelDate = new Date(channel.created_at);
            const filterDate = new Date(startDate);
            if (channelDate < filterDate) {
                return false;
            }
        }

        // Filter by end date
        if (endDate) {
            const channelDate = new Date(channel.created_at);
            const filterDate = new Date(endDate);
            filterDate.setHours(23, 59, 59, 999); // End of day
            if (channelDate > filterDate) {
                return false;
            }
        }

        return true;
    });

    currentPage = 1; // Reset to first page
    renderChannelTable();
}

/**
 * Clear all filters
 */
function clearFilters() {
    document.getElementById('filter-creator').value = '';
    document.getElementById('filter-start-date').value = '';
    document.getElementById('filter-end-date').value = '';

    filteredChannels = [...allChannels];
    currentPage = 1;
    renderChannelTable();
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0m';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

/**
 * Format datetime to readable string
 */
function formatDateTime(dateString) {
    if (!dateString) return '-';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Relative time for recent dates
    if (diffMins < 1) {
        return 'Just now';
    } else if (diffMins < 60) {
        return `${diffMins} min ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    // Absolute time for older dates
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };

    return date.toLocaleDateString('en-US', options);
}

/**
 * Show error message
 */
function showError(message) {
    console.error(message);
    // You can add a toast notification here if you have one
}

// Allow Enter key to apply filters
document.addEventListener('DOMContentLoaded', function () {
    const filterInputs = document.querySelectorAll('.vc-filter-input');
    filterInputs.forEach(input => {
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                applyFilters();
            }
        });
    });
});
