// ═══════════════════════════════════════════════════════════════
//  ENHANCED PEER-TO-PEER CHAT ENGINE
// ═══════════════════════════════════════════════════════════════

let peerSocket = null;
let peerTargetId = null;
let peerGroupId = null;
let peerTargetName = '';
let peerReplyToId = null;
let peerTypingTimeout = null;
let peerPendingAttachment = null;
let peerEditingMsgId = null;

// WebRTC State
let localStream = null;
let peerConnection = null;
const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Voice Recording State
let mediaRecorder = null;
let voiceChunks = [];
let voiceRecordStartTime = 0;

// Group Creation State
let groupMembersToAdd = [];

// Override navigate to boot peer chat
(function overrideNavigate() {
    const orig = typeof navigate !== 'undefined' ? navigate : function () { };
    navigate = function (section, pushState = true) {
        const old = document.querySelector('.section.active')?.id.replace('section-', '');
        orig(section, pushState);
        if (section === 'chat') {
            showMyChatId();
            initPeerSocket().then(() => loadConversations());
        } else if (old === 'chat') {
            if (peerSocket) {
                peerSocket.emit('chat_inactive');
                if (peerGroupId) peerSocket.emit('leave_group', peerGroupId);
            }
        }
    };
})();

function showMyChatId() {
    const user = Auth.getUser();
    const el = document.getElementById('my-chat-id-display');
    if (user && user.chatId && el) el.textContent = user.chatId;
}

function copyMyChatId() {
    const user = Auth.getUser();
    if (user && user.chatId)
        navigator.clipboard.writeText(user.chatId).then(() => Toast.success('Chat ID copied!'));
}

// ── Socket & Events ──────────────────────────────────────────
async function initPeerSocket() {
    if (peerSocket) return;
    const token = Auth.getToken();
    if (!token) return;

    peerSocket = io('https://docportal-backend.onrender.com', { auth: { token } });
    peerSocket.on('connect', () => peerSocket.emit('chat_active'));

    peerSocket.on('receive_message', function (msg) {
        const me = Auth.getUser();
        const myId = String(me?.id || me?._id || '');

        if (msg.groupId) {
            if (peerGroupId === msg.groupId) {
                appendPeerMessage(msg);
                // Mark group read (placeholder)
            }
        } else {
            const senderId = String(msg.sender?._id || msg.sender || '');
            const receiverId = String(msg.receiver?._id || msg.receiver || '');
            const partnerId = senderId === myId ? receiverId : senderId;
            if (peerTargetId && partnerId === peerTargetId && !peerGroupId) {
                appendPeerMessage(msg);
                peerSocket.emit('mark_read', { senderId: partnerId });
            }
        }
        loadConversations();
    });

    peerSocket.on('reaction_added', ({ messageId, userId, emoji }) => {
        const el = document.querySelector(`[data-msg-id="${messageId}"]`);
        if (el) updateMessageReactionsUI(el, userId, emoji);
    });

    peerSocket.on('user_typing', (d) => {
        if (peerGroupId === d.groupId || (d.senderId === peerTargetId && !peerGroupId))
            document.getElementById('peer-typing-indicator').classList.add('active');
    });

    peerSocket.on('call_offer', handleIncomingCall);
    peerSocket.on('call_answer', handleCallAnswer);
    peerSocket.on('ice_candidate', handleIceCandidate);
    peerSocket.on('call_end', handleCallEnd);

    // Other events...
    peerSocket.on('message_deleted', (d) => {
        const el = document.querySelector(`[data-msg-id="${d.messageId}"] .chat-msg-text`);
        if (el) el.textContent = '🚫 Message deleted';
    });
}

// ── Conversation List ─────────────────────────────────────────
let peerConvoCache = []; // safe reference for onclick handlers

