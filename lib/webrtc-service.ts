import io, { Socket } from 'socket.io-client';

// Backend base URL – MUST be your Mac's LAN IP (not localhost) so devices can reach it.
// This should match the backend URL from your React Native app.
const BASE_URL = 'https://server.totus.club';

// Call state tracking for UI
export type CallState = 'idle' | 'calling' | 'ringing' | 'answered' | 'ended' | 'rejected';

// WebRTC state
let pc: RTCPeerConnection | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;
let activeCallUUID: string | null = null;
let currentLoyaltyId: string | null = null;
let currentUserId: 'user1' | 'user2' | 'unknown' = 'unknown'; // Keep for backward compatibility
let currentDeviceId: string | null = null;
let socket: Socket | null = null;
let activeCallStartedAt: number | null = null;
let isVoipInitialized = false;

// Call state tracking for UI
let currentCallState: CallState = 'idle';
let callerName: string | null = null;
let isMuted = false;
let isSpeakerEnabled = false;

// Queue for ICE candidates received before remote description is set
let queuedIceCandidates: Array<{ callId: string; candidate: RTCIceCandidateInit; fromDeviceId: string }> = [];

// Process queued ICE candidates after remote description is set
async function processQueuedIceCandidates(callId: string) {
  if (!pc || !pc.remoteDescription) {
    return;
  }
  
  const candidatesToProcess = queuedIceCandidates.filter(c => c.callId === callId);
  if (candidatesToProcess.length === 0) {
    return;
  }
  
  console.log(`📞 Processing ${candidatesToProcess.length} queued ICE candidates for call:`, callId);
  
  // Remove processed candidates from queue immediately to avoid duplicates
  queuedIceCandidates = queuedIceCandidates.filter(c => c.callId !== callId);
  
  // Process each candidate sequentially to avoid race conditions
  for (const data of candidatesToProcess) {
    try {
      if (data.candidate && pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('✅ Added queued ICE candidate');
      }
    } catch (e: any) {
      const errorMsg = e?.message || String(e);
      // Don't log expected errors (candidate might already be added)
      if (!errorMsg.includes('Invalid candidate') && 
          !errorMsg.includes('InvalidStateError') &&
          !errorMsg.includes('remote description was null')) {
        console.warn('⚠️ Failed to add queued ICE candidate:', errorMsg);
      }
    }
  }
  
  console.log(`✅ Finished processing ${candidatesToProcess.length} queued ICE candidates`);
}

// Callbacks for UI updates
let onCallStateChange: ((state: CallState, name: string | null) => void) | null = null;
let onCallActiveChange: ((isActive: boolean, startedAt: number | null) => void) | null = null;

const generateUUID = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });

