import { WebSocketServer, WebSocket } from 'ws';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server started on port ${PORT}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

interface User {
    id: string;
    fullName: string;
    avatar: string;
    isMicOn: boolean;
    isSpeaking: boolean;
}

const activeUsers: Map<string, User> = new Map();

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
