import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;

interface User {
    id: string;
    fullName: string;
    avatar: string;
    isMicOn: boolean;
    isSpeaking: boolean;
}

const activeUsers: Map<string, User> = new Map();

const server = http.createServer((req, res) => {
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
    console.log('Client connected');
    let userId: string | null = null;

    // Send initial state (current users in room)
    ws.send(JSON.stringify({
        type: 'INITIAL_STATE',
        users: Array.from(activeUsers.values())
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            switch (data.type) {
                case 'JOIN':
                    // Client announces they've joined
                    if (data.user && data.user.id) {
                        activeUsers.set(data.user.id, data.user);
                        userId = data.user.id;
                        broadcast({
                            type: 'USER_JOINED',
                            user: data.user
                        }, ws);
                        console.log(`User joined: ${data.user.fullName}`);
                    }
                    break;
                    
                case 'UPDATE':
                    // Client updates their state (mic, speaking, etc)
                    if (data.user && data.user.id) {
                        activeUsers.set(data.user.id, data.user);
                        broadcast({
                            type: 'USER_UPDATE',
                            user: data.user
                        }, ws);
                    }
                    break;
                    
                case 'SYNC':
                    // Client requests current state
                    ws.send(JSON.stringify({
                        type: 'INITIAL_STATE',
                        users: Array.from(activeUsers.values())
                    }));
                    break;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        if (userId) {
            activeUsers.delete(userId);
            broadcast({
                type: 'USER_LEFT',
                userId: userId
            });
            console.log(`User left: ${userId}`);
        }
        console.log('Client disconnected');
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