function ensureSocketConnected() {
  if (socket && socket.connected) {
    return;
  }
  socket = io(BASE_URL, { transports: ['websocket'] });

  socket.on('connect', () => {
    console.log('Socket connected', socket?.id);
    // Re-register device if we have one
    if (currentDeviceId) {
      if (currentLoyaltyId) {
        socket?.emit('registerDevice', { deviceId: currentDeviceId, loyaltyId: currentLoyaltyId });
      } else if (currentUserId !== 'unknown') {
        socket?.emit('registerDevice', { deviceId: currentDeviceId, userId: currentUserId });
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  // Listen for incoming calls
  socket.on('call-state', (data: { callId: string; state: string; direction: string; peerDeviceId?: string; callerName?: string; fromLoyaltyId?: string }) => {
    console.log('📞 Call state update:', data);
    const { callId, state, direction } = data;
    
    if (state === 'ringing' && direction === 'incoming') {
      // Incoming call
      activeCallUUID = callId;
      currentCallState = 'ringing';
      // Use callerName from data if provided, otherwise use fromLoyaltyId or peerDeviceId
      callerName = data.callerName || data.fromLoyaltyId || data.peerDeviceId || 'Incoming call';
      onCallStateChange?.(currentCallState, callerName);
      
      // Play incoming call sound (browser notification)
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Incoming Call', {
          body: `Call from ${callerName}`,
          icon: '/icon.png',
        });
      }
    } else if (state === 'answered') {
      // Call was answered (either incoming or outgoing)
      console.log('📞 Call answered - updating state for call:', callId, 'direction:', direction);
      
      // Only update if this is for the active call
      if (activeCallUUID === callId || !activeCallUUID) {
        // If no active call UUID, set it (handles edge cases)
        if (!activeCallUUID) {
          activeCallUUID = callId;
        }
        
        currentCallState = 'answered';
        
        // Start timer if not already started
        if (!activeCallStartedAt) {
          activeCallStartedAt = Date.now();
          console.log('📞 Started call timer at:', activeCallStartedAt);
        }
        
        // Update UI callbacks
        onCallStateChange?.(currentCallState, callerName);
        onCallActiveChange?.(true, activeCallStartedAt);
        
        console.log('✅ Call state updated to answered for call:', callId);
      } else {
        console.warn('⚠️ Ignoring answered state - not for active call', {
          activeCallUUID,
          receivedCallId: callId,
        });
      }
    } else if (state === 'ended' || state === 'rejected') {
      currentCallState = state === 'ended' ? 'ended' : 'rejected';
      onCallStateChange?.(currentCallState, callerName);
      endVoiceCall();
    }
  });

  // Listen for WebRTC offer (incoming call)
  socket.on('offer', async (data: { callId: string; offer: RTCSessionDescriptionInit; fromDeviceId?: string; fromLoyaltyId?: string; callerName?: string }) => {
    console.log('📞 Received offer via socket:', data.callId, 'from:', data.fromLoyaltyId || data.fromDeviceId);
    if (!pc || activeCallUUID !== data.callId) {
      // This is an incoming call
      activeCallUUID = data.callId;
      currentCallState = 'ringing';
      // Use callerName from data if provided, otherwise use fromLoyaltyId or fromDeviceId
      callerName = data.callerName || data.fromLoyaltyId || data.fromDeviceId || 'Incoming call';
      onCallStateChange?.(currentCallState, callerName);
      
      try {
        console.log('Setting up incoming call - creating peer connection and setting remote offer...');
        await startVoiceCall(data.callId, data.offer, 'callee');
        console.log('✅ Incoming call setup complete, waiting for user to answer');
      } catch (e) {
        console.error('❌ Failed to handle incoming call offer:', e);
        currentCallState = 'idle';
        activeCallUUID = null;
        onCallStateChange?.(currentCallState, null);
      }
    } else {
      console.log('Offer received but peer connection already exists for this call');
    }
  });

  // Listen for WebRTC answer (outgoing call answered)
  // NOTE: This is a global listener that handles answers for outgoing calls
  // The waitForAnswer() function also sets up a temporary listener, but this one
  // ensures the answer is processed even if waitForAnswer hasn't set up yet
  socket.on('answer', async (data: { callId: string; answer: RTCSessionDescriptionInit; fromDeviceId: string }) => {
    console.log('📞 Global socket answer handler: Received answer via socket:', {
      callId: data.callId,
      fromDeviceId: data.fromDeviceId,
      hasAnswer: !!data.answer,
      hasSdp: !!(data.answer && data.answer.sdp),
      sdpLength: data.answer?.sdp?.length || 0,
      activeCallUUID,
      hasPc: !!pc,
      currentCallState,
    });
    
    // Process if this is for the active call (regardless of current state)
    // This handles answers for outgoing calls initiated from web
    if (pc && activeCallUUID === data.callId) {
      // Check signaling state to determine if we should process
      const signalingState = pc.signalingState;
      // Check if answer was already processed (stable means answer is set, have-remote-pranswer is provisional answer)
      const answerAlreadySet = signalingState === 'stable' || signalingState === 'have-remote-pranswer';
      const shouldProcess = (currentCallState === 'calling' || currentCallState === 'ringing') ||
                           (currentCallState === 'answered' && !answerAlreadySet);
      
      if (!shouldProcess) {
        console.log('📞 Global answer handler: Answer already processed or wrong state', {
          currentCallState,
          signalingState,
        });
        return;
      }
      
      console.log('📞 Global answer handler: Processing answer...', {
        currentCallState,
        signalingState,
      });
      try {
        // Check signaling state before setting remote description
        const signalingState = pc.signalingState;
        console.log('📞 Global answer handler: Current signaling state:', signalingState);
        console.log('📞 Answer SDP length:', data.answer.sdp?.length || 0);
        console.log('📞 Answer type:', data.answer.type);
        
        // Only set remote description if we're in the correct state
        if (signalingState === 'have-local-offer') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('✅ Global answer handler: Applied remote answer - WebRTC connection should establish now');
            console.log('   New signaling state:', pc.signalingState);
            console.log('   ICE connection state:', pc.iceConnectionState);
            
            // CRITICAL: Process any queued ICE candidates now that remote description is set
            await processQueuedIceCandidates(data.callId);
            console.log('✅ Processed queued ICE candidates');
            
            currentCallState = 'answered';
            activeCallStartedAt = Date.now();
            onCallStateChange?.(currentCallState, callerName);
            onCallActiveChange?.(true, activeCallStartedAt);
            console.log('✅ Call state updated to answered');
          } catch (setError: any) {
            console.error('❌ Failed to set remote description:', setError);
            const errorMsg = setError?.message || String(setError);
            // If it's a "wrong state" error, the answer might already be set
            if (errorMsg.includes('wrong state') || errorMsg.includes('stable') || errorMsg.includes('Called in wrong state')) {
              console.log('⚠️ Remote description might already be set, checking state...');
              if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-pranswer') {
                console.log('✅ Remote description already set, updating state');
                await processQueuedIceCandidates(data.callId);
                currentCallState = 'answered';
                if (!activeCallStartedAt) {
                  activeCallStartedAt = Date.now();
                }
                onCallStateChange?.(currentCallState, callerName);
                onCallActiveChange?.(true, activeCallStartedAt);
              }
            } else {
              throw setError; // Re-throw if it's a different error
            }
          }
        } else if (signalingState === 'stable' || signalingState === 'have-remote-pranswer') {
          // Answer was already set - this is fine, just update state
          console.log('⚠️ Global answer handler: Answer already set (state is stable/have-remote-pranswer), updating call state');
          
          // Still process queued candidates in case they arrived before
          await processQueuedIceCandidates(data.callId);
          
          currentCallState = 'answered';
          if (!activeCallStartedAt) {
            activeCallStartedAt = Date.now();
          }
          onCallStateChange?.(currentCallState, callerName);
          onCallActiveChange?.(true, activeCallStartedAt);
        } else {
          console.warn('⚠️ Global answer handler: Cannot set remote answer - wrong signaling state:', signalingState);
          // Try to set it anyway and process queued candidates
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('✅ Global answer handler: Successfully set remote answer despite wrong state');
            await processQueuedIceCandidates(data.callId);
            
            currentCallState = 'answered';
            if (!activeCallStartedAt) {
              activeCallStartedAt = Date.now();
            }
            onCallStateChange?.(currentCallState, callerName);
            onCallActiveChange?.(true, activeCallStartedAt);
          } catch (retryError) {
            console.warn('⚠️ Global answer handler: Failed to set remote answer on retry:', retryError);
          }
        }
      } catch (e: any) {
        const errorMsg = e?.message || String(e);
        // Check if it's a "wrong state" error - if so, it's likely already set
        if (errorMsg.includes('wrong state') || errorMsg.includes('stable') || errorMsg.includes('Called in wrong state')) {
          console.log('Global answer handler: Remote description already set (wrong state error detected), updating call state');
          currentCallState = 'answered';
          if (!activeCallStartedAt) {
            activeCallStartedAt = Date.now();
          }
          onCallStateChange?.(currentCallState, callerName);
          onCallActiveChange?.(true, activeCallStartedAt);
        } else {
          console.error('Global answer handler: Failed to set remote answer:', e);
        }
      }
    } else {
      console.log('📞 Global answer handler: Ignoring answer - not for active outgoing call', {
        hasPc: !!pc,
        activeCallUUID,
        receivedCallId: data.callId,
        currentCallState,
      });
    }
  });

  // Listen for ICE candidates
  socket.on('ice-candidate', async (data: { callId: string; candidate: RTCIceCandidateInit; fromDeviceId: string }) => {
    console.log('📞 Received ICE candidate via socket:', data.callId, 'from device:', data.fromDeviceId);
    
    // Handle null candidate (gathering complete signal)
    if (!data.candidate) {
      console.log('📞 ICE candidate gathering complete from peer');
      return;
    }
    
    if (pc && activeCallUUID === data.callId) {
      // Check if remote description is set - if not, queue the candidate
      if (!pc.remoteDescription) {
        console.log('⚠️ Remote description not set yet, queueing ICE candidate (will process after answer is set)');
        queuedIceCandidates.push(data);
        return;
      }
      
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('✅ Added ICE candidate from peer');
      } catch (e: any) {
        const errorMsg = e?.message || String(e);
        // Don't log errors for invalid candidates or wrong state (candidate might already be added)
        // Also ignore "remote description was null" errors as we now queue candidates
        if (!errorMsg.includes('Invalid candidate') && 
            !errorMsg.includes('InvalidStateError') && 
            !errorMsg.includes('remote description was null')) {
          console.error('❌ Failed to add ICE candidate:', errorMsg);
        } else {
          // These are expected errors - candidate might already be added or state is wrong
          console.log('⚠️ ICE candidate error (expected, will be handled):', errorMsg);
        }
      }
    } else {
      console.warn('⚠️ Received ICE candidate but peer connection or call UUID mismatch:', {
        hasPc: !!pc,
        activeCallUUID,
        receivedCallId: data.callId,
      });
    }
  });
}