async function loadConversations() {
    try {
        const data = await apiRequest('/chat/conversations');
        const list = document.getElementById('user-convo-list');
        const convos = data.conversations || [];
        peerConvoCache = convos; // store globally

        if (!convos.length) {
            list.innerHTML = '<div class="chat-no-users" style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem;">No conversations yet.<br>Find a user above to start chatting.</div>';
            return;
        }

        list.innerHTML = convos.map((c, idx) => {
            const isGroup = c.type === 'group';
            const item = isGroup ? c.group : c.user;
            const name = item.name;
            const avatar = name.charAt(0).toUpperCase();

            let lastTxt = 'No messages';
            if (c.lastMessage) {
                const prefix = isGroup && c.lastMessage.sender ? c.lastMessage.sender.name + ': ' : '';
                lastTxt = prefix + (c.lastMessage.text || '📎 Attachment');
            }
            if (lastTxt.length > 28) lastTxt = lastTxt.substring(0, 28) + '...';

            const id = item._id;
            const active = (isGroup && peerGroupId === id) || (!isGroup && peerTargetId === id && !peerGroupId) ? 'active' : '';
            const typeBadge = isGroup ? '<span class="group-badge">Group</span>' : '';
            const statusDot = !isGroup && item.isChatActive ? '<span class="chat-user-dot online"></span>' : '';
            const unread = c.unreadCount > 0 ? '<span class="chat-user-unread">' + c.unreadCount + '</span>' : '';

            // ── DELETE MODE ── use idx (safe number) as onclick arg
            if (peerDeleteMode) {
                return '<div class="chat-user-item" style="border:1px solid rgba(239,68,68,0.3);cursor:pointer;" onclick="peerDeleteByIndex(' + idx + ')">'
                    + '<div class="chat-user-avatar" style="background:linear-gradient(135deg,#ef4444,#b91c1c);">' + avatar + '</div>'
                    + '<div class="chat-user-info">'
                    + '<div class="chat-user-name">' + typeBadge + name + '</div>'
                    + '<div class="chat-user-email" style="color:#f87171;">Tap to delete this chat</div>'
                    + '</div>'
                    + '<div style="width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">🗑️</div>'
                    + '</div>';
            }

            // ── NORMAL MODE ──
            const onclick = isGroup
                ? 'openGroupChat(\'' + id + '\', \'' + name.replace(/'/g, "\\'") + '\')'
                : 'openPeerChat(\'' + id + '\', \'' + name.replace(/'/g, "\\'") + '\', \'\', ' + (item.isChatActive || false) + ')';

            return '<div class="chat-user-item ' + active + '" onclick="' + onclick + '">'
                + '<div class="chat-user-avatar">' + avatar + '</div>'
                + '<div class="chat-user-info">'
                + '<div class="chat-user-name">' + typeBadge + name + '</div>'
                + '<div class="chat-user-email">' + lastTxt + '</div>'
                + '</div>'
                + statusDot + unread
                + '</div>';
        }).join('');
    } catch (e) { console.error('loadConversations error:', e); }
}

// Called with a safe numeric index — no quoting issues possible
function peerDeleteByIndex(idx) {
    const c = peerConvoCache[idx];
    if (!c) return;
    const isGroup = c.type === 'group';
    const item = isGroup ? c.group : c.user;
    peerClearFullChat(item._id, item.name, isGroup);
}


// ── Opening Chats ─────────────────────────────────────────────
async function openPeerChat(userId, name, chatId, isOnline) {
    // ── Close search result card ──
    const searchResult = document.getElementById('peer-search-result');
    if (searchResult) { searchResult.style.display = 'none'; searchResult.innerHTML = ''; }
    const searchInput = document.getElementById('peer-search-input');
    if (searchInput) searchInput.value = '';

    peerGroupId = null;
    peerTargetId = userId;
    peerTargetName = name;
    updateChatHeader(name, isOnline ? '🟢 Online' : '⚫ Offline');
    document.getElementById('peer-empty-state').style.display = 'none';
    document.getElementById('peer-conversation').style.display = 'flex';
    await loadPeerHistory(userId);
}

async function openGroupChat(groupId, name) {
    if (peerGroupId) peerSocket.emit('leave_group', peerGroupId);
    peerTargetId = null;
    peerGroupId = groupId;
    peerTargetName = name;
    peerSocket.emit('join_group', groupId);
    updateChatHeader(name, 'Group Chat');
    document.getElementById('peer-empty-state').style.display = 'none';
    document.getElementById('peer-conversation').style.display = 'flex';
    await loadGroupHistory(groupId);
}

function updateChatHeader(name, status) {
    document.getElementById('peer-avatar').textContent = name.charAt(0).toUpperCase();
    document.getElementById('peer-convo-name').textContent = name;
    document.getElementById('peer-convo-status').textContent = status;
}

async function loadPeerHistory(userId) {
    const data = await apiRequest(`/chat/history/${userId}`);
    renderMessages(data.messages);
}

async function loadGroupHistory(groupId) {
    const data = await apiRequest(`/chat/group-history/${groupId}`);
    renderMessages(data.messages);
}

function renderMessages(messages) {
    const box = document.getElementById('peer-chat-messages');
    box.innerHTML = '';
    messages.forEach(msg => appendPeerMessage(msg, false));
    box.scrollTop = box.scrollHeight;
}

// ── Rendering & Features ──────────────────────────────────────
function appendPeerMessage(msg, scroll = true) {
    const box = document.getElementById('peer-chat-messages');
    const me = Auth.getUser();
    const myId = String(me?._id || me?.id || '');
    const senderId = String(msg.sender?._id || msg.sender || '');
    const isMine = senderId === myId;

    const div = document.createElement('div');
    div.className = `chat-msg ${isMine ? 'sent' : 'received'}`;
    div.dataset.msgId = msg._id;

    // Sender Name for Groups
    const senderName = (peerGroupId && !isMine) ? `<span class="chat-sender-name">${msg.sender.name}</span>` : '';

    // Attachment
    let attachHtml = '';
    if (msg.attachment && msg.attachment.url) {
        const url = `https://docportal-backend.onrender.com${msg.attachment.url}`;
        if (msg.attachment.mimetype.startsWith('audio/')) {
            attachHtml = renderVoiceNote(url, msg.attachment.duration);
        } else if (msg.attachment.mimetype.startsWith('image/')) {
            attachHtml = `<img class="chat-attachment-img" src="${url}" onclick="window.open('${url}')" />`;
        } else {
            attachHtml = `<a class="chat-attachment-file" href="${url}" target="_blank">📎 ${msg.attachment.filename}</a>`;
        }
    }

    // Reactions
    const reactionsHtml = `<div class="chat-reactions" id="reacts-${msg._id}">${renderReactions(msg.reactions)}</div>`;

    // Rich Previews (detected from text)
    const links = msg.text.match(/(https?:\/\/[^\s]+)/g);
    let previewHtml = '';
    if (links && links.length) {
        // Fetching preview is async, so we'll append it later or use a placeholder
        previewHtml = `<div class="rich-preview-placeholder" data-url="${links[0]}"></div>`;
        fetchRichPreview(links[0], msg._id);
    }

    div.innerHTML = `
        <div class="chat-bubble">
            ${senderName}
            ${msg.replyTo ? `<div class="chat-msg-quote">${msg.replyTo.text}</div>` : ''}
            ${attachHtml}
            <span class="chat-msg-text">${msg.text}</span>
            ${previewHtml}
            <span class="chat-msg-meta">${new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            ${reactionsHtml}
            <div class="chat-msg-actions">
                <button onclick="showReactionPicker(event, '${msg._id}')">😀</button>
                <button onclick="peerStartReply('${msg._id}')">↩️</button>
            </div>
        </div>`;

    box.appendChild(div);
    if (scroll) box.scrollTop = box.scrollHeight;
}

// ── Voice Notes (MediaRecorder) ───────────────────────────────
async function toggleVoiceRecording() {
    const btn = document.getElementById('peer-voice-btn');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.classList.remove('recording');
        btn.innerHTML = '🎤';
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        voiceChunks = [];
        voiceRecordStartTime = Date.now();

        mediaRecorder.ondataavailable = e => voiceChunks.push(e.data);
        mediaRecorder.onstop = async () => {
            const blob = new Blob(voiceChunks, { type: 'audio/webm' });
            const duration = Math.round((Date.now() - voiceRecordStartTime) / 1000);
            sendVoiceNote(blob, duration);
            stream.getTracks().forEach(t => t.stop());
        };

        mediaRecorder.start();
        btn.classList.add('recording');
        btn.innerHTML = '⏹️';
        Toast.info('Recording...');
    } catch (e) { Toast.error('Mic access denied'); }
}

async function sendVoiceNote(blob, duration) {
    const fd = new FormData();
    fd.append('file', blob, 'voice_note.webm');
    try {
        const data = await apiRequest('/chat/upload', 'POST', fd, true);
        const attachment = data.attachment;
        attachment.duration = duration;
        peerSocket.emit('send_message', {
            receiverId: peerTargetId,
            groupId: peerGroupId,
            text: '',
            attachment
        });
    } catch (e) { Toast.error('Failed to upload voice'); }
}

function renderVoiceNote(url, duration) {
    return `
        <div class="voice-note-player">
            <button class="voice-play-btn" onclick="playVoice(this, '${url}')">▶️</button>
            <div class="voice-waveform">
                ${Array(15).fill(0).map(() => `<div class="voice-bar" style="height:${Math.random() * 15 + 5}px"></div>`).join('')}
            </div>
            <div class="voice-duration">${duration || 0}s</div>
        </div>`;
}

function playVoice(btn, url) {
    const audio = new Audio(url);
    audio.play();
    btn.innerHTML = '⏸️';
    audio.onended = () => btn.innerHTML = '▶️';
}

// ── Reactions ─────────────────────────────────────────────────
function showReactionPicker(e, msgId) {
    e.stopPropagation();
    const existing = document.querySelector('.reaction-picker-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'reaction-picker-overlay';
    overlay.onclick = () => overlay.remove();

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    const emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
    picker.innerHTML = emojis.map(emo => `<span class="reaction-emoji" onclick="addReaction('${msgId}', '${emo}')">${emo}</span>`).join('');

    const rect = e.target.getBoundingClientRect();
    picker.style.top = `${rect.top - 50}px`;
    picker.style.left = `${rect.left}px`;

    overlay.appendChild(picker);
    document.body.appendChild(overlay);
}

async function addReaction(msgId, emoji) {
    try {
        const data = await apiRequest(`/chat/message/${msgId}/react`, 'POST', { emoji });
        peerSocket.emit('add_reaction', { messageId: msgId, receiverId: peerTargetId, groupId: peerGroupId, emoji });
        const el = document.querySelector(`[data-msg-id="${msgId}"]`);
        if (el) updateMessageReactionsUI(el, Auth.getUser()._id, emoji);
    } catch (e) { }
}

function renderReactions(reactions) {
    if (!reactions || !reactions.length) return '';
    const counts = {};
    reactions.forEach(r => counts[r.emoji] = (counts[r.emoji] || 0) + 1);
    return Object.entries(counts).map(([emo, count]) => `
        <div class="chat-reaction-btn">
            <span>${emo}</span>
            <span class="chat-reaction-count">${count}</span>
        </div>`).join('');
}

function updateMessageReactionsUI(msgEl, userId, emoji) {
    // Simpler to re-fetch/re-render or just update the reaction block
    const reactBox = msgEl.querySelector('.chat-reactions');
    // For this demo, we'll just show the emoji added
    // In a real app, you'd calculate the full reaction state
    loadConversations(); // Hack to refresh
}

// ── Rich Previews ─────────────────────────────────────────────
async function fetchRichPreview(url, msgId) {
    try {
        const data = await apiRequest(`/chat/preview?url=${encodeURIComponent(url)}`);
        const placeholder = document.querySelector(`[data-msg-id="${msgId}"] .rich-preview-placeholder`);
        if (placeholder) {
            placeholder.outerHTML = `
                <a href="${url}" target="_blank" class="rich-preview-card">
                    ${data.image ? `<img src="${data.image}" class="rich-preview-img" />` : ''}
                    <div class="rich-preview-info">
                        <div class="rich-preview-site">${data.site}</div>
                        <div class="rich-preview-title">${data.title}</div>
                        <div class="rich-preview-desc">${data.description}</div>
                    </div>
                </a>`;
        }
    } catch (e) { }
}

// ── WebRTC Calling ────────────────────────────────────────────
async function peerStartCall(type) {
    if (!peerTargetId) return;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: type === 'video'
        });
        showCallOverlay(peerTargetName, 'Calling...');

        peerConnection = new RTCPeerConnection(rtcConfig);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.onicecandidate = e => {
            if (e.candidate) peerSocket.emit('ice_candidate', { to: peerTargetId, candidate: e.candidate });
        };
        peerConnection.ontrack = e => {
            document.getElementById('remote-video').srcObject = e.streams[0];
            document.getElementById('call-initiation').style.display = 'none';
            document.getElementById('call-active').style.display = 'block';
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        peerSocket.emit('call_offer', { to: peerTargetId, offer, type });

        document.getElementById('local-video').srcObject = localStream;
    } catch (e) { Toast.error('Camera/Mic access failed'); }
}

