import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MdCallEnd } from 'react-icons/md';

interface User {
    id: string;
    fullName: string;
    avatar: string;
    isMicOn: boolean;
}

const Classroom = () => {
    const navigate = useNavigate();
    const [users, setUsers] = useState<User[]>([]);
    const [myUserId] = useState(() => `user-${Date.now()}`);
    const ws = useRef<WebSocket | null>(null);
    const hasJoined = useRef(false);

    const getInitials = (value: string) =>
        value.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleServerMessage = (data: any) => {
        switch (data.type) {
            case 'INITIAL_STATE': 
                console.log(`[${new Date().toISOString()}] [MSG] 📨 INITIAL_STATE received. Users count: ${data.users.length}`);
                console.log(`[${new Date().toISOString()}] [STATE] Users in INITIAL_STATE:`, data.users.map((u: User) => ({ id: u.id, name: u.fullName })));
                // Merge with existing users to prevent overwriting
                setUsers(prev => {
                    console.log(`[${new Date().toISOString()}] [STATE] Current users before merge:`, prev.map(u => ({ id: u.id, name: u.fullName })));
                    console.log(`[${new Date().toISOString()}] [STATE] hasJoined.current: ${hasJoined.current}`);
                    
                    // If we haven't joined yet, just use the initial state
                    if (!hasJoined.current) {
                        console.log(`[${new Date().toISOString()}] [STATE] ✅ Not joined yet, using INITIAL_STATE as-is`);
                        return data.users;
                    }
                    // Otherwise, merge intelligently
                    const existingIds = new Set(prev.map(u => u.id));
                    const newUsers = data.users.filter((u: User) => !existingIds.has(u.id));
                    console.log(`[${new Date().toISOString()}] [STATE] 🔄 Merging: ${newUsers.length} new users with ${prev.length} existing users`);
                    console.log(`[${new Date().toISOString()}] [STATE] New users to add:`, newUsers.map((u: User) => ({ id: u.id, name: u.fullName })));
                    const merged = [...prev, ...newUsers];
                    console.log(`[${new Date().toISOString()}] [STATE] ✅ Merged result:`, merged.map(u => ({ id: u.id, name: u.fullName })));
                    return merged;
                });
                break;
            case 'JOIN_CONFIRMED':
                console.log(`[${new Date().toISOString()}] [MSG] 📨 JOIN_CONFIRMED received for:`, data.user);
                console.log(`[${new Date().toISOString()}] [STATE] Setting hasJoined.current = true`);
                hasJoined.current = true;
                // Add ourselves only after server confirmation
                setUsers(prev => {
                    console.log(`[${new Date().toISOString()}] [STATE] Current users before JOIN_CONFIRMED:`, prev.map(u => ({ id: u.id, name: u.fullName })));
                    const exists = prev.some(u => u.id === data.user.id);
                    console.log(`[${new Date().toISOString()}] [STATE] User already exists: ${exists}`);
                    if (exists) {
                        console.log(`[${new Date().toISOString()}] [STATE] ⚠️  User already in list, skipping add`);
                        return prev;
                    }
                    console.log(`[${new Date().toISOString()}] [STATE] ✅ Adding self to user list`);
                    const updated = [...prev, data.user];
                    console.log(`[${new Date().toISOString()}] [STATE] Updated user list:`, updated.map(u => ({ id: u.id, name: u.fullName })));
                    return updated;
                });
                break;
            case 'USER_JOINED': 
                console.log(`[${new Date().toISOString()}] [MSG] 📨 USER_JOINED received:`, data.user);
                // Prevent duplicate entries - use Set for deduplication
                setUsers(prev => {
                    console.log(`[${new Date().toISOString()}] [STATE] Current users before USER_JOINED:`, prev.map(u => ({ id: u.id, name: u.fullName })));
                    const exists = prev.some(u => u.id === data.user.id);
                    console.log(`[${new Date().toISOString()}] [STATE] User already exists: ${exists}`);
                    if (exists) {
                        console.log(`[${new Date().toISOString()}] [STATE] ⚠️  User already in list, skipping duplicate: ${data.user.fullName}`);
                        return prev;
                    }
                    console.log(`[${new Date().toISOString()}] [STATE] ✅ Adding new user: ${data.user.fullName}`);
                    const updated = [...prev, data.user];
                    console.log(`[${new Date().toISOString()}] [STATE] Updated user list:`, updated.map(u => ({ id: u.id, name: u.fullName })));
                    return updated;
                });
                break;
            case 'USER_LEFT': 
                console.log(`[${new Date().toISOString()}] [MSG] 📨 USER_LEFT received. UserId: ${data.userId}`);
                setUsers(prev => {
                    console.log(`[${new Date().toISOString()}] [STATE] Current users before removal:`, prev.map(u => ({ id: u.id, name: u.fullName })));
                    const filtered = prev.filter(u => u.id !== data.userId);
                    console.log(`[${new Date().toISOString()}] [STATE] ✅ Users after removal:`, filtered.map(u => ({ id: u.id, name: u.fullName })));
                    return filtered;
                });
                break;
            case 'USER_UPDATE': 
                console.log(`[${new Date().toISOString()}] [MSG] 📨 USER_UPDATE received:`, data.user);
                setUsers(prev => {
                    console.log(`[${new Date().toISOString()}] [STATE] Current users before update:`, prev.map(u => ({ id: u.id, name: u.fullName })));
                    const userExists = prev.some(u => u.id === data.user.id);
                    console.log(`[${new Date().toISOString()}] [STATE] User exists: ${userExists}`);
                    const updated = prev.map(u => u.id === data.user.id ? data.user : u);
                    console.log(`[${new Date().toISOString()}] [STATE] ✅ Users after update:`, updated.map(u => ({ id: u.id, name: u.fullName })));
                    // If user doesn't exist, don't add them via UPDATE
                    return updated;
                }); 
                break;
        }
    };

    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            navigate('/');
        }
    }, [navigate]);

    useEffect(() => {
        if (!myUserId) return;

        const connect = () => {
            const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';
            console.log(`[${new Date().toISOString()}] [WS] 🔌 Connecting to WebSocket: ${wsUrl}`);
            ws.current = new WebSocket(wsUrl);

            ws.current.onopen = () => {
                console.log(`[${new Date().toISOString()}] [WS] ✅ Connected to Classroom Server`);
                
                // Get user profile from localStorage
                const username = localStorage.getItem('username') || 'Anonymous';
                const fullName = localStorage.getItem('fullName') || username;
                const avatar = localStorage.getItem('avatar') || getInitials(fullName);
                
                // Announce that we've joined
                const myUser: User = {
                    id: myUserId,
                    fullName,
                    avatar,
                    isMicOn: false,
                };
                
                console.log(`[${new Date().toISOString()}] [WS] 📤 Preparing to send JOIN request`);
                console.log(`[${new Date().toISOString()}] [USER] My user details:`, myUser);
                
                // Send JOIN request and wait for server confirmation
                // Don't add ourselves until we receive JOIN_CONFIRMED
                const joinMsg = {
                    type: 'JOIN',
                    user: myUser
                };
                console.log(`[${new Date().toISOString()}] [WS] 📤 Sending JOIN request:`, joinMsg);
                ws.current?.send(JSON.stringify(joinMsg));
                
                console.log(`[${new Date().toISOString()}] [WS] ⏳ JOIN request sent, waiting for server confirmation`);
            };

            ws.current.onmessage = (event) => {
                console.log(`[${new Date().toISOString()}] [WS] 📥 Raw message received:`, event.data);
                const data = JSON.parse(event.data);
                console.log(`[${new Date().toISOString()}] [WS] 📥 Parsed message:`, data);
                handleServerMessage(data);
            };
            
            ws.current.onerror = (error) => {
                console.error(`[${new Date().toISOString()}] [WS] ❌ WebSocket error:`, error);
            };
            
            ws.current.onclose = (event) => {
                console.log(`[${new Date().toISOString()}] [WS] 🔌 WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
            };
        };
        connect();
        return () => { ws.current?.close(); };
    }, [myUserId]);

    const leaveClass = () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        localStorage.removeItem('fullName');
        localStorage.removeItem('avatar');
        navigate('/');
    };

    // Ensure we only show max 9 users for the 3x3 grid
    const displayedUsers = users.slice(0, 9); 

    // Generate consistent color for each user based on their ID
    const getAvatarStyle = (userId: string): React.CSSProperties => {
        const gradients = [
            { background: 'linear-gradient(to bottom right, #a855f7, #4f46e5)' }, // purple to indigo
            { background: 'linear-gradient(to bottom right, #ec4899, #f43f5e)' }, // pink to rose
            { background: 'linear-gradient(to bottom right, #10b981, #14b8a6)' }, // emerald to teal
            { background: 'linear-gradient(to bottom right, #3b82f6, #06b6d4)' }, // blue to cyan
            { background: 'linear-gradient(to bottom right, #f97316, #dc2626)' }, // orange to red
            { background: 'linear-gradient(to bottom right, #eab308, #f59e0b)' }, // yellow to amber
            { background: 'linear-gradient(to bottom right, #22c55e, #84cc16)' }, // green to lime
            { background: 'linear-gradient(to bottom right, #8b5cf6, #a855f7)' }, // violet to purple
        ];
        // Use user ID to consistently pick a color
        const hash = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return gradients[hash % gradients.length];
    };

    const getDisplayName = (user: User) =>
        user.id === myUserId ? `${user.fullName} (You)` : user.fullName;

    return (
        <div className="h-screen w-screen bg-[#202124] text-white flex flex-col">
            {/* Top 10% - Header */}
            <header className="h-[10%] flex items-center justify-center border-b border-gray-700">
                <h1 className="text-2xl font-bold text-[#FFD700]">Platform Automation</h1>
            </header>

            {/* Center 80% - 3x3 Grid */}
            <main className="h-[80%] p-4">
                <div className="h-full w-full grid grid-cols-3 grid-rows-3 gap-4">
                    {displayedUsers.map((user) => (
                        <div 
                            key={user.id} 
                            className={`
                                relative bg-[#3c4043] rounded-lg overflow-hidden flex flex-col items-center justify-center
                                transition-all duration-300
                                border border-gray-600
                                
                            `}
                        >
                            <div 
                                className="w-[64px] h-[64px] rounded-full flex items-center justify-center text-[2rem] font-bold"
                                style={getAvatarStyle(user.id)}
                            >
                                {user.avatar}
                            </div>
                            <span className="font-medium text-[1.125rem]" style={{ marginTop: '1rem' }}>{getDisplayName(user)}</span>
                        </div>
                    ))}
                    {/* Fill empty spots */}
                    {Array.from({ length: Math.max(0, 9 - displayedUsers.length) }).map((_, i) => (
                        <div key={`empty-${i}`} className="bg-[#2a2b2e] rounded-lg border border-gray-800/50">
                            {/* Empty slot */}
                        </div>
                    ))}
                </div>
            </main>

            {/* Bottom 10% - Footer */}
            <footer className="h-[10%] flex items-center justify-center border-t border-gray-700 bg-[#202124]">
                <button 
                    onClick={leaveClass}
                    className="flex items-center space-x-2 bg-red-600 hover:bg-red-500 text-white px-6 py-3 rounded-full font-medium transition-colors shadow-lg"
                >
                    <MdCallEnd size={24} />
                    <span>Leave Call</span>
                </button>
            </footer>
        </div>
    );
};

export default Classroom;