// Initialize WebRTC service
// Initialize WebRTC with loyalty_id (preferred method)
export function initWebRTCWithLoyaltyId(loyaltyId: string) {
  if (!loyaltyId) {
    throw new Error('loyaltyId is required for WebRTC initialization');
  }

  if (isVoipInitialized && currentLoyaltyId === loyaltyId) {
    console.log('WebRTC already initialized for loyalty_id:', loyaltyId);
    return;
  }

  console.log('Initializing WebRTC with loyaltyId:', loyaltyId);
  currentLoyaltyId = loyaltyId;
  // Generate a device ID for this web session
  currentDeviceId = generateUUID();
  isVoipInitialized = true;

  console.log('WebRTC state:', {
    currentLoyaltyId,
    currentDeviceId,
    isVoipInitialized,
  });

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Register device with backend using loyalty_id
  registerDevice(currentDeviceId, loyaltyId);

  // Connect socket
  ensureSocketConnected();
  
  console.log('WebRTC initialization complete');
}

// Initialize WebRTC with userId (backward compatibility)
export function initWebRTC(userId: 'user1' | 'user2') {
  // For backward compatibility, treat user1/user2 as loyalty_id
  initWebRTCWithLoyaltyId(userId);
}

// Register device with backend
async function registerDevice(deviceId: string, loyaltyId: string) {
  try {
    // Generate a fake voipToken for web (not used for push, but required by backend)
    const voipToken = `web-${deviceId}`;
    
    await fetch(`${BASE_URL}/api/register-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId,
        loyaltyId,
        voipToken, // Web doesn't need real VoIP token, but backend expects it
        platform: 'web',
      }),
    });
    console.log('Device registered on backend with loyalty_id:', loyaltyId);
  } catch (e) {
    console.warn('Failed to register device on backend', e);
  }
}

// Start WebRTC voice call
async function startVoiceCall(
  callUUID: string,
  remoteOffer: RTCSessionDescriptionInit | null,
  role: 'caller' | 'callee'
) {
  // Clean up any existing call
  if (pc) {
    endVoiceCall();
  }

  // Get user media (microphone)
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    console.log('Got local audio stream');
  } catch (e) {
    console.error('Failed to get user media:', e);
    throw new Error('Microphone access denied');
  }

  // Create peer connection with comprehensive STUN/TURN servers for maximum stability

    const peer = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:109.205.58.195:3478' },
            {
                urls: [
                    'turn:109.205.58.195:3478?transport=udp',
                    //'turn:109.205.58.195:3478?transport=tcp',
                ],
                username: 'turnuser',
                credential: 'MyS3cretTurnPass!2025',
            },
        ],
        iceCandidatePoolSize: 10,
    });


  //   const peer = new RTCPeerConnection({
  //   iceServers: [
  //     // Public STUN servers (multiple for redundancy and reliability)
  //     { urls: 'stun:stun.l.google.com:19302' },
  //     { urls: 'stun:stun1.l.google.com:19302' },
  //     { urls: 'stun:stun2.l.google.com:19302' },
  //     { urls: 'stun:stun3.l.google.com:19302' },
  //     { urls: 'stun:stun4.l.google.com:19302' },
  //     { urls: 'stun:stun.stunprotocol.org:3478' },
  //     { urls: 'stun:stun.voiparound.com' },
  //     { urls: 'stun:stun.voipbuster.com' },
  //     { urls: 'stun:stun.voipstunt.com' },
  //     { urls: 'stun:stun.voxgratia.org' },
  //     { urls: 'stun:stun.ekiga.net' },
  //     { urls: 'stun:stun.ideasip.com' },
  //     { urls: 'stun:stun.schlund.de' },
  //     { urls: 'stun:stun.voipgate.com' },
  //     { urls: ['stun:fr-turn3.xirsys.com'] },
  //     // TURN servers (Xirsys - for NAT traversal and relay when STUN fails)
  //     {
  //       username: '3S4jyxcSetE19BA7RnBF1KQg4G7nhkwoKiIkfNDHe9fKhz-SaS3XT3E1J2ADtD2OAAAAAGjDJ9lIYXlrOTU=',
  //       credential: '77c51804-8f48-11f0-9cf6-e25abca605ee',
  //       urls: [
  //         'turn:fr-turn3.xirsys.com:80?transport=udp',
  //         'turn:fr-turn3.xirsys.com:3478?transport=udp',
  //         'turn:fr-turn3.xirsys.com:80?transport=tcp',
  //         'turn:fr-turn3.xirsys.com:3478?transport=tcp',
  //         'turns:fr-turn3.xirsys.com:443?transport=tcp',
  //         'turns:fr-turn3.xirsys.com:5349?transport=tcp',
  //       ],
  //     },
  //   ],
  //   iceCandidatePoolSize: 10, // Pre-gather more candidates for faster connection
  // });

  pc = peer;

  // Add local stream tracks
  localStream.getTracks().forEach((track) => {
    pc?.addTrack(track, localStream!);
  });

  // Handle ICE candidates
  peer.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
    if (event.candidate && activeCallUUID) {
      sendIceCandidate(activeCallUUID, role === 'caller' ? 'caller' : 'callee', event.candidate);
    }
  };

  // Handle connection state changes
  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    console.log('Connection state changed:', state);
    if (state === 'connected') {
      console.log('✅ WebRTC connected!');
      // Update call state to answered when connection is established
      if (currentCallState === 'ringing' || currentCallState === 'calling') {
        currentCallState = 'answered';
        if (!activeCallStartedAt && activeCallUUID === callUUID) {
          activeCallStartedAt = Date.now();
        }
        onCallStateChange?.(currentCallState, callerName);
        onCallActiveChange?.(true, activeCallStartedAt);
      }
    } else if (state === 'failed') {
      console.error('❌ WebRTC connection failed!');
    } else if (state === 'disconnected') {
      console.warn('⚠️ WebRTC connection disconnected');
    }
  };
  
  // Handle ICE connection state changes
  peer.oniceconnectionstatechange = () => {
    const iceState = peer.iceConnectionState;
    console.log('ICE connection state changed:', iceState);
    if (iceState === 'connected' || iceState === 'completed') {
      console.log('✅ ICE connection established!');
    } else if (iceState === 'failed') {
      console.error('❌ ICE connection failed!');
    }
  };
  
  // Handle ICE gathering state
  peer.onicegatheringstatechange = () => {
    console.log('ICE gathering state:', peer.iceGatheringState);
  };
  
  // Handle signaling state changes
  peer.onsignalingstatechange = () => {
    console.log('Signaling state changed:', peer.signalingState);
  };

  // Handle remote stream
  peer.ontrack = (event: RTCTrackEvent) => {
    console.log('Received remote stream');
    remoteStream = event.streams[0];
    // Play remote audio
    const audio = new Audio();
    audio.srcObject = remoteStream;
    audio.play().catch((e) => console.error('Failed to play remote audio:', e));
  };

  // If we have a remote offer (incoming call), set it but DON'T create answer yet
  // User must click "Answer" button to create and send the answer
  if (remoteOffer) {
    try {
      await peer.setRemoteDescription(new RTCSessionDescription(remoteOffer));
      console.log('✅ Remote offer set, waiting for user to answer');
      
      // Process any queued ICE candidates that arrived before the offer
      await processQueuedIceCandidates(callUUID);
    } catch (e) {
      console.error('Failed to handle remote offer:', e);
      throw e;
    }
  }

  activeCallUUID = callUUID;
}

// Start outgoing call by loyalty_id (preferred method)
export async function startOutgoingVoiceCallByLoyaltyId(targetLoyaltyId: string, displayName: string) {
  console.log('startOutgoingVoiceCallByLoyaltyId called:', {
    targetLoyaltyId,
    displayName,
    isVoipInitialized,
    currentDeviceId,
    currentLoyaltyId,
  });
  
  if (!isVoipInitialized || !currentDeviceId || !currentLoyaltyId) {
    console.error('WebRTC not initialized:', {
      isVoipInitialized,
      currentDeviceId,
      currentLoyaltyId,
    });
    throw new Error('WebRTC not initialized. Call initWebRTCWithLoyaltyId first.');
  }

  const callId = generateUUID();
  activeCallUUID = callId;
  currentCallState = 'calling';
  callerName = displayName;
  onCallStateChange?.(currentCallState, callerName);

  ensureSocketConnected();

  // Start WebRTC call as caller
  await startVoiceCall(callId, null, 'caller');

  // Create offer
  if (!pc) {
    throw new Error('Peer connection not created');
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.log('✅ Web caller: Created and set local offer, signaling state:', pc.signalingState);

  // Send offer to backend using loyalty_id
  try {
    const resp = await fetch(`${BASE_URL}/api/calls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromDeviceId: currentDeviceId,
        fromLoyaltyId: currentLoyaltyId,
        toLoyaltyId: targetLoyaltyId,
        callerName: displayName,
        callId,
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
      }),
    });

    if (!resp.ok) {
      throw new Error(`Failed to start call: ${resp.status}`);
    }

    console.log('✅ Web caller: Call initiated, waiting for answer from mobile...');
    console.log('   Offer sent to backend, callId:', callId);
    console.log('   Current signaling state:', pc.signalingState);
    console.log('   Waiting for answer via socket or HTTP polling...');
    
    await waitForAnswer(callId);
    console.log('✅ Web caller: Answer received and processed successfully');
  } catch (e) {
    console.error('Failed to start call:', e);
    endVoiceCall();
    throw e;
  }
}