async function handleIncomingCall({ from, offer, type }) {
    // Simplified: Always show incoming call overlay
    showCallOverlay('Incoming Call', `${type.toUpperCase()} Call`);
    document.getElementById('call-accept-btn').style.display = 'flex';
    document.getElementById('call-accept-btn').onclick = () => acceptCall(from, offer, type);
    document.getElementById('call-reject-btn').onclick = () => rejectCall(from);
}

async function acceptCall(from, offer, type) {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
        document.getElementById('local-video').srcObject = localStream;

        peerConnection = new RTCPeerConnection(rtcConfig);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        peerConnection.onicecandidate = e => {
            if (e.candidate) peerSocket.emit('ice_candidate', { to: from, candidate: e.candidate });
        };
        peerConnection.ontrack = e => {
            document.getElementById('remote-video').srcObject = e.streams[0];
            document.getElementById('call-initiation').style.display = 'none';
            document.getElementById('call-active').style.display = 'block';
        };

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        peerSocket.emit('call_answer', { to: from, answer });
    } catch (e) { rejectCall(from); }
}

function handleCallAnswer({ answer }) {
    peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
}

function handleIceCandidate({ candidate }) {
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}

function showCallOverlay(name, status) {
    const ov = document.getElementById('call-overlay');
    ov.classList.add('active');
    document.getElementById('call-name').textContent = name;
    document.getElementById('call-status').textContent = status;
}

