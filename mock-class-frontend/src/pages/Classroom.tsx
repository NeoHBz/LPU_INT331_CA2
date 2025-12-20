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
    const ws = useRef<WebSocket | null>(null);
    const myUserId = useRef<string>('');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleServerMessage = (data: any) => {
        console.log('Received message:', data);
        switch (data.type) {
            case 'INITIAL_STATE': 
                console.log('Setting initial users:', data.users);
                setUsers(data.users); 
                break;
            case 'USER_JOINED': 
                console.log('User joined:', data.user);
                setUsers(prev => [...prev, data.user]); 
                break;
            case 'USER_LEFT': 
                console.log('User left:', data.userId);
                setUsers(prev => prev.filter(u => u.id !== data.userId)); 
                break;
            case 'USER_UPDATE': 
                console.log('User updated:', data.user);
                setUsers(prev => prev.map(u => u.id === data.user.id ? data.user : u)); 
                break;
        }
    };

    useEffect(() => {
        // Generate a stable user ID once after mount (impure Date.now() used inside effect)
        myUserId.current = `user-${Date.now()}`;

        const token = localStorage.getItem('authToken');
        if (!token) {
            navigate('/');
        }
    }, [navigate]);

    useEffect(() => {
        const connect = () => {
            const wsUrl = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';
            ws.current = new WebSocket(wsUrl);

            ws.current.onopen = () => {
                console.log('Connected to Classroom Server');
                
                // Get username from localStorage
                const username = localStorage.getItem('username') || 'Anonymous';
                const initials = username.split('').slice(0, 2).join('').toUpperCase();
                
                // Announce that we've joined
                const myUser: User = {
                    id: myUserId.current,
                    fullName: username,
                    avatar: initials,
                    isMicOn: false,
                };
                
                // Add ourselves to the users list immediately
                setUsers(prev => [...prev, myUser]);
                
                ws.current?.send(JSON.stringify({
                    type: 'JOIN',
                    user: myUser
                }));
            };

            ws.current.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            };
        };
        connect();
        return () => { ws.current?.close(); };
    }, []);

    const leaveClass = () => {
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        navigate('/');
    };

    // Periodic sync - request current state every 5 seconds
    useEffect(() => {
        const syncInterval = setInterval(() => {
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ type: 'SYNC' }));
            }
        }, 5000);

        return () => clearInterval(syncInterval);
    }, []);

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
                            <span className="font-medium text-[1.125rem]" style={{ marginTop: '1rem' }}>{user.fullName}</span>
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
