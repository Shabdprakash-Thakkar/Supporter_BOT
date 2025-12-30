// v4.0.0
/**
 * Ticket System Configuration
 * Handles loading and saving ticket system settings via dashboard
 */


/**
 * Load ticket configuration from API
 */
async function loadTicketConfig() {
    const guildId = window.guildId || window.location.pathname.split('/').pop();
    try {
        const response = await fetch(`/api/server/${guildId}/ticket-config`);
        const data = await response.json();

        if (data.success && data.config) {
            const config = data.config;

            // Populate channel dropdowns first
            await populateTicketDropdowns();

            // Set values
            document.getElementById('ticketChannel').value = config.ticket_channel_id || '';
            document.getElementById('ticketCategory').value = config.ticket_category_id || '';
            document.getElementById('ticketStaffRole').value = config.admin_role_id || '';
            document.getElementById('ticketTranscriptChannel').value = config.transcript_channel_id || '';
            document.getElementById('ticketInitialMessage').value = config.ticket_message || 'Click the button below to open a support ticket.';
            document.getElementById('ticketWelcomeMessage').value = config.welcome_message || 'Hello {user}, support will be with you shortly. Please describe your issue and we\'ll help you as soon as possible.';
        }
    } catch (error) {
        console.error('Error loading ticket config:', error);
        showNotification('Failed to load ticket configuration', 'error');
    }
}

/**
 * Save ticket configuration to API
 */
async function saveTicketConfig() {
    try {
        const ticketChannel = document.getElementById('ticketChannel').value;
        const ticketCategory = document.getElementById('ticketCategory').value;
        const staffRole = document.getElementById('ticketStaffRole').value;
        const transcriptChannel = document.getElementById('ticketTranscriptChannel').value;
        const initialMessage = document.getElementById('ticketInitialMessage').value;
        const welcomeMessage = document.getElementById('ticketWelcomeMessage').value;

        // Validation
        if (!ticketChannel) {
            showNotification('Please select a ticket button channel', 'error');
            return;
        }
        if (!ticketCategory) {
            showNotification('Please select a ticket category', 'error');
            return;
        }
        if (!staffRole) {
            showNotification('Please select a staff/support role', 'error');
            return;
        }

        const payload = {
            ticket_channel_id: ticketChannel,
            ticket_category_id: ticketCategory,
            admin_role_id: staffRole,
            transcript_channel_id: transcriptChannel || null,
            ticket_message: initialMessage || 'Click the button below to open a support ticket.',
            welcome_message: welcomeMessage || 'Hello {user}, support will be with you shortly. Please describe your issue and we\'ll help you as soon as possible.'
        };

        const guildId = window.guildId || window.location.pathname.split('/').pop();
        const response = await fetch(`/api/server/${guildId}/ticket-config`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            showNotification('Ticket configuration saved successfully!', 'success');
        } else {
            showNotification(data.error || 'Failed to save configuration', 'error');
        }
    } catch (error) {
        console.error('Error saving ticket config:', error);
        showNotification('Failed to save ticket configuration', 'error');
    }
}

/**
 * Populate all ticket-related dropdowns
 */
async function populateTicketDropdowns() {
    try {
        const guildId = window.guildId || window.location.pathname.split('/').pop();
        const response = await fetch(`/api/server/${guildId}/discord-data`);
        const data = await response.json();

        if (data.roles && data.channels) {
            // 1. Ticket Channel
            const ticketChannelSelect = document.getElementById('ticketChannel');
            if (typeof populateChannelDropdownWithCategories === 'function') {
                populateChannelDropdownWithCategories(ticketChannelSelect, data.channels, {
                    channelTypes: [0, 5],
                    placeholder: "Select channel...",
                    showCategory: true
                });
            } else {
                console.warn("populateChannelDropdownWithCategories not found, using basic fallback");
                ticketChannelSelect.innerHTML = '<option value="">Select channel...</option>';
                data.channels.filter(ch => ch.type === 0).forEach(channel => {
                    const option = document.createElement('option');
                    option.value = channel.id;
                    option.textContent = `#${channel.name}`;
                    ticketChannelSelect.appendChild(option);
                });
            }

            // 2. Ticket Category
            const categorySelect = document.getElementById('ticketCategory');
            categorySelect.innerHTML = '<option value="">Select category...</option>';
            data.channels.filter(ch => ch.type === 4).forEach(category => {
                const option = document.createElement('option');
                option.value = category.id;
                option.textContent = category.name;
                categorySelect.appendChild(option);
            });

            // 3. Staff Role
            const staffRoleSelect = document.getElementById('ticketStaffRole');
            staffRoleSelect.innerHTML = '<option value="">Select role...</option>';
            data.roles.forEach(role => {
                const option = document.createElement('option');
                option.value = role.id;
                option.textContent = role.name;
                staffRoleSelect.appendChild(option);
            });

            // 4. Transcript Channel
            const transcriptChannelSelect = document.getElementById('ticketTranscriptChannel');
            if (typeof populateChannelDropdownWithCategories === 'function') {
                populateChannelDropdownWithCategories(transcriptChannelSelect, data.channels, {
                    channelTypes: [0, 5],
                    placeholder: "Select transcript channel...",
                    showCategory: true
                });

                const noneOption = document.createElement('option');
                noneOption.value = "";
                noneOption.textContent = "None - Don't log transcripts";
                transcriptChannelSelect.insertBefore(noneOption, transcriptChannelSelect.firstChild);
            } else {
                transcriptChannelSelect.innerHTML = '<option value="">None - Don\'t log transcripts</option>';
                data.channels.filter(ch => ch.type === 0).forEach(channel => {
                    const option = document.createElement('option');
                    option.value = channel.id;
                    option.textContent = `#${channel.name}`;
                    transcriptChannelSelect.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Error populating ticket dropdowns:', error);
    }
}

/**
 * Insert variable into welcome message textarea
 */
function insertTicketVar(variable) {
    const textarea = document.getElementById('ticketWelcomeMessage');
    const cursorPos = textarea.selectionStart;
    const textBefore = textarea.value.substring(0, cursorPos);
    const textAfter = textarea.value.substring(cursorPos);

    textarea.value = textBefore + variable + textAfter;
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = cursorPos + variable.length;
}

/**
 * Initialize ticket tab when switched to
 */
function initTicketTab() {
    loadTicketConfig();
}

// Make functions globally available
window.loadTicketConfig = loadTicketConfig;
window.saveTicketConfig = saveTicketConfig;
window.insertTicketVar = insertTicketVar;
window.initTicketTab = initTicketTab;