function peerEndCall() {
    if (peerTargetId) peerSocket.emit('call_end', { to: peerTargetId });
    handleCallEnd();
}

function handleCallEnd() {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (peerConnection) peerConnection.close();
    document.getElementById('call-overlay').classList.remove('active');
    document.getElementById('call-active').style.display = 'none';
    document.getElementById('call-initiation').style.display = 'flex';
}

function rejectCall(from) {
    peerSocket.emit('call_end', { to: from });
    handleCallEnd();
}

// ── Groups Management ─────────────────────────────────────────
function toggleGroupModal(show) {
    document.getElementById('create-group-modal').classList.toggle('active', show);
    if (show) groupMembersToAdd = [];
    renderMemberChips();
}

async function groupAddMember() {
    const input = document.getElementById('group-member-id');
    const id = input.value.trim();
    if (id.length !== 10) return Toast.error('Invalid Chat ID');
    try {
        const data = await apiRequest(`/chat/find/${id}`);
        if (groupMembersToAdd.find(m => m._id === data.user._id)) return;
        groupMembersToAdd.push(data.user);
        renderMemberChips();
        input.value = '';
    } catch (e) { Toast.error('User not found'); }
}

function renderMemberChips() {
    const box = document.getElementById('group-member-chips');
    box.innerHTML = groupMembersToAdd.map(m => `
        <div class="member-chip">
            ${m.name} <span class="member-chip-remove" onclick="removeMember('${m._id}')">✕</span>
        </div>`).join('');
}

