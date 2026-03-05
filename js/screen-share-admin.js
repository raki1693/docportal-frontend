/**
 * screen-share-admin.js
 * Handles incoming screen share on the ADMIN side via WebRTC
 */

let ssAdminPeer = null;
let ssPendingOffer = null;
let ssFromUserId = null;
let ssAdminSocket = null; // set from admin page after socket is ready

function ssInitAdminSocket(socket) {
    ssAdminSocket = socket;

    // Someone wants to share screen
    socket.on('screen_share_request', ({ fromUserId, userName }) => {
        ssFromUserId = fromUserId;
        document.getElementById('ss-requester-name').textContent = userName || 'User';
        const bar = document.getElementById('ss-request-bar');
        if (bar) bar.style.display = 'flex';
        document.getElementById('ss-status-badge').textContent = '📲 Incoming request…';
        document.getElementById('ss-status-badge').style.color = '#fbbf24';

        // Navigate to spy tools if not already there
        if (!document.getElementById('section-capture').classList.contains('active')) {
            navigate('capture');
        }

        // Focus the Live Screen tab
        if (typeof switchSpyTab === 'function') {
            switchSpyTab('screen');
        }

        Toast.info('🖥️ ' + (userName || 'A user') + ' wants to share their screen!');
    });

    // Receive WebRTC offer
    socket.on('screen_share_offer', ({ fromUserId, offer }) => {
        ssFromUserId = fromUserId;
        ssPendingOffer = offer;
    });

    // ICE from user
    socket.on('screen_share_ice', ({ candidate }) => {
        if (ssAdminPeer && candidate) {
            ssAdminPeer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { });
        }
    });

    // User stopped sharing
    socket.on('screen_share_ended', ({ fromUserId }) => {
        if (fromUserId === ssFromUserId) {
            adminEndScreenShare();
            Toast.info('🖥️ User stopped screen sharing.');
        }
    });
}

async function adminAcceptScreenShare() {
    if (!ssPendingOffer || !ssFromUserId) {
        Toast.error('No pending screen share request.');
        return;
    }

    // Hide request bar
    document.getElementById('ss-request-bar').style.display = 'none';

    // Create peer connection
    ssAdminPeer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Receive the remote stream → display in video
    ssAdminPeer.ontrack = (event) => {
        const video = document.getElementById('ss-remote-video');
        if (video) {
            video.srcObject = event.streams[0];
            video.style.display = 'block';
            document.getElementById('ss-placeholder').style.display = 'none';
            document.getElementById('ss-fullscreen-btn').style.display = 'block';
        }
    };

    // ICE → send to user
    ssAdminPeer.onicecandidate = ({ candidate }) => {
        if (candidate && ssAdminSocket) {
            ssAdminSocket.emit('screen_share_ice', { targetId: ssFromUserId, candidate });
        }
    };

    // Set remote desc (offer from user)
    await ssAdminPeer.setRemoteDescription(new RTCSessionDescription(ssPendingOffer));

    // Create answer
    const answer = await ssAdminPeer.createAnswer();
    await ssAdminPeer.setLocalDescription(answer);

    // Send answer to user
    if (ssAdminSocket) {
        ssAdminSocket.emit('screen_share_answer', { userId: ssFromUserId, answer });
    }

    // Update UI
    document.getElementById('ss-status-badge').textContent = '🟢 Live';
    document.getElementById('ss-status-badge').style.background = 'rgba(16,185,129,0.2)';
    document.getElementById('ss-status-badge').style.color = '#6ee7b7';
    document.getElementById('ss-end-btn').style.display = 'block';

    ssPendingOffer = null;
    Toast.success('🖥️ Screen share active!');
}

function adminRejectScreenShare() {
    document.getElementById('ss-request-bar').style.display = 'none';
    document.getElementById('ss-status-badge').textContent = 'Waiting for user…';
    document.getElementById('ss-status-badge').style.color = 'var(--text-muted)';
    ssFromUserId = null;
    ssPendingOffer = null;
}

function adminEndScreenShare() {
    if (ssAdminPeer) {
        ssAdminPeer.close();
        ssAdminPeer = null;
    }

    // Hide video, show placeholder
    const video = document.getElementById('ss-remote-video');
    if (video) { video.srcObject = null; video.style.display = 'none'; }
    const placeholder = document.getElementById('ss-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    const fsBtn = document.getElementById('ss-fullscreen-btn');
    if (fsBtn) fsBtn.style.display = 'none';

    const endBtn = document.getElementById('ss-end-btn');
    if (endBtn) endBtn.style.display = 'none';

    const badge = document.getElementById('ss-status-badge');
    if (badge) {
        badge.textContent = 'Waiting for user…';
        badge.style.background = 'rgba(255,255,255,0.05)';
        badge.style.color = 'var(--text-muted)';
    }

    const requestBar = document.getElementById('ss-request-bar');
    if (requestBar) requestBar.style.display = 'none';

    ssFromUserId = null;
    ssPendingOffer = null;
}
