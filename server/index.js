const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const users = {};

io.on('connection', (socket) => {
    console.log('User Connected:', socket.id);

    socket.on('join-class', (data) => {
        users[socket.id] = { id: socket.id, ...data, x: 0, y: 0, z: 0 };
    });

    socket.on('move', (data) => {
        if (users[socket.id]) {
            users[socket.id] = { ...users[socket.id], ...data };
            socket.broadcast.emit('update', { id: socket.id, ...data });
        }
    });

    socket.on('draw', (data) => {
        // Teacher validation would go here
        socket.broadcast.emit('draw', data);
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
        io.emit('user-left', socket.id);
    });
});

server.listen(3000, () => console.log('Server running on port 3000'));