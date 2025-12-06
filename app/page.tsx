'use client';

import { useEffect, useState } from 'react';
import {
    initWebRTCWithLoyaltyId,
    startOutgoingVoiceCallByLoyaltyId,
    getCurrentLoyaltyId,
    getActiveCallInfo,
    setCallStateChangeCallback,
    setCallActiveChangeCallback,
    checkAllServersStatus,
    type ServerStatus,
} from '@/lib/webrtc-service';
import { getAllUsers, getUserDisplayName, type User } from '@/lib/users-api';
import { getStoredUser, removeUser } from '@/lib/auth-api';
import { useRouter } from 'next/navigation';
import CallModal from '@/components/CallModal';

export default function Home() {
    const router = useRouter();
    const [currentLoyaltyId, setCurrentLoyaltyId] = useState<string>('');
    const [loggedInUser, setLoggedInUser] = useState<any>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(false);
    const [callSeconds, setCallSeconds] = useState(0);
    const [isCallActive, setIsCallActive] = useState(false);
    const [callModalVisible, setCallModalVisible] = useState(false);
    const [callState, setCallState] = useState<'idle' | 'calling' | 'ringing' | 'answered' | 'ended' | 'rejected'>('idle');
    const [callerName, setCallerName] = useState<string | null>(null);
    const [serverStatuses, setServerStatuses] = useState<ServerStatus[]>([]);
    const [checkingServers, setCheckingServers] = useState(false);
    const [showServerStatus, setShowServerStatus] = useState(false);

    // Load users from database
    const loadUsers = async () => {
        try {
            setLoading(true);
            const allUsers = await getAllUsers();
            setUsers(allUsers);
        } catch (error) {
            console.error('Failed to load users:', error);
            alert('Не удалось загрузить список пользователей');
        } finally {
            setLoading(false);
        }
    };

    // Initialize with logged-in user's loyalty_id
    useEffect(() => {
        const user = getStoredUser();
        if (user) {
            setLoggedInUser(user);
            // Support both camelCase and snake_case for loyaltyId
            const loyaltyId = user.loyaltyId || (user as any).loyalty_id;
            if (loyaltyId) {
                console.log('Initializing WebRTC with loyaltyId:', loyaltyId);
                setCurrentLoyaltyId(loyaltyId);
                try {
                    initWebRTCWithLoyaltyId(loyaltyId);
                    console.log('WebRTC initialized successfully');
                } catch (e) {
                    console.error('Failed to initialize WebRTC:', e);
                    alert('Ошибка инициализации WebRTC: ' + (e instanceof Error ? e.message : String(e)));
                }
            } else {
                console.error('User object does not have loyaltyId:', user);
                alert('Ошибка: у пользователя нет loyaltyId. Пожалуйста, войдите снова.');
            }
        } else {
            // Not logged in, redirect to login
            router.push('/login');
        }

        // Set up call state callbacks
        setCallStateChangeCallback((state, name) => {
            console.log('📞 Call state changed:', state, 'caller:', name);
            setCallState(state);
            setCallerName(name);
            // Show modal for any non-idle state (calling, ringing, answered, etc.)
            const shouldShow = state !== 'idle';
            setCallModalVisible(shouldShow);
            console.log('📞 Modal visibility set to:', shouldShow, 'for state:', state);
        });

        setCallActiveChangeCallback((isActive, startedAt) => {
            setIsCallActive(isActive);
        });

        // Load users on mount
        loadUsers();

        // Refresh users every 10 seconds
        const interval = setInterval(loadUsers, 10000);
        return () => clearInterval(interval);
    }, []);

    // Save loyalty_id when changed
    useEffect(() => {
        if (currentLoyaltyId) {
            localStorage.setItem('webLoyaltyId', currentLoyaltyId);
        }
    }, [currentLoyaltyId]);

    // Timer for active calls
    useEffect(() => {
        const interval = setInterval(() => {
            const info = getActiveCallInfo();
            if (info.isActive && info.startedAt) {
                setIsCallActive(true);
                const diffSec = Math.floor((Date.now() - info.startedAt) / 1000);
                setCallSeconds(diffSec);
            } else {
                setIsCallActive(false);
                setCallSeconds(0);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Auto-close modal after call ends
    useEffect(() => {
        if (callState === 'ended' || callState === 'rejected') {
            const timer = setTimeout(() => {
                setCallModalVisible(false);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [callState]);

    const formatCallTime = (totalSeconds: number) => {
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const handleLogout = () => {
        if (confirm('Вы уверены, что хотите выйти?')) {
            removeUser();
            router.push('/login');
        }
    };

    const checkServers = async () => {
        setCheckingServers(true);
        try {
            const statuses = await checkAllServersStatus();
            setServerStatuses(statuses);
            setShowServerStatus(true);
        } catch (error) {
            console.error('Failed to check servers:', error);
        } finally {
            setCheckingServers(false);
        }
    };

    const handleCallUser = async (user: User) => {
        // Check if WebRTC is initialized
        const storedUser = getStoredUser();
        if (!storedUser) {
            alert('Ошибка: пользователь не авторизован');
            router.push('/login');
            return;
        }

        // Get loyaltyId from stored user (support both camelCase and snake_case)
        const myLoyaltyId = storedUser.loyaltyId || (storedUser as any).loyalty_id;
        if (!myLoyaltyId) {
            alert('Ошибка: loyalty_id не установлен. Пожалуйста, войдите снова.');
            return;
        }

        // Ensure WebRTC is initialized
        if (!currentLoyaltyId) {
            console.log('WebRTC not initialized, initializing now with loyaltyId:', myLoyaltyId);
            try {
                initWebRTCWithLoyaltyId(myLoyaltyId);
                setCurrentLoyaltyId(myLoyaltyId);
                // Wait a bit for initialization to complete
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (e) {
                console.error('Failed to initialize WebRTC:', e);
                alert('Ошибка инициализации WebRTC: ' + (e instanceof Error ? e.message : String(e)));
                return;
            }
        }

        if (user.loyaltyId === myLoyaltyId) {
            alert('Вы не можете позвонить себе');
            return;
        }

        // Allow calling offline users if they have voipToken (can receive VoIP push)
        // If user is offline and has no voipToken, show error
        if (!user.online && !user.hasVoipToken) {
            alert('Пользователь не в сети и не может принимать звонки');
            return;
        }

        try {
            const displayName = getUserDisplayName(user);
            console.log('Calling user:', user.loyaltyId, 'online:', user.online, 'hasVoipToken:', user.hasVoipToken);
            await startOutgoingVoiceCallByLoyaltyId(user.loyaltyId, displayName);
        } catch (e: any) {
            console.error('Failed to start call', e);
            const errorMsg = e?.message || 'Unknown error';
            alert('Не удалось начать звонок: ' + errorMsg);

            // If error is about initialization, try to re-initialize
            if (errorMsg.includes('not initialized')) {
                console.log('Attempting to re-initialize WebRTC...');
                try {
                    initWebRTCWithLoyaltyId(myLoyaltyId);
                    setCurrentLoyaltyId(myLoyaltyId);
                } catch (initError) {
                    console.error('Re-initialization failed:', initError);
                }
            }
        }
    };

    return (
        <div
            style={{
                minHeight: '100vh',
                padding: '40px 20px',
                background: '#000000',
                display: 'flex',
                justifyContent: 'center',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            {/* Modern animated background with gradient animation */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                        'radial-gradient(ellipse at top, rgba(15,23,42,0.98) 0%, rgba(2,6,23,0.98) 50%, #000000 100%)',
                    zIndex: 0,
                    animation: 'background-shift 30s ease-in-out infinite',
                }}
            />

            {/* Animated gradient overlay */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                        'radial-gradient(ellipse 80% 50% at 50% 50%, rgba(254,115,46,0.1) 0%, transparent 50%)',
                    zIndex: 1,
                    animation: 'gradient-rotate 20s ease-in-out infinite',
                }}
            />

            {/* Animated gradient orbs with enhanced movement */}
            <div
                style={{
                    position: 'absolute',
                    width: '700px',
                    height: '700px',
                    borderRadius: '50%',
                    background:
                        'radial-gradient(circle, rgba(254,115,46,0.4) 0%, rgba(254,115,46,0.15) 40%, transparent 70%)',
                    top: '-350px',
                    left: '-250px',
                    pointerEvents: 'none',
                    filter: 'blur(80px)',
                    animation: 'orb-float-1 25s ease-in-out infinite',
                    zIndex: 2,
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    width: '600px',
                    height: '600px',
                    borderRadius: '50%',
                    background:
                        'radial-gradient(circle, rgba(34,197,94,0.35) 0%, rgba(34,197,94,0.12) 40%, transparent 70%)',
                    bottom: '-300px',
                    right: '-200px',
                    pointerEvents: 'none',
                    filter: 'blur(80px)',
                    animation: 'orb-float-2 30s ease-in-out infinite',
                    zIndex: 2,
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    width: '500px',
                    height: '500px',
                    borderRadius: '50%',
                    background:
                        'radial-gradient(circle, rgba(56,189,248,0.3) 0%, rgba(56,189,248,0.1) 40%, transparent 70%)',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                    filter: 'blur(70px)',
                    animation: 'orb-pulse 18s ease-in-out infinite',
                    zIndex: 2,
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    width: '450px',
                    height: '450px',
                    borderRadius: '50%',
                    background:
                        'radial-gradient(circle, rgba(139,92,246,0.3) 0%, rgba(139,92,246,0.1) 40%, transparent 70%)',
                    top: '20%',
                    right: '10%',
                    pointerEvents: 'none',
                    filter: 'blur(70px)',
                    animation: 'orb-float-3 22s ease-in-out infinite',
                    zIndex: 2,
                }}
            />

            {/* Additional floating orbs */}
            <div
                style={{
                    position: 'absolute',
                    width: '300px',
                    height: '300px',
                    borderRadius: '50%',
                    background:
                        'radial-gradient(circle, rgba(236,72,153,0.25) 0%, rgba(236,72,153,0.08) 40%, transparent 70%)',
                    bottom: '10%',
                    left: '5%',
                    pointerEvents: 'none',
                    filter: 'blur(60px)',
                    animation: 'orb-float-4 20s ease-in-out infinite',
                    zIndex: 2,
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    width: '350px',
                    height: '350px',
                    borderRadius: '50%',
                    background:
                        'radial-gradient(circle, rgba(251,191,36,0.25) 0%, rgba(251,191,36,0.08) 40%, transparent 70%)',
                    top: '10%',
                    left: '30%',
                    pointerEvents: 'none',
                    filter: 'blur(60px)',
                    animation: 'orb-float-5 24s ease-in-out infinite',
                    zIndex: 2,
                }}
            />

            {/* Animated grid pattern with rotation */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    backgroundImage: `
            linear-gradient(rgba(55,65,81,0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(55,65,81,0.15) 1px, transparent 1px)
          `,
                    backgroundSize: '60px 60px',
                    opacity: 0.4,
                    pointerEvents: 'none',
                    animation: 'grid-move 25s linear infinite',
                    zIndex: 1,
                }}
            />

            {/* Animated wave pattern */}
            <div
                style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '200px',
                    background: 'linear-gradient(to top, rgba(254,115,46,0.05) 0%, transparent 100%)',
                    pointerEvents: 'none',
                    animation: 'wave-animation 15s ease-in-out infinite',
                    zIndex: 1,
                }}
            />

            {/* Enhanced animated particles */}
            {Array.from({ length: 30 }).map((_, i) => {
                const colors = [
                    '254,115,46', '34,197,94', '56,189,248', '139,92,246', '236,72,153', '251,191,36'
                ];
                const color = colors[i % colors.length];
                const size = Math.random() * 6 + 3;
                const duration = Math.random() * 15 + 15;
                const delay = Math.random() * 10;

                return (
                    <div
                        key={i}
                        style={{
                            position: 'absolute',
                            width: `${size}px`,
                            height: `${size}px`,
                            borderRadius: '50%',
                            background: `rgba(${color}, ${Math.random() * 0.4 + 0.4})`,
                            left: `${Math.random() * 100}%`,
                            top: `${Math.random() * 100}%`,
                            pointerEvents: 'none',
                            animation: `particle-float-enhanced ${duration}s ease-in-out infinite`,
                            animationDelay: `${delay}s`,
                            boxShadow: `0 0 ${size * 2}px rgba(${color}, 0.6)`,
                            zIndex: 2,
                        }}
                    />
                );
            })}

            {/* Floating light rays */}
            {Array.from({ length: 5 }).map((_, i) => (
                <div
                    key={`ray-${i}`}
                    style={{
                        position: 'absolute',
                        width: '2px',
                        height: '200px',
                        background: `linear-gradient(to bottom, 
              transparent 0%, 
              rgba(${i % 2 === 0 ? '254,115,46' : '56,189,248'}, 0.3) 50%, 
              transparent 100%)`,
                        left: `${20 + i * 15}%`,
                        top: '-100px',
                        pointerEvents: 'none',
                        animation: `ray-float ${15 + i * 3}s ease-in-out infinite`,
                        animationDelay: `${i * 2}s`,
                        transform: `rotate(${i * 15}deg)`,
                        zIndex: 1,
                    }}
                />
            ))}

            <div
                style={{
                    width: '100%',
                    maxWidth: '1200px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px',
                    position: 'relative',
                    zIndex: 10,
                }}
            >
                {/* Header */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '16px',
                        padding: '20px 24px',
                        borderRadius: 24,
                        background:
                            'linear-gradient(135deg, rgba(15,23,42,0.95), rgba(2,6,23,0.95))',
                        border: '1px solid rgba(55,65,81,0.6)',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(15,23,42,0.8)',
                        backdropFilter: 'blur(20px)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div
                            style={{
                                width: 52,
                                height: 52,
                                borderRadius: 999,
                                background:
                                    'conic-gradient(from 180deg, #FE732E, #f97316, #facc15, #22c55e, #06b6d4, #4f46e5, #FE732E)',
                                padding: 3,
                                boxShadow: '0 8px 24px rgba(254,115,46,0.4)',
                            }}
                        >
                            <div
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    borderRadius: '999px',
                                    backgroundColor: '#020617',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 24,
                                    color: '#e5e7eb',
                                    fontWeight: 700,
                                }}
                            >
                                T
                            </div>
                        </div>
                        <div>
                            <div
                                style={{
                                    fontSize: 24,
                                    fontWeight: 700,
                                    color: '#f9fafb',
                                    letterSpacing: 0.5,
                                    marginBottom: 2,
                                }}
                            >
                                Totus Web Calling
                            </div>
                            <div
                                style={{
                                    fontSize: 13,
                                    color: '#9ca3af',
                                    fontWeight: 500,
                                }}
                            >
                                Панель звонков для агентов в реальном времени
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleLogout}
                        style={{
                            padding: '12px 20px',
                            background:
                                'linear-gradient(135deg, rgba(220,38,38,0.95), rgba(239,68,68,0.98))',
                            color: '#f9fafb',
                            border: 'none',
                            borderRadius: 999,
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: 14,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            boxShadow: '0 12px 32px rgba(220,38,38,0.5)',
                            transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 16px 40px rgba(220,38,38,0.6)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 12px 32px rgba(220,38,38,0.5)';
                        }}
                    >
            <span
                style={{
                    width: 8,
                    height: 8,
                    borderRadius: '999px',
                    backgroundColor: '#fecaca',
                    boxShadow: '0 0 8px rgba(254,202,202,0.8)',
                }}
            />
                        Выйти
                    </button>
                </div>

                {/* Top row: agent card + timer */}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 2.1fr) minmax(0, 1.2fr)',
                        gap: '24px',
                    }}
                >
                    {/* User Info */}
                    {loggedInUser && (
                        <div
                            style={{
                                padding: '24px',
                                borderRadius: 24,
                                background:
                                    'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(2,6,23,0.97))',
                                border: '1px solid rgba(55,65,81,0.6)',
                                boxShadow:
                                    '0 24px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(15,23,42,0.8)',
                                backdropFilter: 'blur(20px)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 16,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <div
                                    style={{
                                        width: 56,
                                        height: 56,
                                        borderRadius: 999,
                                        background:
                                            'conic-gradient(from 180deg, #22c55e, #16a34a, #15803d, #22c55e)',
                                        padding: 3,
                                        boxShadow: '0 8px 24px rgba(34,197,94,0.4)',
                                    }}
                                >
                                    <div
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            borderRadius: '999px',
                                            backgroundColor: '#020617',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: 24,
                                            color: '#ecfdf3',
                                            fontWeight: 700,
                                        }}
                                    >
                                        {(loggedInUser.name ||
                                            loggedInUser.fName ||
                                            loggedInUser.email ||
                                            'U')
                                            .toString()
                                            .charAt(0)
                                            .toUpperCase()}
                                    </div>
                                </div>
                                <div>
                                    <div
                                        style={{
                                            fontSize: 18,
                                            fontWeight: 700,
                                            color: '#f9fafb',
                                            marginBottom: 6,
                                            letterSpacing: 0.3,
                                        }}
                                    >
                                        {loggedInUser.name ||
                                            loggedInUser.fName ||
                                            loggedInUser.email ||
                                            'Пользователь'}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 13,
                                            color: '#9ca3af',
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            gap: 10,
                                            alignItems: 'center',
                                        }}
                                    >
                                        <span>{loggedInUser.email}</span>
                                        <span style={{ opacity: 0.5 }}>•</span>
                                        <span>
                      ID:{' '}
                                            <strong
                                                style={{
                                                    color: '#FE732E',
                                                    fontWeight: 700,
                                                    fontSize: 14,
                                                }}
                                            >
                        {loggedInUser.loyaltyId}
                      </strong>
                    </span>
                                    </div>
                                </div>
                            </div>
                            <div
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: 999,
                                    backgroundColor: 'rgba(34,197,94,0.15)',
                                    border: '2px solid rgba(34,197,94,0.5)',
                                    fontSize: 12,
                                    color: '#bbf7d0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    whiteSpace: 'nowrap',
                                    fontWeight: 600,
                                    boxShadow: '0 4px 12px rgba(34,197,94,0.2)',
                                }}
                            >
                <span
                    style={{
                        width: 8,
                        height: 8,
                        borderRadius: '999px',
                        backgroundColor: '#22c55e',
                        boxShadow: '0 0 12px rgba(34,197,94,0.8)',
                        animation: 'pulse 2s infinite',
                    }}
                />
                                Агент онлайн
                            </div>
                        </div>
                    )}

                    {/* Call Timer */}
                    <div
                        style={{
                            padding: '24px',
                            borderRadius: 24,
                            background:
                                'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(2,6,23,0.97))',
                            border: `1px solid ${
                                isCallActive
                                    ? 'rgba(251,191,36,0.4)'
                                    : 'rgba(55,65,81,0.6)'
                            }`,
                            boxShadow: isCallActive
                                ? '0 24px 60px rgba(251,191,36,0.2), 0 0 0 1px rgba(251,191,36,0.3)'
                                : '0 24px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(15,23,42,0.8)',
                            backdropFilter: 'blur(20px)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                        }}
                    >
                        <div
                            style={{
                                fontSize: 12,
                                textTransform: 'uppercase',
                                letterSpacing: 1.2,
                                color: '#9ca3af',
                                fontWeight: 600,
                            }}
                        >
                            Статус звонка
                        </div>
                        <div
                            style={{
                                fontSize: 15,
                                color: '#e5e7eb',
                                fontWeight: 600,
                                opacity: isCallActive ? 1 : 0.7,
                                marginBottom: 8,
                            }}
                        >
                            {isCallActive
                                ? 'Идет разговор'
                                : callState === 'calling'
                                    ? 'Исходящий вызов...'
                                    : callState === 'ringing'
                                        ? 'Входящий звонок...'
                                        : 'Нет активных звонков'}
                        </div>
                        <div
                            style={{
                                fontFamily: 'SF Mono, ui-monospace, Menlo, Monaco, Consolas',
                                fontSize: 32,
                                fontWeight: 700,
                                color: isCallActive ? '#fbbf24' : '#4b5563',
                                textShadow: isCallActive
                                    ? '0 0 20px rgba(251,191,36,0.5)'
                                    : 'none',
                                letterSpacing: 2,
                            }}
                        >
                            {isCallActive ? formatCallTime(callSeconds) : '00:00'}
                        </div>
                    </div>
                </div>

                {/* Users List */}
                <div
                    style={{
                        padding: '24px',
                        borderRadius: 24,
                        background:
                            'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(2,6,23,0.97))',
                        border: '1px solid rgba(55,65,81,0.6)',
                        boxShadow:
                            '0 24px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(15,23,42,0.8)',
                        backdropFilter: 'blur(20px)',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 20,
                            gap: 12,
                        }}
                    >
                        <div>
                            <h2
                                style={{
                                    margin: 0,
                                    color: '#f9fafb',
                                    fontSize: 22,
                                    fontWeight: 700,
                                    marginBottom: 6,
                                    letterSpacing: 0.3,
                                }}
                            >
                                Пользователи
                            </h2>
                            <div
                                style={{
                                    fontSize: 13,
                                    color: '#9ca3af',
                                    fontWeight: 500,
                                }}
                            >
                                Онлайн и офлайн пользователи с поддержкой VoIP
                            </div>
                        </div>
                        <button
                            onClick={loadUsers}
                            disabled={loading}
                            style={{
                                padding: '10px 18px',
                                borderRadius: 999,
                                border: '1px solid rgba(55,65,81,0.8)',
                                backgroundColor: loading
                                    ? 'rgba(31,41,55,0.8)'
                                    : 'rgba(15,23,42,0.95)',
                                color: '#e5e7eb',
                                cursor: loading ? 'not-allowed' : 'pointer',
                                fontSize: 13,
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                transition: 'all 0.2s',
                                boxShadow: loading
                                    ? 'none'
                                    : '0 4px 12px rgba(0,0,0,0.2)',
                            }}
                            onMouseEnter={(e) => {
                                if (!loading) {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.3)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!loading) {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                                }
                            }}
                        >
              <span
                  style={{
                      width: 8,
                      height: 8,
                      borderRadius: '999px',
                      backgroundColor: loading ? '#9ca3af' : '#22c55e',
                      boxShadow: loading
                          ? 'none'
                          : '0 0 8px rgba(34,197,94,0.6)',
                  }}
              />
                            {loading ? 'Обновление...' : 'Обновить список'}
                        </button>
                    </div>

                    {users.length === 0 ? (
                        <div
                            style={{
                                padding: '24px',
                                textAlign: 'center',
                                color: '#6b7280',
                                fontSize: 14,
                            }}
                        >
                            {loading
                                ? 'Загрузка пользователей...'
                                : 'Пользователи не найдены'}
                        </div>
                    ) : (
                        <div
                            style={{
                                display: 'grid',
                                gap: 10,
                            }}
                        >
                            {users.map((user) => {
                                const isMe = user.loyaltyId === currentLoyaltyId;
                                const isDisabled =
                                    !currentLoyaltyId ||
                                    isMe ||
                                    (!user.online && !user.hasVoipToken);

                                return (
                                    <div
                                        key={user.id}
                                        style={{
                                            padding: '18px 20px',
                                            borderRadius: 20,
                                            border: isMe
                                                ? '2px solid rgba(254,115,46,0.6)'
                                                : '1px solid rgba(55,65,81,0.6)',
                                            background: isMe
                                                ? 'linear-gradient(135deg, rgba(254,115,46,0.15), rgba(15,23,42,0.98))'
                                                : 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(2,6,23,0.97))',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 16,
                                            transition: 'all 0.2s',
                                            boxShadow: isMe
                                                ? '0 8px 24px rgba(254,115,46,0.2)'
                                                : '0 4px 16px rgba(0,0,0,0.2)',
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!isMe) {
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.3)';
                                                e.currentTarget.style.borderColor = 'rgba(55,65,81,0.8)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isMe) {
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
                                                e.currentTarget.style.borderColor = 'rgba(55,65,81,0.6)';
                                            }
                                        }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 12,
                                                    marginBottom: 8,
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: 44,
                                                        height: 44,
                                                        borderRadius: 999,
                                                        background: user.online
                                                            ? 'conic-gradient(from 180deg, #22c55e, #16a34a, #15803d, #22c55e)'
                                                            : 'linear-gradient(135deg, rgba(55,65,81,0.8), rgba(31,41,55,0.8))',
                                                        padding: 2,
                                                        boxShadow: user.online
                                                            ? '0 4px 16px rgba(34,197,94,0.3)'
                                                            : 'none',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            borderRadius: '999px',
                                                            backgroundColor: '#020617',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontSize: 18,
                                                            color: '#e5e7eb',
                                                            fontWeight: 700,
                                                            border: '1px solid rgba(55,65,81,0.6)',
                                                        }}
                                                    >
                                                        {getUserDisplayName(user)
                                                            .toString()
                                                            .charAt(0)
                                                            .toUpperCase()}
                                                    </div>
                                                </div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 10,
                                                            marginBottom: 4,
                                                        }}
                                                    >
                                                        <strong
                                                            style={{
                                                                color: '#f9fafb',
                                                                fontWeight: 700,
                                                                fontSize: 16,
                                                                whiteSpace: 'nowrap',
                                                                textOverflow: 'ellipsis',
                                                                overflow: 'hidden',
                                                            }}
                                                        >
                                                            {getUserDisplayName(user)}
                                                        </strong>
                                                        {user.online ? (
                                                            <span
                                                                style={{
                                                                    padding: '4px 10px',
                                                                    borderRadius: 999,
                                                                    fontSize: 11,
                                                                    backgroundColor: 'rgba(34,197,94,0.15)',
                                                                    color: '#bbf7d0',
                                                                    border: '1px solid rgba(34,197,94,0.5)',
                                                                    fontWeight: 600,
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 6,
                                                                }}
                                                            >
                                <span
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '999px',
                                        backgroundColor: '#22c55e',
                                        boxShadow: '0 0 8px rgba(34,197,94,0.8)',
                                    }}
                                />
                                Онлайн
                              </span>
                                                        ) : (
                                                            <span
                                                                style={{
                                                                    padding: '4px 10px',
                                                                    borderRadius: 999,
                                                                    fontSize: 11,
                                                                    backgroundColor: 'rgba(55,65,81,0.7)',
                                                                    color: '#e5e7eb',
                                                                    border: '1px solid rgba(55,65,81,0.9)',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: 6,
                                                                    fontWeight: 600,
                                                                }}
                                                            >
                                <span
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '999px',
                                        backgroundColor: '#6b7280',
                                    }}
                                />
                                Офлайн
                                                                {user.hasVoipToken && (
                                                                    <span style={{ marginLeft: 4 }}>• VoIP</span>
                                                                )}
                              </span>
                                                        )}
                                                    </div>
                                                    <div
                                                        style={{
                                                            fontSize: 12,
                                                            color: '#9ca3af',
                                                            display: 'flex',
                                                            flexWrap: 'wrap',
                                                            gap: 8,
                                                            alignItems: 'center',
                                                        }}
                                                    >
                            <span>
                              ID:{' '}
                                <strong style={{ color: '#FE732E' }}>
                                {user.loyaltyId}
                              </strong>
                            </span>
                                                        {user.phone && (
                                                            <>
                                                                <span style={{ opacity: 0.5 }}>•</span>
                                                                <span>{user.phone}</span>
                                                            </>
                                                        )}
                                                        {user.email && (
                                                            <>
                                                                <span style={{ opacity: 0.5 }}>•</span>
                                                                <span>{user.email}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleCallUser(user)}
                                            disabled={isDisabled}
                                            style={{
                                                padding: '12px 22px',
                                                borderRadius: 999,
                                                border: 'none',
                                                backgroundColor: isDisabled
                                                    ? 'rgba(31,41,55,0.8)'
                                                    : '#FE732E',
                                                color: isDisabled ? '#6b7280' : '#f9fafb',
                                                cursor: isDisabled ? 'not-allowed' : 'pointer',
                                                fontSize: 14,
                                                fontWeight: 700,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                boxShadow: isDisabled
                                                    ? 'none'
                                                    : '0 12px 32px rgba(254,115,46,0.5)',
                                                whiteSpace: 'nowrap',
                                                transition: 'all 0.2s',
                                            }}
                                            onMouseEnter={(e) => {
                                                if (!isDisabled) {
                                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                                    e.currentTarget.style.boxShadow =
                                                        '0 16px 40px rgba(254,115,46,0.6)';
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (!isDisabled) {
                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                    e.currentTarget.style.boxShadow =
                                                        '0 12px 32px rgba(254,115,46,0.5)';
                                                }
                                            }}
                                        >
                                            <span style={{ fontSize: 16 }}>📞</span>
                                            Позвонить
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Server Status */}
                <div
                    style={{
                        padding: '24px',
                        borderRadius: 24,
                        background:
                            'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(2,6,23,0.97))',
                        border: '1px solid rgba(55,65,81,0.6)',
                        boxShadow:
                            '0 24px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(15,23,42,0.8)',
                        backdropFilter: 'blur(20px)',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: showServerStatus ? 16 : 0,
                        }}
                    >
                        <div>
                            <h3
                                style={{
                                    margin: 0,
                                    color: '#f9fafb',
                                    fontSize: 18,
                                    fontWeight: 700,
                                    marginBottom: 4,
                                    letterSpacing: 0.3,
                                }}
                            >
                                Статус STUN/TURN серверов
                            </h3>
                            <div
                                style={{
                                    fontSize: 13,
                                    color: '#9ca3af',
                                    fontWeight: 500,
                                }}
                            >
                                Проверка доступности серверов для WebRTC
                            </div>
                        </div>
                        <button
                            onClick={checkServers}
                            disabled={checkingServers}
                            style={{
                                padding: '10px 18px',
                                borderRadius: 999,
                                border: '1px solid rgba(55,65,81,0.8)',
                                backgroundColor: checkingServers
                                    ? 'rgba(31,41,55,0.8)'
                                    : 'rgba(15,23,42,0.95)',
                                color: '#e5e7eb',
                                cursor: checkingServers ? 'not-allowed' : 'pointer',
                                fontSize: 13,
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                transition: 'all 0.2s',
                                boxShadow: checkingServers
                                    ? 'none'
                                    : '0 4px 12px rgba(0,0,0,0.2)',
                            }}
                            onMouseEnter={(e) => {
                                if (!checkingServers) {
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.3)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!checkingServers) {
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                                }
                            }}
                        >
                            {checkingServers ? 'Проверка...' : 'Проверить серверы'}
                        </button>
                    </div>

                    {showServerStatus && serverStatuses.length > 0 && (
                        <div
                            style={{
                                marginTop: 16,
                                maxHeight: 400,
                                overflowY: 'auto',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12,
                            }}
                        >
                            {serverStatuses.map((server, index) => {
                                const statusColor =
                                    server.status === 'available'
                                        ? '#22c55e'
                                        : server.status === 'unavailable' || server.status === 'error'
                                            ? '#ef4444'
                                            : '#fbbf24';
                                const statusText =
                                    server.status === 'available'
                                        ? 'Доступен'
                                        : server.status === 'unavailable'
                                            ? 'Недоступен'
                                            : server.status === 'error'
                                                ? 'Ошибка'
                                                : 'Проверка...';

                                return (
                                    <div
                                        key={index}
                                        style={{
                                            padding: '16px 18px',
                                            borderRadius: 16,
                                            backgroundColor: 'rgba(15,23,42,0.6)',
                                            border: `1px solid ${statusColor}30`,
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            fontSize: 13,
                                            transition: 'all 0.2s',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = 'rgba(15,23,42,0.8)';
                                            e.currentTarget.style.borderColor = `${statusColor}50`;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = 'rgba(15,23,42,0.6)';
                                            e.currentTarget.style.borderColor = `${statusColor}30`;
                                        }}
                                    >
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div
                                                style={{
                                                    color: '#f9fafb',
                                                    fontWeight: 600,
                                                    marginBottom: 6,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    fontSize: 14,
                                                }}
                                            >
                                                {server.url}
                                            </div>
                                            <div
                                                style={{
                                                    color: '#9ca3af',
                                                    fontSize: 12,
                                                    textTransform: 'uppercase',
                                                    fontWeight: 600,
                                                    letterSpacing: 0.5,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8,
                                                }}
                                            >
                        <span
                            style={{
                                padding: '2px 8px',
                                borderRadius: 6,
                                backgroundColor: 'rgba(55,65,81,0.6)',
                                fontSize: 10,
                            }}
                        >
                          {server.type === 'stun' ? 'STUN' : 'TURN'}
                        </span>
                                                {server.latency && (
                                                    <span style={{ color: '#6b7280' }}>
                            {server.latency}ms
                          </span>
                                                )}
                                            </div>
                                        </div>
                                        <div
                                            style={{
                                                padding: '6px 14px',
                                                borderRadius: 999,
                                                backgroundColor: `${statusColor}15`,
                                                border: `2px solid ${statusColor}50`,
                                                color: statusColor,
                                                fontSize: 12,
                                                fontWeight: 700,
                                                whiteSpace: 'nowrap',
                                                marginLeft: 12,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                                boxShadow: `0 0 12px ${statusColor}20`,
                                            }}
                                        >
                      <span
                          style={{
                              width: 6,
                              height: 6,
                              borderRadius: '999px',
                              backgroundColor: statusColor,
                              boxShadow: `0 0 8px ${statusColor}80`,
                          }}
                      />
                                            {statusText}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {showServerStatus && serverStatuses.length === 0 && !checkingServers && (
                        <div
                            style={{
                                padding: '12px',
                                textAlign: 'center',
                                color: '#6b7280',
                                fontSize: 13,
                            }}
                        >
                            Нажмите "Проверить серверы" для проверки статуса
                        </div>
                    )}
                </div>

                {/* Call Modal */}
                {callModalVisible && (
                    <CallModal
                        visible={callModalVisible}
                        onClose={() => {
                            // Минимизировать модалку, не прерывая звонок
                            setCallModalVisible(false);
                        }}
                    />
                )}
            </div>

            {/* Floating mini-call bar to restore modal */}
            {callState !== 'idle' && !callModalVisible && (
                <div
                    style={{
                        position: 'fixed',
                        right: 20,
                        bottom: 20,
                        zIndex: 9998,
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setCallModalVisible(true)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '14px 20px',
                            borderRadius: 999,
                            border: `2px solid ${
                                callState === 'answered'
                                    ? 'rgba(34,197,94,0.5)'
                                    : callState === 'ringing'
                                        ? 'rgba(34,197,94,0.5)'
                                        : 'rgba(248,113,22,0.5)'
                            }`,
                            background:
                                'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(2,6,23,0.97))',
                            color: '#e5e7eb',
                            fontSize: 14,
                            fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: `0 16px 40px ${
                                callState === 'answered'
                                    ? 'rgba(34,197,94,0.3)'
                                    : callState === 'ringing'
                                        ? 'rgba(34,197,94,0.3)'
                                        : 'rgba(248,113,22,0.3)'
                            }`,
                            backdropFilter: 'blur(20px)',
                            transition: 'all 0.3s',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = `0 20px 50px ${
                                callState === 'answered'
                                    ? 'rgba(34,197,94,0.4)'
                                    : callState === 'ringing'
                                        ? 'rgba(34,197,94,0.4)'
                                        : 'rgba(248,113,22,0.4)'
                            }`;
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = `0 16px 40px ${
                                callState === 'answered'
                                    ? 'rgba(34,197,94,0.3)'
                                    : callState === 'ringing'
                                        ? 'rgba(34,197,94,0.3)'
                                        : 'rgba(248,113,22,0.3)'
                            }`;
                        }}
                    >
                        <div
                            style={{
                                width: 12,
                                height: 12,
                                borderRadius: '50%',
                                backgroundColor:
                                    callState === 'answered'
                                        ? '#22c55e'
                                        : callState === 'ringing'
                                            ? '#22c55e'
                                            : '#f97316',
                                boxShadow: `0 0 12px ${
                                    callState === 'answered'
                                        ? 'rgba(34,197,94,0.8)'
                                        : callState === 'ringing'
                                            ? 'rgba(34,197,94,0.8)'
                                            : 'rgba(248,113,22,0.8)'
                                }`,
                                animation: callState === 'ringing' ? 'pulse 2s infinite' : 'none',
                            }}
                        />
                        <span style={{ whiteSpace: 'nowrap' }}>
              {callerName || 'Звонок'}
            </span>
                        {isCallActive && (
                            <span
                                style={{
                                    marginLeft: 4,
                                    fontFamily: 'SF Mono, ui-monospace, Menlo, Monaco, Consolas',
                                    fontSize: 13,
                                    color: '#fbbf24',
                                    fontWeight: 700,
                                }}
                            >
                {formatCallTime(callSeconds)}
              </span>
                        )}
                        <span style={{ fontSize: 18, marginLeft: 4 }}>📞</span>
                    </button>
                </div>
            )}

        </div>
    );
}
