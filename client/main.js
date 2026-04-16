import { startClassroom } from './classroom.js';

// 1. Mock Socket Object (To prevent errors since your teammate isn't ready)
const mockSocket = {
    on: (event, callback) => console.log(`Listener added for: ${event}`),
    emit: (event, data) => console.log(`Emitting ${event}:`, data)
};

// 2. Mock User Data
const roleFromUrl = new URLSearchParams(window.location.search).get("role");
const mockRole = roleFromUrl === "teacher" ? "teacher" : "student";

// 3. Direct Boot
console.log("Bypassing login... Launching 3D Viewport.");
startClassroom(mockSocket, mockRole);