// Start outgoing call by deviceId (backward compatibility)
export async function startOutgoingVoiceCall(targetDeviceId: string, displayName: string) {
  if (!isVoipInitialized || !currentDeviceId) {
    throw new Error('WebRTC not initialized. Call initWebRTC first.');
  }

  const callId = generateUUID();
  activeCallUUID = callId;
  currentCallState = 'calling';
  callerName = displayName;
  onCallStateChange?.(currentCallState, callerName);

  ensureSocketConnected();

  // Start WebRTC call as caller
  await startVoiceCall(callId, null, 'caller');

  // Create offer
  if (!pc) {
    throw new Error('Peer connection not created');
  }

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Send offer to backend
  try {
    const resp = await fetch(`${BASE_URL}/api/calls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromDeviceId: currentDeviceId,
        toDeviceId: targetDeviceId,
        callId,
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
      }),
    });

    if (!resp.ok) {
      throw new Error(`Failed to start call: ${resp.status}`);
    }

    console.log('Call initiated, waiting for answer...');
    await waitForAnswer(callId);
  } catch (e) {
    console.error('Failed to start call:', e);
    endVoiceCall();
    throw e;
  }
}

// Wait for answer from callee
async function waitForAnswer(callId: string): Promise<void> {
  const currentPc = pc;
  if (!currentPc) {
    throw new Error('No peer connection');
  }

  // Wait for answer via socket (primary) or HTTP polling (fallback)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket?.off('answer', onAnswer);
      reject(new Error('Answer timeout'));
    }, 30000); // 30 second timeout

    const onAnswer = async (data: { callId: string; answer: RTCSessionDescriptionInit }) => {
      if (data.callId === callId && currentPc === pc) {
        clearTimeout(timeout);
        socket?.off('answer', onAnswer);
        
        // Check if answer was already processed by global handler
        if (currentPc.signalingState === 'stable' || currentPc.signalingState === 'have-remote-pranswer') {
          console.log('waitForAnswer: Answer already processed by global handler, resolving');
          if (currentCallState !== 'answered') {
            currentCallState = 'answered';
            if (!activeCallStartedAt) {
              activeCallStartedAt = Date.now();
            }
            onCallStateChange?.(currentCallState, callerName);
            onCallActiveChange?.(true, activeCallStartedAt);
          }
          resolve();
          return;
        }
        
        try {
          // Check signaling state before setting remote description
          const signalingState = currentPc.signalingState;
          console.log('waitForAnswer: Current signaling state before setting answer:', signalingState);
          
          // Only set remote description if we're in the correct state
          // Note: We already checked for 'stable' and 'have-remote-pranswer' above, so we won't reach here if answer is already set
          if (signalingState === 'have-local-offer') {
            await currentPc.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('✅ waitForAnswer: Applied remote answer');
            
            // CRITICAL: Process any queued ICE candidates now that remote description is set
            await processQueuedIceCandidates(callId);
            
            currentCallState = 'answered';
            activeCallStartedAt = Date.now();
            onCallStateChange?.(currentCallState, callerName);
            onCallActiveChange?.(true, activeCallStartedAt);
            resolve();
          } else {
            // If we reach here, the state is not 'have-local-offer' and not 'stable'/'have-remote-pranswer' (already handled above)
            console.warn('waitForAnswer: Cannot set remote answer - wrong signaling state:', signalingState);
            reject(new Error(`Wrong signaling state: ${signalingState}`));
          }
        } catch (e: any) {
          const errorMsg = e?.message || String(e);
          // Check if it's a "wrong state" error - if so, it's likely already set
          if (errorMsg.includes('wrong state') || errorMsg.includes('stable') || errorMsg.includes('Called in wrong state')) {
            console.log('waitForAnswer: Remote description already set (wrong state error detected), updating call state');
            currentCallState = 'answered';
            if (!activeCallStartedAt) {
              activeCallStartedAt = Date.now();
            }
            onCallStateChange?.(currentCallState, callerName);
            onCallActiveChange?.(true, activeCallStartedAt);
            resolve(); // Resolve instead of reject since answer is already set
          } else {
            reject(e);
          }
        }
      }
    };

    socket?.on('answer', onAnswer);

    // Also poll HTTP as fallback
    waitForAnswerHTTP(callId).catch(() => {
      // Ignore HTTP errors if socket works
    });
  });
}

// HTTP polling fallback for answer
async function waitForAnswerHTTP(callId: string): Promise<void> {
  const currentPc = pc;
  if (!currentPc) {
    return;
  }

  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (currentPc !== pc || !activeCallUUID) {
      return; // Call ended
    }

    try {
      const resp = await fetch(`${BASE_URL}/api/calls/${callId}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.answer && data.answer.sdp && currentPc === pc) {
        // Check signaling state before setting remote description
        const signalingState = currentPc.signalingState;
        console.log('waitForAnswerHTTP: Current signaling state before setting answer:', signalingState);
        
        // Check if answer was already processed (extract before type narrowing)
        const answerAlreadySet = signalingState === 'stable' || signalingState === 'have-remote-pranswer';
        
        // Only set remote description if we're in the correct state
        if (signalingState === 'have-local-offer') {
          try {
            await currentPc.setRemoteDescription(new RTCSessionDescription(data.answer));
            console.log('✅ Applied remote answer (HTTP)');
            
            // Process any queued ICE candidates now that remote description is set
            await processQueuedIceCandidates(callId);
            
            currentCallState = 'answered';
            activeCallStartedAt = Date.now();
            onCallStateChange?.(currentCallState, callerName);
            onCallActiveChange?.(true, activeCallStartedAt);
            return;
          } catch (setError: any) {
            const errorMsg = setError?.message || String(setError);
            // Check if it's a "wrong state" error - if so, it's likely already set
            if (errorMsg.includes('wrong state') || errorMsg.includes('stable') || errorMsg.includes('Called in wrong state')) {
              console.log('waitForAnswerHTTP: Remote description already set (wrong state error detected), updating call state');
              currentCallState = 'answered';
              if (!activeCallStartedAt) {
                activeCallStartedAt = Date.now();
              }
              onCallStateChange?.(currentCallState, callerName);
              onCallActiveChange?.(true, activeCallStartedAt);
              return;
            } else {
              throw setError; // Re-throw if it's a different error
            }
          }
        } else if (answerAlreadySet) {
          // Answer was already set - this is fine, just update state
          console.log('waitForAnswerHTTP: Answer already set (state is stable/have-remote-pranswer), updating call state');
          currentCallState = 'answered';
          if (!activeCallStartedAt) {
            activeCallStartedAt = Date.now();
          }
          onCallStateChange?.(currentCallState, callerName);
          onCallActiveChange?.(true, activeCallStartedAt);
          return;
        } else {
          console.warn('waitForAnswerHTTP: Cannot set remote answer - wrong signaling state:', signalingState);
          // Continue polling if state is not ready yet
        }
      }
    } catch (e) {
      console.warn('Error polling answer:', e);
    }
  }
}

