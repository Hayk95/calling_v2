'use client';

import { useEffect, useState } from 'react';
import {
  getCallState,
  getActiveCallInfo,
  answerCall,
  rejectCall,
  endCall,
  toggleMute,
  toggleSpeaker,
} from '@/lib/webrtc-service';

interface CallModalProps {
  visible: boolean;
  onClose: () => void;
}

export default function CallModal({ visible, onClose }: CallModalProps) {
  const [callState, setCallState] = useState<'idle' | 'calling' | 'ringing' | 'answered' | 'ended' | 'rejected'>('idle');
  const [callInfo, setCallInfo] = useState<{
    state: typeof callState;
    callerName: string | null;
    isMuted: boolean;
    isSpeakerEnabled: boolean;
    callUUID: string | null;
  }>({
    state: 'idle',
    callerName: null,
    isMuted: false,
    isSpeakerEnabled: false,
    callUUID: null,
  });
  const [callSeconds, setCallSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);

  // Update state from service
  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      const state = getCallState();
      const activeInfo = getActiveCallInfo();
      setCallInfo(state);
      setCallState(state.state);
      setIsActive(activeInfo.isActive);
      if (activeInfo.isActive && activeInfo.startedAt) {
        const diffSec = Math.floor((Date.now() - activeInfo.startedAt) / 1000);
        setCallSeconds(diffSec);
      } else {
        setCallSeconds(0);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [visible]);

  const formatCallTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getStateText = () => {
    switch (callState) {
      case 'calling':
        return 'Вызов...';
      case 'ringing':
        return 'Входящий звонок';
      case 'answered':
        return 'Разговор';
      case 'ended':
        return 'Звонок завершен';
      case 'rejected':
        return 'Звонок отклонен';
      default:
        return '';
    }
  };

  const getDisplayLabel = () => {
    if (callState === 'ringing') {
      return 'Вам звонят';
    } else if (callState === 'calling') {
      return 'Вызываете';
    } else {
      return '';
    }
  };

  const handleMute = () => {
    toggleMute();
  };

  const handleSpeaker = () => {
    toggleSpeaker();
  };

  const handleEndCall = () => {
    endCall();
    onClose();
  };

  const handleRejectCall = () => {
    if (callInfo.callUUID) {
      rejectCall(callInfo.callUUID);
    }
    onClose();
  };

  const handleAnswerCall = () => {
    if (callInfo.callUUID) {
      answerCall(callInfo.callUUID);
    }
  };

  if (!visible) return null;

  const effectiveState = callState;
  const isRinging = effectiveState === 'ringing';
  const isCalling = effectiveState === 'calling';
  const isAnswered = effectiveState === 'answered';
  const callerInitial = ((callInfo.callerName || 'Неизвестный') as string)
    .charAt(0)
    .toUpperCase();

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: isRinging
          ? 'radial-gradient(circle at center, rgba(34,197,94,0.15), rgba(0,0,0,0.95))'
          : isAnswered
          ? 'radial-gradient(circle at center, rgba(15,23,42,0.98), rgba(0,0,0,0.98))'
          : 'radial-gradient(circle at center, rgba(248,113,22,0.12), rgba(0,0,0,0.95))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: 20,
        backdropFilter: 'blur(20px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 480,
          borderRadius: 32,
          padding: '40px 32px 36px',
          background: 'linear-gradient(145deg, rgba(15,23,42,0.98), rgba(2,6,23,0.97))',
          border: '1px solid rgba(55,65,81,0.8)',
          boxShadow: '0 32px 90px rgba(0,0,0,0.8), 0 0 0 1px rgba(15,23,42,0.9)',
          color: '#e5e7eb',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          position: 'relative',
        }}
      >
        {/* Minimize button - top right */}
        <button
          type="button"
          onClick={onClose}
          title="Свернуть"
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            width: 32,
            height: 32,
            borderRadius: 999,
            border: '1px solid rgba(55,65,81,0.9)',
            backgroundColor: 'rgba(15,23,42,0.95)',
            color: '#9ca3af',
            fontSize: 16,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(31,41,55,0.95)';
            e.currentTarget.style.color = '#e5e7eb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(15,23,42,0.95)';
            e.currentTarget.style.color = '#9ca3af';
          }}
        >
          ─
        </button>

        {/* Avatar with animation */}
        <div style={{ position: 'relative' }}>
          {/* Pulsing ring animation for incoming calls */}
          {isRinging && (
            <div
              style={{
                position: 'absolute',
                inset: -20,
                borderRadius: '50%',
                border: '2px solid rgba(34,197,94,0.4)',
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }}
            />
          )}
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              background: isRinging
                ? 'conic-gradient(from 180deg, #22c55e, #16a34a, #15803d, #22c55e)'
                : isAnswered
                ? 'conic-gradient(from 180deg, #FE732E, #f97316, #ea580c, #FE732E)'
                : 'conic-gradient(from 180deg, #FE732E, #f97316, #facc15, #22c55e, #0ea5e9, #4f46e5, #FE732E)',
              padding: 4,
              boxShadow: isRinging
                ? '0 0 40px rgba(34,197,94,0.5)'
                : '0 0 30px rgba(248,113,22,0.4)',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                backgroundColor: '#020617',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 48,
                fontWeight: 700,
                color: '#e5e7eb',
                border: '2px solid rgba(55,65,81,0.6)',
              }}
            >
              {callerInitial}
            </div>
          </div>
        </div>

        {/* Caller Info */}
        <div style={{ textAlign: 'center', width: '100%' }}>
          <div
            style={{
              fontSize: 14,
              textTransform: 'uppercase',
              letterSpacing: 1.2,
              color: '#9ca3af',
              marginBottom: 8,
              fontWeight: 600,
            }}
          >
            {getDisplayLabel() || 'Звонок'}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#f9fafb',
              marginBottom: 12,
              letterSpacing: 0.5,
            }}
          >
            {callInfo.callerName || 'Неизвестный'}
          </div>
          <div
            style={{
              fontSize: 13,
              padding: '6px 14px',
              borderRadius: 999,
              backgroundColor: isAnswered
                ? 'rgba(34,197,94,0.15)'
                : isRinging
                ? 'rgba(34,197,94,0.15)'
                : 'rgba(248,113,22,0.15)',
              border: `1px solid ${
                isAnswered
                  ? 'rgba(34,197,94,0.4)'
                  : isRinging
                  ? 'rgba(34,197,94,0.4)'
                  : 'rgba(248,113,22,0.4)'
              }`,
              color: isAnswered
                ? '#bbf7d0'
                : isRinging
                ? '#bbf7d0'
                : '#fed7aa',
              display: 'inline-block',
              fontWeight: 600,
            }}
          >
            {getStateText()}
          </div>
        </div>

        {/* Timer */}
        {isActive && (
          <div
            style={{
              fontFamily: 'SF Mono, ui-monospace, Menlo, Monaco, Consolas',
              fontSize: 36,
              fontWeight: 700,
              color: '#fbbf24',
              letterSpacing: 2,
              textShadow: '0 0 20px rgba(251,191,36,0.5)',
            }}
          >
            {formatCallTime(callSeconds)}
          </div>
        )}

        {/* Secondary Controls (Mute/Speaker) */}
        {(isAnswered || isCalling) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 20,
              width: '100%',
            }}
          >
            <button
              onClick={handleMute}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                backgroundColor: callInfo.isMuted
                  ? 'rgba(239,68,68,0.2)'
                  : 'rgba(31,41,55,0.95)',
                border: `2px solid ${
                  callInfo.isMuted
                    ? 'rgba(239,68,68,0.6)'
                    : 'rgba(55,65,81,0.9)'
                }`,
                color: callInfo.isMuted ? '#fca5a5' : '#e5e7eb',
                fontSize: 26,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                boxShadow: callInfo.isMuted
                  ? '0 8px 20px rgba(239,68,68,0.3)'
                  : '0 4px 12px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.1)';
                e.currentTarget.style.boxShadow = callInfo.isMuted
                  ? '0 12px 28px rgba(239,68,68,0.4)'
                  : '0 8px 20px rgba(0,0,0,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = callInfo.isMuted
                  ? '0 8px 20px rgba(239,68,68,0.3)'
                  : '0 4px 12px rgba(0,0,0,0.3)';
              }}
              title={callInfo.isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {callInfo.isMuted ? '🔇' : '🎤'}
            </button>

            <button
              onClick={handleSpeaker}
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                backgroundColor: callInfo.isSpeakerEnabled
                  ? 'rgba(56,189,248,0.2)'
                  : 'rgba(31,41,55,0.95)',
                border: `2px solid ${
                  callInfo.isSpeakerEnabled
                    ? 'rgba(56,189,248,0.6)'
                    : 'rgba(55,65,81,0.9)'
                }`,
                color: callInfo.isSpeakerEnabled ? '#93c5fd' : '#e5e7eb',
                fontSize: 26,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                boxShadow: callInfo.isSpeakerEnabled
                  ? '0 8px 20px rgba(56,189,248,0.3)'
                  : '0 4px 12px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.1)';
                e.currentTarget.style.boxShadow = callInfo.isSpeakerEnabled
                  ? '0 12px 28px rgba(56,189,248,0.4)'
                  : '0 8px 20px rgba(0,0,0,0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = callInfo.isSpeakerEnabled
                  ? '0 8px 20px rgba(56,189,248,0.3)'
                  : '0 4px 12px rgba(0,0,0,0.3)';
              }}
              title={callInfo.isSpeakerEnabled ? 'Выключить динамик' : 'Включить динамик'}
            >
              🔊
            </button>
          </div>
        )}

        {/* Main Action Buttons */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 24,
            width: '100%',
            marginTop: isAnswered || isCalling ? 8 : 0,
          }}
        >
          {/* Incoming Call: Reject & Answer */}
          {isRinging && (
            <>
              <button
                onClick={handleRejectCall}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background:
                    'linear-gradient(135deg, rgba(220,38,38,0.95), rgba(239,68,68,0.98))',
                  border: 'none',
                  color: '#fef2f2',
                  fontSize: 36,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 20px 50px rgba(220,38,38,0.6)',
                  transition: 'all 0.2s',
                  fontWeight: 300,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.1)';
                  e.currentTarget.style.boxShadow = '0 24px 60px rgba(220,38,38,0.7)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 20px 50px rgba(220,38,38,0.6)';
                }}
                title="Отклонить"
              >
                ✕
              </button>
              <button
                onClick={handleAnswerCall}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background:
                    'linear-gradient(135deg, rgba(22,163,74,0.95), rgba(34,197,94,0.98))',
                  border: 'none',
                  color: '#ecfdf3',
                  fontSize: 36,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 20px 50px rgba(22,163,74,0.6)',
                  transition: 'all 0.2s',
                  fontWeight: 300,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.1)';
                  e.currentTarget.style.boxShadow = '0 24px 60px rgba(22,163,74,0.7)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 20px 50px rgba(22,163,74,0.6)';
                }}
                title="Ответить"
              >
                ✓
              </button>
            </>
          )}

          {/* Active Call: End Call */}
          {(isAnswered || isCalling) && (
            <button
              onClick={handleEndCall}
              style={{
                width: 88,
                height: 88,
                borderRadius: '50%',
                background:
                  'linear-gradient(135deg, rgba(220,38,38,0.95), rgba(239,68,68,0.98))',
                border: 'none',
                color: '#fef2f2',
                fontSize: 40,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 24px 60px rgba(220,38,38,0.7)',
                transition: 'all 0.2s',
                fontWeight: 300,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.1)';
                e.currentTarget.style.boxShadow = '0 28px 70px rgba(220,38,38,0.8)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 24px 60px rgba(220,38,38,0.7)';
              }}
              title="Завершить звонок"
            >
              ✕
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