function removeMember(id) {
    groupMembersToAdd = groupMembersToAdd.filter(m => m._id !== id);
    renderMemberChips();
}

async function peerCreateGroup() {
    const name = document.getElementById('group-name-input').value.trim();
    if (!name) return Toast.error('Group name required');
    try {
        await apiRequest('/chat/groups', 'POST', {
            name,
            members: groupMembersToAdd.map(m => m._id)
        });
        Toast.success('Group created!');
        toggleGroupModal(false);
        loadConversations();
    } catch (e) { Toast.error('Failed to create group'); }
}

// ── Sending Messages (Enhanced) ───────────────────────────────
function peerSendMessage() {
    if (peerEditingMsgId) { peerSaveEdit(); return; }
    const input = document.getElementById('peer-chat-input');
    const text = input.value.trim();
    if (!text && !peerPendingAttachment) return;

    if (peerPendingAttachment) {
        // Handle file logic (similar to existing)
        const fd = new FormData();
        fd.append('file', peerPendingAttachment.file);
        apiRequest('/chat/upload', 'POST', fd, true).then(d => {
            peerSocket.emit('send_message', {
                receiverId: peerTargetId,
                groupId: peerGroupId,
                text: text,
                attachment: d.attachment
            });
            peerCancelFile();
            input.value = '';
        });
    } else {
        peerSocket.emit('send_message', {
            receiverId: peerTargetId,
            groupId: peerGroupId,
            text,
            replyTo: peerReplyToId
        });
        input.value = '';
        peerCancelReply();
    }
}