// Send answer to backend
async function sendAnswerToBackend(callId: string, answer: RTCSessionDescription | RTCSessionDescriptionInit) {
  if (!currentDeviceId) {
    throw new Error('Device not registered');
  }

  console.log('sendAnswerToBackend: Sending answer for call', callId, 'deviceId:', currentDeviceId);
  console.log('Answer type:', answer.type, 'SDP length:', answer.sdp?.length);

  try {
    // Get call info to find caller device ID for socket forwarding
    let callerDeviceId: string | null = null;
    try {
      const callResp = await fetch(`${BASE_URL}/api/calls/${callId}`);
      if (callResp.ok) {
        const callData = await callResp.json();
        callerDeviceId = callData.fromDeviceId || null;
        console.log('Call info retrieved, callerDeviceId:', callerDeviceId);
      }
    } catch (e) {
      console.warn('Could not fetch call info for socket forwarding:', e);
    }

    // Send via HTTP to backend
    const resp = await fetch(`${BASE_URL}/api/calls/${callId}/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        answer: {
          type: answer.type,
          sdp: answer.sdp,
        },
        deviceId: currentDeviceId,
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('Backend rejected answer:', resp.status, errorText);
      throw new Error(`Failed to send answer: ${resp.status} - ${errorText}`);
    }

    console.log('✅ Answer sent to backend via HTTP successfully');

    // Also emit via socket for faster delivery (if socket is connected and we have callerDeviceId)
    ensureSocketConnected();
    if (socket && socket.connected && callerDeviceId) {
      try {
        socket.emit('answer', {
          callId,
          answer: {
            type: answer.type,
            sdp: answer.sdp,
          },
          fromDeviceId: currentDeviceId,
          toDeviceId: callerDeviceId, // Include toDeviceId for backend routing
        });
        console.log('✅ Answer also sent via socket for faster delivery');
      } catch (socketError) {
        console.warn('Failed to emit answer via socket (HTTP was successful):', socketError);
        // Don't throw - HTTP was successful
      }
    } else {
      console.warn('Socket not connected, answer sent via HTTP only');
    }

    console.log('✅ Answer sent to backend successfully (HTTP + socket if available)');
  } catch (e) {
    console.error('❌ Failed to send answer to backend:', e);
    throw e;
  }
}

// Send ICE candidate
async function sendIceCandidate(callId: string, from: 'caller' | 'callee', candidate: RTCIceCandidate) {
  if (!currentDeviceId) {
    return;
  }

  try {
    // Get call info to find peer device ID for socket forwarding
    // Note: This might fail if call hasn't been created yet, which is OK
    let peerDeviceId: string | null = null;
    try {
      const callResp = await fetch(`${BASE_URL}/api/calls/${callId}`);
      if (callResp.ok) {
        const callData = await callResp.json();
        peerDeviceId = from === 'caller' ? callData.toDeviceId : callData.fromDeviceId;
      } else if (callResp.status === 404) {
        // Call not found yet - this is OK, it might be created shortly
        // Don't log as error, just skip socket forwarding
        console.log('📞 Call not found yet for ICE candidate forwarding (will use HTTP only)');
      }
    } catch (e) {
      // Network error - not critical, HTTP will still work
      // Don't log as warning to avoid noise
    }

    // Send via HTTP (backend will forward via socket if peer is connected)
    await fetch(`${BASE_URL}/api/calls/${callId}/candidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        candidate: candidate.toJSON(),
        deviceId: currentDeviceId,
      }),
    });

    // Also emit via socket for faster delivery (if we have peer deviceId)
    if (socket && socket.connected && peerDeviceId) {
      try {
        socket.emit('ice-candidate', {
          callId,
          candidate: candidate.toJSON(),
          fromDeviceId: currentDeviceId,
          toDeviceId: peerDeviceId, // Include toDeviceId for backend routing
        });
        console.log('✅ ICE candidate also sent via socket to', peerDeviceId);
      } catch (socketError) {
        console.warn('Failed to emit ICE candidate via socket (HTTP was successful):', socketError);
        // Don't throw - HTTP was successful
      }
    }
  } catch (e) {
    console.warn('Failed to send ICE candidate:', e);
  }
}

