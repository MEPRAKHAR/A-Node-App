// server.js
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const compiler = require('compilex');
const options = { stats: true };
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions');

const server = http.createServer(app);
const io = new Server(server);

compiler.init(options);

app.use(express.static('build'));
app.use(bodyParser.json());

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.post("/compile", (req, res) => {
    const { code, input, lang } = req.body;

    try {
        if (lang === "Python") {
            const envData = getEnvData();
            
            if (!input) {
                compiler.compilePython(envData, code, (data) => {
                    res.send(data);
                });
            } else {
                compiler.compilePythonWithInput(envData, code, input, (data) => {
                    if (data.output) {
                        res.send(data);
                        console.log(data);
                    } else {
                        res.status(400).send({ output: "error" });
                    }
                });
            }
        } else {
            res.status(400).send({ output: "Unsupported language" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send({ output: "Internal server error" });
    }
});

function getEnvData() {
    switch (process.platform) {
        case "win32":
            return { OS: "windows" };
        case "darwin":
            return { OS: "macos" };
        default:
            throw new Error("Unsupported OS. This code only works on macOS and Windows.");
    }
}

const userSocketMap = {};

function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(socketId => ({
        socketId,
        username: userSocketMap[socketId]
    }));
}

io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
        userSocketMap[socket.id] = username;
        socket.join(roomId);
        const clients = getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
            io.to(socketId).emit(ACTIONS.JOINED, { 
                clients,
                username,
                socketId: socket.id,
            });
        });
    });

    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
        io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on('disconnecting', () => {
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
                socketId: socket.id,
                username: userSocketMap[socket.id],
            });
        });
        delete userSocketMap[socket.id];
        socket.leave();
    });

    // Handle the 'message' event to broadcast chat messages
    socket.on('message', (data) => {
        console.log('Received message:', data);  // Add this line to check if the message is received
        socket.in(data.roomId).emit('chat-message', data);  // Emit message to the room
    });
    
    // Handle 'feedback' event to broadcast typing feedback
    socket.on('feedback', (data) => {
        // Broadcast typing feedback to all users in the same room
        socket.in(data.roomId).emit('feedback', data);
    });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
