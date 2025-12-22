import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const ALLOWED_ORIGINS = new Set([
    'https://int331.neohbz.com',
    'https://int331-backend.neohbz.com',
    'https://int331.neohbz.com',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://localhost:5173'
]);

const MOCK_PASSWORD = 'password123';
const MOCK_USER_NAMES = [
    'Amit Sharma', 'Priya Verma', 'Rohit Patel', 'Sneha Gupta',
    'Vikram Singh', 'Anjali Mehta', 'Arjun Reddy', 'Kiran Nair',
    'Riya Kapoor', 'Sanjay Chauhan', 'Meera Iyer', 'Aditya Joshi'
];

interface MockUser {
    username: string;
    fullName: string;
    avatar: string;
}

const MOCK_USERS: MockUser[] = MOCK_USER_NAMES.map((name) => {
    const username = name.toLowerCase().replace(' ', '');
    const avatar = name.split(' ').map((n) => n[0]).join('').toUpperCase();
    return { username, fullName: name, avatar };
});

interface User {
    id: string;
    fullName: string;
    avatar: string;
    isMicOn: boolean;
    isSpeaking: boolean;
}

const activeUsers: Map<string, User> = new Map();

const server = http.createServer((req, res) => {
    setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Server is running');
    } else if (req.url === '/health') {
        const stats = {
            status: 'ok',
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            activeUsers: activeUsers.size,
            connectedClients: wss.clients.size,
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            nodeVersion: process.version,
            platform: process.platform
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats, null, 2));
    } else if (req.url === '/login' && req.method === 'POST') {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk.toString();
            if (body.length > 1e6) {
                req.socket.destroy();
            }
        });

        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body || '{}');

                if (!username || !password) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Username and password are required' }));
                    return;
                }

                const user = MOCK_USERS.find(
                    (mockUser) => mockUser.username.toLowerCase() === String(username.split(" ").join("").toLowerCase()).toLowerCase()
                );

                if (!user || password !== MOCK_PASSWORD) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid credentials' }));
                    return;
                }

                const token = `mock-jwt-token-${Date.now()}`;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ token, user }));
            } catch (error) {
                console.error('Login error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Server error' }));
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
    console.log(`WebSocket server is attached to the HTTP server`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

wss.on('connection', (ws) => {
    const connectionTime = new Date().toISOString();
    console.log(`[${connectionTime}] [CONN] New client connected. Total clients: ${wss.clients.size}`);
    let userId: string | null = null;

    // Send initial state (current users in room)
    const initialState = {
        type: 'INITIAL_STATE',
        users: Array.from(activeUsers.values())
    };
    console.log(`[${new Date().toISOString()}] [SEND] → INITIAL_STATE to new client. Users count: ${initialState.users.length}`, 
        initialState.users.map(u => ({ id: u.id, name: u.fullName })));
    ws.send(JSON.stringify(initialState));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            switch (data.type) {
                case 'JOIN':
                    // Client announces they've joined
                    if (data.user && data.user.id) {
                        console.log(`[${new Date().toISOString()}] [RECV] ← JOIN request from: ${data.user.fullName} (${data.user.id})`);
                        
                        // Prevent duplicate joins from same user
                        if (activeUsers.has(data.user.id)) {
                            console.log(`[${new Date().toISOString()}] [WARN] ⚠️  Duplicate JOIN detected for: ${data.user.fullName} (${data.user.id})`);
                            console.log(`[${new Date().toISOString()}] [INFO] Active users before duplicate: ${Array.from(activeUsers.keys())}`);
                            // Still send confirmation to the client
                            const confirmMsg = {
                                type: 'JOIN_CONFIRMED',
                                user: activeUsers.get(data.user.id)
                            };
                            console.log(`[${new Date().toISOString()}] [SEND] → JOIN_CONFIRMED (duplicate) to: ${data.user.fullName}`);
                            ws.send(JSON.stringify(confirmMsg));
                            break;
                        }
                        
                        console.log(`[${new Date().toISOString()}] [INFO] Adding user to activeUsers map`);
                        activeUsers.set(data.user.id, data.user);
                        userId = data.user.id;
                        console.log(`[${new Date().toISOString()}] [INFO] Active users after add: [${Array.from(activeUsers.keys())}]. Total: ${activeUsers.size}`);
                        
                        // Confirm join to the sender
                        const confirmMsg = {
                            type: 'JOIN_CONFIRMED',
                            user: data.user
                        };
                        console.log(`[${new Date().toISOString()}] [SEND] → JOIN_CONFIRMED to: ${data.user.fullName} (${data.user.id})`);
                        ws.send(JSON.stringify(confirmMsg));
                        
                        // Broadcast to others (not the sender)
                        const broadcastMsg = {
                            type: 'USER_JOINED',
                            user: data.user
                        };
                        console.log(`[${new Date().toISOString()}] [BROADCAST] 📢 USER_JOINED to ${wss.clients.size - 1} other clients: ${data.user.fullName} (${data.user.id})`);
                        broadcast(broadcastMsg, ws);
                        
                        console.log(`[${new Date().toISOString()}] [SUCCESS] ✅ User joined successfully: ${data.user.fullName} (${data.user.id})`);
                    }
                    break;
                    
                case 'UPDATE':
                    // Client updates their state (mic, speaking, etc)
                    if (data.user && data.user.id) {
                        console.log(`[${new Date().toISOString()}] [RECV] ← UPDATE from: ${data.user.fullName} (${data.user.id})`);
                        activeUsers.set(data.user.id, data.user);
                        
                        // Broadcast to all including sender for state sync
                        console.log(`[${new Date().toISOString()}] [BROADCAST] 📢 USER_UPDATE to all ${wss.clients.size} clients`);
                        broadcast({
                            type: 'USER_UPDATE',
                            user: data.user
                        });
                    }
                    break;
                    
                case 'SYNC':
                    // Client requests current state
                    console.log(`[${new Date().toISOString()}] [RECV] ← SYNC request from client`);
                    const syncState = {
                        type: 'INITIAL_STATE',
                        users: Array.from(activeUsers.values())
                    };
                    console.log(`[${new Date().toISOString()}] [SEND] → INITIAL_STATE (sync). Users: ${syncState.users.length}`);
                    ws.send(JSON.stringify(syncState));
                    break;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        const closeTime = new Date().toISOString();
        console.log(`[${closeTime}] [CONN] Client disconnected. Remaining clients: ${wss.clients.size - 1}`);
        if (userId) {
            const userName = activeUsers.get(userId)?.fullName || 'Unknown';
            console.log(`[${closeTime}] [INFO] Removing user from activeUsers: ${userName} (${userId})`);
            activeUsers.delete(userId);
            console.log(`[${closeTime}] [INFO] Active users after remove: [${Array.from(activeUsers.keys())}]. Total: ${activeUsers.size}`);
            
            const leaveMsg = {
                type: 'USER_LEFT',
                userId: userId
            };
            console.log(`[${closeTime}] [BROADCAST] 📢 USER_LEFT to ${wss.clients.size} clients: ${userName} (${userId})`);
            broadcast(leaveMsg);
            
            console.log(`[${closeTime}] [SUCCESS] ✅ User left: ${userName} (${userId})`);
        }
    });
});

function broadcast(data: any, excludeWs?: WebSocket) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
            client.send(message);
        }
    });
}

function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}