// Answer incoming call
export async function answerCall(callUUID: string) {
  console.log('answerCall called for callUUID:', callUUID);
  console.log('Current state:', {
    hasPc: !!pc,
    activeCallUUID,
    pcSignalingState: pc?.signalingState,
    hasRemoteDesc: !!pc?.remoteDescription,
    hasLocalDesc: !!pc?.localDescription,
  });

  try {
    // Check if peer connection exists and matches
    if (!pc || activeCallUUID !== callUUID) {
      console.warn('Cannot answer: peer connection not ready for call', callUUID, 'activeCallUUID:', activeCallUUID);
      // Try to fetch offer if peer connection doesn't exist
      const resp = await fetch(`${BASE_URL}/api/calls/${callUUID}`);
      if (!resp.ok) {
        throw new Error(`Failed to fetch call offer: ${resp.status}`);
      }
      const data = await resp.json();
      if (!data.offer || !data.offer.sdp) {
        throw new Error('No remote offer found for this call');
      }

      activeCallUUID = callUUID;
      currentCallState = 'ringing';
      onCallStateChange?.(currentCallState, callerName);

      // Set up peer connection with remote offer (but don't create answer yet)
      await startVoiceCall(callUUID, data.offer, 'callee');
      console.log('WebRTC peer connection set up for incoming call', callUUID);
      
      // Wait a bit for peer connection to be ready
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Create and send answer if peer connection exists and answer not created yet
    if (!pc) {
      throw new Error('Peer connection not ready after setup');
    }

    // Check signaling state
    const signalingState = pc.signalingState;
    console.log('Signaling state before creating answer:', signalingState);

    // Ensure we have remote description set
    if (!pc.remoteDescription) {
      console.warn('No remote description set, fetching offer...');
      const resp = await fetch(`${BASE_URL}/api/calls/${callUUID}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data.offer && data.offer.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          console.log('✅ Remote description set from backend');
          
          // Process any queued ICE candidates now that remote description is set
          await processQueuedIceCandidates(callUUID);
        }
      }
    }

    // Create answer if not already created
    if (!pc.localDescription) {
      if (!pc.remoteDescription) {
        throw new Error('Remote description not set - cannot create answer');
      }

      console.log('Creating answer...');
      // Create answer with proper options
      const answer = await pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: false,
      });
      
      console.log('Answer created, setting local description...');
      await pc.setLocalDescription(answer);
      console.log('Local description set, answer SDP:', answer.sdp?.substring(0, 100) + '...');
      
      // Send answer to backend
      console.log('Sending answer to backend...');
      await sendAnswerToBackend(callUUID, answer);
      console.log('✅ Answer created and sent to backend for call:', callUUID);
    } else {
      console.log('Answer already created for call:', callUUID, 'SDP:', pc.localDescription.sdp?.substring(0, 100) + '...');
      // Answer already created, but make sure it's sent
      if (pc.localDescription) {
        await sendAnswerToBackend(callUUID, pc.localDescription as RTCSessionDescription);
        console.log('Resent existing answer to backend');
      }
    }

    // Update call state to answered
    currentCallState = 'answered';
    onCallStateChange?.(currentCallState, callerName);

    // Start timer
    activeCallStartedAt = Date.now();
    onCallActiveChange?.(true, activeCallStartedAt);
    
    console.log('✅ Call answered successfully');
  } catch (e: any) {
    console.error('❌ Failed to answer call:', e);
    console.error('Error details:', {
      message: e?.message,
      stack: e?.stack,
      pcState: pc ? {
        signalingState: pc.signalingState,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        hasRemoteDesc: !!pc.remoteDescription,
        hasLocalDesc: !!pc.localDescription,
      } : null,
    });
    currentCallState = 'idle';
    onCallStateChange?.(currentCallState, null);
    throw e;
  }
}

// Reject call
export async function rejectCall(callUUID: string) {
  console.log('Rejecting call:', callUUID);
  
  // Update call state to rejected
  currentCallState = 'rejected';
  onCallStateChange?.(currentCallState, callerName);

  // Notify backend that call was rejected
  if (currentDeviceId) {
    try {
      await fetch(`${BASE_URL}/api/calls/${callUUID}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId: currentDeviceId,
          reason: 'rejected',
        }),
      });
      console.log('Backend notified of call rejection');
    } catch (e) {
      console.warn('Failed to notify backend of rejection:', e);
    }
  }

  // End the voice call and cleanup
  endVoiceCall();
  
  // Reset state after a short delay to allow UI to show rejected state
  setTimeout(() => {
    currentCallState = 'idle';
    callerName = null;
    activeCallUUID = null;
    onCallStateChange?.(currentCallState, null);
  }, 2000);
}