// ── Search User by Chat ID ────────────────────────────────────
async function searchPeerUser() {
    const chatId = document.getElementById('peer-search-input').value.trim();
    const box = document.getElementById('peer-search-result');
    if (!/^\d{10}$/.test(chatId)) {
        box.style.display = 'block';
        box.innerHTML = '<div style="color:#f87171;font-size:.85rem;">⚠️ Enter a valid 10-digit Chat ID.</div>';
        return;
    }
    box.style.display = 'block';
    box.innerHTML = '<div style="color:var(--text-muted);font-size:.85rem;">Searching…</div>';
    try {
        const data = await apiRequest('/chat/find/' + chatId);
        const u = data.user;
        const statusTxt = u.isChatActive ? '🟢 Online' : '⚫ Offline';
        box.innerHTML = '<div style="background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.25);border-radius:12px;padding:14px 18px;display:flex;align-items:center;gap:14px;">'
            + '<div style="width:44px;height:44px;border-radius:50%;background:var(--gradient-primary);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.1rem;flex-shrink:0;">' + u.name.charAt(0).toUpperCase() + '</div>'
            + '<div style="flex:1;"><div style="font-weight:700;color:var(--text-primary);">' + u.name + '</div>'
            + '<div style="font-size:.75rem;color:var(--text-muted);">Chat ID: <span style="font-family:monospace;">' + u.chatId + '</span> · ' + statusTxt + '</div></div>'
            + '<button onclick="openPeerChat(\'' + u._id + '\',\'' + u.name.replace(/'/g, "\\'") + '\',\'' + (u.chatId || '') + '\',' + u.isChatActive + ')" class="btn btn-primary" style="width:auto;padding:8px 18px;font-size:.85rem;">💬 Chat</button>'
            + '</div>';
    } catch (err) {
        box.innerHTML = '<div style="color:#f87171;font-size:.85rem;">❌ ' + (err.message || 'User not found') + '</div>';
    }
}

// ── Typing Indicator ──────────────────────────────────────────
function handlePeerTyping() {
    if (!peerSocket) return;
    peerSocket.emit('typing', { receiverId: peerTargetId, groupId: peerGroupId });
    clearTimeout(peerTypingTimeout);
    peerTypingTimeout = setTimeout(function () {
        peerSocket.emit('stop_typing', { receiverId: peerTargetId, groupId: peerGroupId });
    }, 2000);
}

// ── File Attachment ───────────────────────────────────────────
function peerHandleFileSelect(input) {
    const file = input.files[0];
    if (!file) return;
    peerPendingAttachment = { file: file };
    document.getElementById('peer-file-preview-name').textContent = file.name;
    document.getElementById('peer-file-preview-size').textContent = formatSize(file.size);
    const thumb = document.getElementById('peer-file-preview-thumb');
    if (file.type.startsWith('image/')) {
        const r = new FileReader();
        r.onload = function (e) { thumb.innerHTML = '<img src="' + e.target.result + '" style="width:64px;height:64px;object-fit:cover;border-radius:8px;">'; };
        r.readAsDataURL(file);
    } else {
        thumb.innerHTML = '<div style="font-size:2rem;">📎</div>';
    }
    document.getElementById('peer-file-preview-bar').classList.add('active');
    input.value = '';
}

function peerCancelFile() {
    peerPendingAttachment = null;
    const bar = document.getElementById('peer-file-preview-bar');
    if (bar) bar.classList.remove('active');
    const thumb = document.getElementById('peer-file-preview-thumb');
    if (thumb) thumb.innerHTML = '';
}

// ── Reply ─────────────────────────────────────────────────────
function peerStartReply(msgId) {
    const el = document.querySelector('[data-msg-id="' + msgId + '"]');
    const text = el && el.querySelector('.chat-msg-text') ? el.querySelector('.chat-msg-text').textContent : '📎';
    peerReplyToId = msgId;
    document.getElementById('peer-reply-name').textContent = el && el.classList.contains('sent') ? 'You' : peerTargetName;
    document.getElementById('peer-reply-text').textContent = text;
    document.getElementById('peer-reply-preview').style.display = 'flex';
    document.getElementById('peer-chat-input').focus();
}

function peerCancelReply() {
    peerReplyToId = null;
    const el = document.getElementById('peer-reply-preview');
    if (el) el.style.display = 'none';
}

// ── Copy ──────────────────────────────────────────────────────
function peerCopyMessage(msgId) {
    const el = document.querySelector('[data-msg-id="' + msgId + '"] .chat-msg-text');
    if (el) navigator.clipboard.writeText(el.textContent).then(function () { Toast.success('Copied!'); });
}

// ── Delete ────────────────────────────────────────────────────
async function peerDeleteMessage(msgId) {
    try {
        await apiRequest('/chat/message/' + msgId, 'DELETE');
        const el = document.querySelector('[data-msg-id="' + msgId + '"] .chat-msg-text');
        if (el) el.textContent = '🚫 Message deleted';
        peerSocket.emit('delete_message', { messageId: msgId, receiverId: peerTargetId, groupId: peerGroupId });
    } catch (e) { Toast.error('Delete failed'); }
}

// ── Edit ──────────────────────────────────────────────────────
function peerStartEdit(msgId) {
    const el = document.querySelector('[data-msg-id="' + msgId + '"] .chat-msg-text');
    if (!el) return;
    peerEditingMsgId = msgId;
    document.getElementById('peer-chat-input').value = el.textContent;
    document.getElementById('peer-chat-input').focus();
}

async function peerSaveEdit() {
    const text = document.getElementById('peer-chat-input').value.trim();
    if (!text || !peerEditingMsgId) return;
    try {
        await apiRequest('/chat/message/' + peerEditingMsgId, 'PATCH', { text: text });
        const el = document.querySelector('[data-msg-id="' + peerEditingMsgId + '"] .chat-msg-text');
        if (el) el.textContent = text;
        const meta = document.querySelector('[data-msg-id="' + peerEditingMsgId + '"] .chat-msg-meta');
        if (meta && !meta.querySelector('.chat-edited-label')) {
            const l = document.createElement('span');
            l.className = 'chat-edited-label';
            l.textContent = '(edited)';
            meta.prepend(l);
        }
        peerSocket.emit('edit_message', { messageId: peerEditingMsgId, receiverId: peerTargetId, groupId: peerGroupId, text: text });
        peerEditingMsgId = null;
        document.getElementById('peer-chat-input').value = '';
    } catch (e) { Toast.error('Edit failed'); }
}

// ── Message Action Menu ───────────────────────────────────────
function togglePeerMsgMenu(event, msgId) {
    event.stopPropagation();
    document.querySelectorAll('.chat-msg-menu').forEach(function (m) { m.classList.remove('active'); });
    const menu = document.getElementById('pmenu-' + msgId);
    if (menu) menu.classList.toggle('active');
}

// Close menus when clicking outside
document.addEventListener('click', function () {
    document.querySelectorAll('.chat-msg-menu').forEach(function (m) { m.classList.remove('active'); });
});

// ── Delete Mode (Conversation) ────────────────────────────────
let peerDeleteMode = false;

// Delegated click handler for delete-mode items (avoids inline onclick quoting issues)
document.addEventListener('click', function (e) {
    const item = e.target.closest('.peer-delete-item');
    if (item && peerDeleteMode) {
        const userId = item.dataset.peerId;
        const name = item.dataset.peerName;
        const isGroup = item.dataset.peerGroup === 'true';
        peerClearFullChat(userId, name, isGroup);
    }
});

function toggleDeleteChatMode() {
    peerDeleteMode = !peerDeleteMode;
    const delBtn = document.getElementById('delete-chat-btn');
    const cancelBtn = document.getElementById('cancel-delete-chat-btn');
    if (peerDeleteMode) {
        if (delBtn) delBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'flex';
        const list = document.getElementById('user-convo-list');
        if (list) list.classList.add('delete-mode-active');
        Toast.info('Select a conversation to delete');
    } else {
        if (delBtn) delBtn.style.display = 'flex';
        if (cancelBtn) cancelBtn.style.display = 'none';
        const list = document.getElementById('user-convo-list');
        if (list) list.classList.remove('delete-mode-active');
    }
    loadConversations();
}

function showPeerDeleteConfirm(name, onConfirm) {
    // Remove any existing confirm modal
    const existing = document.getElementById('peer-delete-confirm-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'peer-delete-confirm-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
    modal.innerHTML = `
        <div style="background:#1e1b2e;border:1px solid rgba(239,68,68,0.4);border-radius:16px;padding:2rem;max-width:360px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);">
            <div style="font-size:2.5rem;margin-bottom:1rem;">🗑️</div>
            <h3 style="color:#fff;font-size:1.1rem;margin-bottom:0.5rem;">Delete Chat</h3>
            <p style="color:#94a3b8;font-size:0.9rem;margin-bottom:1.5rem;">Delete the entire chat with <strong style="color:#f87171;">${name}</strong>? This cannot be undone.</p>
            <div style="display:flex;gap:0.75rem;justify-content:center;">
                <button id="peer-del-cancel" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#94a3b8;border-radius:10px;padding:0.6rem 1.4rem;cursor:pointer;font-size:0.9rem;font-weight:600;">Cancel</button>
                <button id="peer-del-confirm" style="background:linear-gradient(135deg,#ef4444,#b91c1c);border:none;color:#fff;border-radius:10px;padding:0.6rem 1.4rem;cursor:pointer;font-size:0.9rem;font-weight:600;">Delete</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    document.getElementById('peer-del-cancel').onclick = () => modal.remove();
    document.getElementById('peer-del-confirm').onclick = () => { modal.remove(); onConfirm(); };
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function peerClearFullChat(userId, name, isGroup) {
    if (!userId) return;
    const uid = String(userId);
    showPeerDeleteConfirm(name, async () => {
        try {
            const endpoint = isGroup ? '/chat/groups/' + uid : '/chat/clear/' + uid;
            await apiRequest(endpoint, 'DELETE');
            Toast.success('✅ Chat with ' + name + ' deleted');
            if (peerTargetId === uid || peerGroupId === uid ||
                (peerTargetId && peerTargetId.toString() === uid) ||
                (peerGroupId && peerGroupId.toString() === uid)) {
                peerTargetId = null;
                peerGroupId = null;
                document.getElementById('peer-conversation').style.display = 'none';
                document.getElementById('peer-empty-state').style.display = 'flex';
            }
            if (peerDeleteMode) toggleDeleteChatMode();
            else loadConversations();
        } catch (e) {
            console.error('Delete chat error:', e);
            Toast.error('Failed to delete: ' + (e.message || 'Server error'));
        }
    });
}

// ── Toggle Group Modal ────────────────────────────────────────
function togglePeerHeaderMenu() {
    const menu = document.getElementById('peer-header-menu');
    if (menu) menu.classList.toggle('active');
}
