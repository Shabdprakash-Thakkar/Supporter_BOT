// v5.0.0
// v4.0.0
/**
 * @file Channel Dropdown Population Utility
 * @description
 * Utility function to populate Discord channel dropdowns with category grouping.
 * Displays channels as "#channel -> Category Name" sorted by category.
 * 
 * Features:
 * - Filters by channel type
 * - Enriches channels with Category name
 * - Sorts by Category then Channel name
 * - Formats text as "#channel -> Category"
 * - Compatible with Select2 dropdowns
 */

/**
 * Populate a select element with Discord channels including category info.
 * 
 * @param {HTMLSelectElement} selectElement - The select element to populate
 * @param {Array} channels - Array of channel objects from Discord API
 * @param {Object} options - Configuration options
 * @param {Array<number>} options.channelTypes - Discord channel types to include (default: [0, 5] for text/announcement)
 * @param {string} options.placeholder - Placeholder text (default: "Select a channel...")
 * @param {boolean} options.includeHash - Whether to prefix channel names with # (default: true)
 * @param {boolean} options.showCategory - Whether to append category name (default: true)
 * @param {string} options.categorySeparator - Separator between channel and category (default: " -> ")
 * @param {boolean} options.sortCategories - Whether to sort categories alphabetically (default: true)
 * @param {boolean} options.sortChannels - Whether to sort channels within modifiers (default: true)
 */
function populateChannelDropdownWithCategories(selectElement, channels, options = {}) {
    // Default options
    const config = {
        channelTypes: options.channelTypes || [0, 5], // 0 = text, 5 = announcement
        placeholder: options.placeholder || "Select a channel...",
        includeHash: options.includeHash !== undefined ? options.includeHash : true,
        showCategory: options.showCategory !== undefined ? options.showCategory : true,
        categorySeparator: options.categorySeparator || " -> ",
        sortCategories: options.sortCategories !== undefined ? options.sortCategories : true,
        sortChannels: options.sortChannels !== undefined ? options.sortChannels : true,
    };

    // Clear existing options
    selectElement.innerHTML = "";

    // Add placeholder
    if (config.placeholder) {
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.disabled = true;
        placeholderOption.selected = true;
        placeholderOption.textContent = config.placeholder;
        selectElement.appendChild(placeholderOption);
    }

    // 1. Map all channels by ID for easy lookup (to find category names)
    const channelMap = new Map();
    channels.forEach(ch => channelMap.set(ch.id, ch));

    // 2. Filter target channels
    const targetChannels = channels.filter((ch) =>
        config.channelTypes.includes(ch.type)
    );

    console.log(`[PopulateDropdown] Total channels: ${channels.length}, Target channels: ${targetChannels.length}`);


    if (targetChannels.length === 0) {
        const noChannelsOption = document.createElement("option");
        noChannelsOption.disabled = true;
        noChannelsOption.textContent = "No channels available";
        selectElement.appendChild(noChannelsOption);
        return;
    }

    // 3. Enrich with category info and handle missing categories
    const enrichedChannels = targetChannels.map(ch => {
        let categoryName = "No Category"; // Default literal for sorting
        let hasCategory = false;

        if (ch.parent_id && channelMap.has(ch.parent_id)) {
            categoryName = channelMap.get(ch.parent_id).name;
            hasCategory = true;
        } else if (ch.parent_id) {
            console.warn(`[PopulateDropdown] Channel ${ch.name} has parent_id ${ch.parent_id} but parent not found in map.`);
        }

        return {
            ...ch,
            categoryName,
            hasCategory
        };
    });

    // 4. Sort channels
    enrichedChannels.sort((a, b) => {
        // Primary sort: Category
        if (config.sortCategories) {
            // "No Category" should often come last or first? 
            // Alphabetical sort usually puts it in middle. 
            // Let's standard alphabetical.
            const catCompare = a.categoryName.localeCompare(b.categoryName);
            if (catCompare !== 0) return catCompare;
        }

        // Secondary sort: Channel Name
        if (config.sortChannels) {
            return a.name.localeCompare(b.name);
        }
        return 0;
    });

    // 5. Render
    enrichedChannels.forEach(ch => {
        const opt = document.createElement("option");
        opt.value = ch.id;

        // Prefix (# or 🔊 etc - caller might handle icon via emoji in name, but includeHash handles text hash)
        // If includeHash is true and it's a text/announcement channel, add #.
        // For voice, we might want speaker icon if it's not already there?
        // The previous usage in config_time.js handled icons manually? 
        // No, current implementation of this function uses `includeHash`.
        // config_time calls it with `includeHash: false`.
        // So we stick to config.includeHash.

        const prefix = config.includeHash ? "# " : "";

        let label = `${prefix}${ch.name}`;

        if (config.showCategory && ch.hasCategory) {
            label += `${config.categorySeparator}${ch.categoryName}`;
        }

        opt.textContent = label;
        selectElement.appendChild(opt);
    });
}

// Export for use in other modules
if (typeof window !== "undefined") {
    window.populateChannelDropdownWithCategories = populateChannelDropdownWithCategories;
}