// End call
function endVoiceCall() {
  // Clear queued ICE candidates when call ends
  if (queuedIceCandidates.length > 0) {
    console.log('Clearing', queuedIceCandidates.length, 'queued ICE candidates');
    queuedIceCandidates = [];
  }
  
  if (pc) {
    pc.close();
    pc = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
    remoteStream = null;
  }

  if (activeCallUUID && currentDeviceId) {
    fetch(`${BASE_URL}/api/calls/${activeCallUUID}/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deviceId: currentDeviceId,
      }),
    }).catch((e) => console.warn('Failed to notify backend of call end:', e));
  }

  activeCallUUID = null;
  activeCallStartedAt = null;
  currentCallState = 'idle';
  callerName = null;
  onCallStateChange?.(currentCallState, null);
  onCallActiveChange?.(false, null);
}

export function endCall() {
  endVoiceCall();
}

// Toggle mute
export function toggleMute() {
  if (localStream) {
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted;
    });
  }
  return isMuted;
}

// Toggle speaker (for web, this is handled by browser/OS)
export function toggleSpeaker() {
  isSpeakerEnabled = !isSpeakerEnabled;
  // On web, speaker is controlled by OS/browser, but we can track state
  return isSpeakerEnabled;
}

// Get call state
export function getCallState(): {
  state: CallState;
  callerName: string | null;
  isMuted: boolean;
  isSpeakerEnabled: boolean;
  callUUID: string | null;
} {
  return {
    state: currentCallState,
    callerName,
    isMuted,
    isSpeakerEnabled,
    callUUID: activeCallUUID,
  };
}

// Get active call info
export function getActiveCallInfo(): {
  isActive: boolean;
  startedAt: number | null;
} {
  return {
    isActive: currentCallState === 'answered' && activeCallStartedAt !== null,
    startedAt: activeCallStartedAt,
  };
}

// Get current user ID (backward compatibility)
export function getCurrentUserId(): 'user1' | 'user2' | 'unknown' {
  return currentUserId;
}

// Get current loyalty ID
export function getCurrentLoyaltyId(): string | null {
  return currentLoyaltyId;
}

// Set call state change callback
export function setCallStateChangeCallback(callback: (state: CallState, name: string | null) => void) {
  onCallStateChange = callback;
}

// Set call active change callback
export function setCallActiveChangeCallback(callback: (isActive: boolean, startedAt: number | null) => void) {
  onCallActiveChange = callback;
}

// Server status types
export type ServerStatus = {
  url: string;
  type: 'stun' | 'turn';
  status: 'checking' | 'available' | 'unavailable' | 'error';
  latency?: number;
};

// Get all configured ICE servers
export function getIceServers(): RTCIceServer[] {
  return [
    // Public STUN servers
      { urls: 'stun:109.205.58.195:3478' },
      {
          urls: [
              'turn:109.205.58.195:3478?transport=udp',
              //'turn:109.205.58.195:3478?transport=tcp',
          ],
          username: 'turnuser',
          credential: 'MyS3cretTurnPass!2025',
      },

    // { urls: 'stun:stun.l.google.com:19302' },
    // { urls: 'stun:stun1.l.google.com:19302' },
    // { urls: 'stun:stun2.l.google.com:19302' },
    // { urls: 'stun:stun3.l.google.com:19302' },
    // { urls: 'stun:stun4.l.google.com:19302' },
    // { urls: 'stun:stun.stunprotocol.org:3478' },
    // { urls: 'stun:stun.voiparound.com' },
    // { urls: 'stun:stun.voipbuster.com' },
    // { urls: 'stun:stun.voipstunt.com' },
    // { urls: 'stun:stun.voxgratia.org' },
    // { urls: 'stun:stun.ekiga.net' },
    // { urls: 'stun:stun.ideasip.com' },
    // { urls: 'stun:stun.schlund.de' },
    // { urls: 'stun:stun.voipgate.com' },
    // { urls: ['stun:fr-turn3.xirsys.com'] },
    // TURN servers
    // {
    //   username: '3S4jyxcSetE19BA7RnBF1KQg4G7nhkwoKiIkfNDHe9fKhz-SaS3XT3E1J2ADtD2OAAAAAGjDJ9lIYXlrOTU=',
    //   credential: '77c51804-8f48-11f0-9cf6-e25abca605ee',
    //   urls: [
    //     'turn:fr-turn3.xirsys.com:80?transport=udp',
    //     'turn:fr-turn3.xirsys.com:3478?transport=udp',
    //     'turn:fr-turn3.xirsys.com:80?transport=tcp',
    //     'turn:fr-turn3.xirsys.com:3478?transport=tcp',
    //     'turns:fr-turn3.xirsys.com:443?transport=tcp',
    //     'turns:fr-turn3.xirsys.com:5349?transport=tcp',
    //   ],
    // },
  ];
}

// Check server status
export async function checkServerStatus(server: RTCIceServer): Promise<ServerStatus[]> {
  const results: ServerStatus[] = [];
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  
  for (const url of urls) {
    const isStun = url.startsWith('stun:');
    const isTurn = url.startsWith('turn:') || url.startsWith('turns:');
    const type = isStun ? 'stun' : 'turn';
    
    const status: ServerStatus = {
      url,
      type,
      status: 'checking',
    };
    results.push(status);
    
    try {
      const startTime = Date.now();
      const testPc = new RTCPeerConnection({
        iceServers: [{ ...server, urls: url }],
        iceCandidatePoolSize: 0,
      });
      
      // Create a data channel to trigger ICE gathering
      testPc.createDataChannel('test');
      
      const offer = await testPc.createOffer();
      await testPc.setLocalDescription(offer);
      
      // Wait for ICE gathering or timeout
      const checkStatus = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 3000); // 3 second timeout
        
        testPc.onicecandidate = (event) => {
          if (event.candidate === null) {
            // ICE gathering complete
            clearTimeout(timeout);
            resolve();
          }
        };
        
        testPc.onicegatheringstatechange = () => {
          if (testPc.iceGatheringState === 'complete') {
            clearTimeout(timeout);
            resolve();
          }
        };
      });
      
      await checkStatus;
      
      const latency = Date.now() - startTime;
      const hasCandidates = testPc.localDescription?.sdp.includes('candidate') || false;
      
      testPc.close();
      
      if (hasCandidates) {
        status.status = 'available';
        status.latency = latency;
      } else {
        status.status = 'unavailable';
      }
    } catch (error) {
      status.status = 'error';
      console.error(`Error checking server ${url}:`, error);
    }
  }
  
  return results;
}

// Check all servers status
export async function checkAllServersStatus(): Promise<ServerStatus[]> {
  const allStatuses: ServerStatus[] = [];
  const servers = getIceServers();
  
  for (const server of servers) {
    const statuses = await checkServerStatus(server);
    allStatuses.push(...statuses);
  }
  
  return allStatuses;
}

