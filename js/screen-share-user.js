/**
 * screen-share-user.js
 * Handles screen sharing from the USER side → streams to Admin via WebRTC
 */

let ssUserPeer = null;
let ssUserStream = null;
let ssAdminId = null;

async function startScreenShare() {
    // 1. Make sure socket is ready
    if (!peerSocket || !peerSocket.connected) {
        Toast.error('Chat not connected. Open the chat first.');
        return;
    }

    // 2. Get admin socket ID
    try {
        const { admin } = await apiRequest('/chat/admin-id');
        if (!admin) { Toast.error('Admin not found.'); return; }
        ssAdminId = admin._id;
    } catch (e) {
        Toast.error('Could not reach admin.');
        return;
    }

    // 3. Request screen share – browser will show its own picker
    try {
        ssUserStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: false
        });
    } catch (e) {
        if (e.name !== 'NotAllowedError') Toast.error('Screen share cancelled.');
        return;
    }

    // 4. Create WebRTC peer connection
    ssUserPeer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    ssUserStream.getTracks().forEach(t => ssUserPeer.addTrack(t, ssUserStream));

    // ICE candidates → admin
    ssUserPeer.onicecandidate = ({ candidate }) => {
        if (candidate) {
            peerSocket.emit('screen_share_ice', { targetId: ssAdminId, candidate });
        }
    };

    // Create offer → send to admin
    const offer = await ssUserPeer.createOffer();
    await ssUserPeer.setLocalDescription(offer);
    peerSocket.emit('screen_share_offer', { adminId: ssAdminId, offer });

    // Notify admin they're receiving a request
    const me = Auth.getUser();
    peerSocket.emit('screen_share_started', { adminId: ssAdminId, userName: me?.name || 'User' });

    // 5. Wait for admin's answer
    peerSocket.once('screen_share_answer', async ({ answer }) => {
        await ssUserPeer.setRemoteDescription(new RTCSessionDescription(answer));
    });

    // ICE from admin
    peerSocket.on('screen_share_ice', ({ candidate }) => {
        if (ssUserPeer && candidate) {
            ssUserPeer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => { });
        }
    });

    // 6. Update UI
    const btn = document.getElementById('screen-share-btn');
    if (btn) {
        btn.textContent = '⏹️ Stop Sharing';
        btn.style.background = 'rgba(239,68,68,0.2)';
        btn.style.borderColor = 'rgba(239,68,68,0.5)';
        btn.style.color = '#f87171';
        btn.onclick = stopScreenShare;
    }

    const indicator = document.getElementById('screen-share-indicator');
    if (indicator) indicator.style.display = 'flex';

    Toast.success('🖥️ Screen sharing started! Admin can now see your screen.');

    // Handle if user stops via browser's native stop button
    ssUserStream.getVideoTracks()[0].onended = () => stopScreenShare();
}

function stopScreenShare() {
    if (ssUserStream) {
        ssUserStream.getTracks().forEach(t => t.stop());
        ssUserStream = null;
    }
    if (ssUserPeer) {
        ssUserPeer.close();
        ssUserPeer = null;
    }
    if (peerSocket && ssAdminId) {
        peerSocket.emit('screen_share_stopped', { adminId: ssAdminId });
    }

    // Reset button
    const btn = document.getElementById('screen-share-btn');
    if (btn) {
        btn.innerHTML = '🖥️ Share Screen';
        btn.style.background = 'rgba(99,102,241,0.15)';
        btn.style.borderColor = 'rgba(99,102,241,0.4)';
        btn.style.color = '#a5b4fc';
        btn.onclick = startScreenShare;
    }

    const indicator = document.getElementById('screen-share-indicator');
    if (indicator) indicator.style.display = 'none';

    Toast.info('Screen sharing stopped.');
}
