// v4.0.0
/**
 * Voice Channels Dashboard JavaScript
 * Handles data fetching, filtering, and display for the Join-to-Create voice channel system
 */

// Global variables (will use GUILD_ID from the HTML template)
let vcCurrentPage = 1;
const vcItemsPerPage = 20;
let vcAllChannels = [];
let vcFilteredChannels = [];

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
 * Load configuration info
 */
async function loadConfig() {
    try {
        const response = await fetch(`/api/voice-config/${GUILD_ID}`);
        if (!response.ok) {
            document.getElementById('config-info').innerHTML = '<p class="vc-no-data">⚠️ Join-to-Create system is not configured for this server.</p>';
            return;
        }

        const config = await response.json();

        // Build config display
        const configHTML = `
            <div class="vc-config-item">
                <strong>Trigger Channel</strong>
                <span>${config.trigger_channel_name || config.trigger_channel_id}</span>
            </div>
            <div class="vc-config-item">
                <strong>Category</strong>
                <span>${config.category_name || config.category_id}</span>
            </div>
            <div class="vc-config-item">
                <strong>Delete Delay</strong>
                <span>${config.delete_delay_seconds}s</span>
            </div>
            <div class="vc-config-item">
                <strong>User Cooldown</strong>
                <span>${config.user_cooldown_seconds}s</span>
            </div>
            <div class="vc-config-item">
                <strong>Min Session for XP</strong>
                <span>${config.min_session_minutes} min</span>
            </div>
            <div class="vc-config-item">
                <strong>Status</strong>
                <span>${config.enabled ? '✅ Enabled' : '❌ Disabled'}</span>
            </div>
        `;

        document.getElementById('config-info').innerHTML = configHTML;
    } catch (error) {
        console.error('Error loading config:', error);
        document.getElementById('config-info').innerHTML = '<p class="vc-no-data">⚠️ Failed to load configuration</p>';
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
        vcAllChannels = data.channels || [];
        vcFilteredChannels = [...vcAllChannels];

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

    if (vcFilteredChannels.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="vc-no-data">No channels found matching your filters.</td></tr>';
        document.getElementById('pagination').innerHTML = '';
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(vcFilteredChannels.length / vcItemsPerPage);
    const startIndex = (vcCurrentPage - 1) * vcItemsPerPage;
    const endIndex = startIndex + vcItemsPerPage;
    const pageChannels = vcFilteredChannels.slice(startIndex, endIndex);

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
        <button class="vc-page-btn" onclick="goToPage(1)" ${vcCurrentPage === 1 ? 'disabled' : ''}>
            ⏮️ First
        </button>
        <button class="vc-page-btn" onclick="goToPage(${vcCurrentPage - 1})" ${vcCurrentPage === 1 ? 'disabled' : ''}>
            ◀️ Prev
        </button>
        <span class="vc-page-info">Page ${vcCurrentPage} of ${totalPages}</span>
        <button class="vc-page-btn" onclick="goToPage(${vcCurrentPage + 1})" ${vcCurrentPage === totalPages ? 'disabled' : ''}>
            Next ▶️
        </button>
        <button class="vc-page-btn" onclick="goToPage(${totalPages})" ${vcCurrentPage === totalPages ? 'disabled' : ''}>
            Last ⏭️
        </button>
    `;

    paginationDiv.innerHTML = paginationHTML;
}

/**
 * Navigate to a specific page
 */
function goToPage(page) {
    vcCurrentPage = page;
    renderChannelTable();
}

/**
 * Apply filters to channel list
 */
function applyFilters() {
    const creatorFilter = document.getElementById('filter-creator').value.trim().toLowerCase();
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;

    vcFilteredChannels = vcAllChannels.filter(channel => {
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

    vcCurrentPage = 1; // Reset to first page
    renderChannelTable();
}

/**
 * Clear all filters
 */
function clearFilters() {
    document.getElementById('filter-creator').value = '';
    document.getElementById('filter-start-date').value = '';
    document.getElementById('filter-end-date').value = '';

    vcFilteredChannels = [...vcAllChannels];
    vcCurrentPage = 1;
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

// Allow Enter key to apply filters
document.addEventListener('DOMContentLoaded', function () {
    // Only run if we are on the voice channels page
    if (!document.getElementById('channels-table')) return;

    const filterInputs = document.querySelectorAll('.vc-filter-input');
    filterInputs.forEach(input => {
        input.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                applyFilters();
            }
        });
    });
});
