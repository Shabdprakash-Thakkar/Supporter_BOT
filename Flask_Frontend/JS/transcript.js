// v4.0.0
document.addEventListener('DOMContentLoaded', () => {
    const raw = document.getElementById('raw-data').textContent;
    const container = document.getElementById('container');

    if (!raw) {
        container.innerHTML = '<div class="text-center text-gray-500 mt-10">Empty transcript.</div>';
        return;
    }

    const lines = raw.split('\n');
    let lastUser = null;
    let currentGroup = null;

    lines.forEach(line => {
        line = line.trim();
        if (!line) return;

        // Check for attachment
        if (line.startsWith('[Attachment]')) {
            if (currentGroup) {
                const url = line.replace('[Attachment]', '').trim();
                const isImage = url.match(/\.(jpeg|jpg|gif|png|webp)$/i);

                const attDiv = document.createElement('div');
                attDiv.className = 'attachment';
                if (isImage) {
                    attDiv.innerHTML = `<a href="${url}" target="_blank"><img src="${url}" alt="Attachment"></a>`;
                } else {
                    attDiv.innerHTML = `<a href="${url}" target="_blank" class="attachment-link"><i class="fas fa-file-download mr-1"></i> ${url.split('/').pop()}</a>`;
                }
                currentGroup.querySelector('.msg-content').appendChild(attDiv);
            }
            return;
        }

        // Check for message: [TIMESTAMP] USERNAME: MESSAGE
        const match = line.match(/^\[(.*?)\] (.*?): (.*)$/);
        if (match) {
            const [_, timestamp, username, content] = match;

            // Create new message group
            lastUser = username;

            const msgDiv = document.createElement('div');
            msgDiv.className = 'discord-msg';

            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'discord-avatar';
            avatarDiv.textContent = username.substring(0, 1).toUpperCase();

            const contentDiv = document.createElement('div');
            contentDiv.className = 'msg-content';

            const headerDiv = document.createElement('div');
            headerDiv.className = 'msg-header';
            headerDiv.innerHTML = `<span class="msg-username">${username}</span><span class="msg-timestamp">${timestamp}</span>`;

            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'msg-body';
            bodyDiv.textContent = content; // Safe text to prevent XSS

            contentDiv.appendChild(headerDiv);
            contentDiv.appendChild(bodyDiv);

            msgDiv.appendChild(avatarDiv);
            msgDiv.appendChild(contentDiv);

            container.appendChild(msgDiv);
            currentGroup = msgDiv;
        } else {
            // Continuation of previous message? Or system message?
            // For now, append to previous body if it exists, otherwise ignore
            if (currentGroup) {
                const body = currentGroup.querySelector('.msg-body');
                body.textContent += '\n' + line;
            }
        }
    });
});
